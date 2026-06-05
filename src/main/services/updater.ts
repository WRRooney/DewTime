// src/main/services/updater.ts
//
// Auto-update via electron-updater against the GitHub Releases publish target
// configured in electron-builder.yml (provider: github). The release workflow
// uploads latest*.yml / *.blockmap alongside each artifact, which is the
// metadata electron-updater reads to decide whether a newer version exists.
//
// Behavior: on a packaged app, check on boot and then on a fixed interval. New
// versions auto-download in the background; once downloaded, the user is
// notified and the update installs on next quit (autoInstallOnAppQuit). Nothing
// is forced — quitting normally applies it.
//
// Platform notes:
//   - Linux AppImage and Windows NSIS support in-place auto-update.
//   - The Windows *portable* artifact does NOT — electron-updater logs an error
//     and no-ops there. That is expected; NSIS is the updatable Windows path.
//   - Dev / unpackaged runs have no app-update.yml, so checks are skipped.

import { app, Notification } from 'electron'
import type { BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import log from '@main/log'

// Re-check this often while the widget stays open (always-on app → poll).
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

let initialized = false
let intervalId: ReturnType<typeof setInterval> | undefined

/**
 * Wire and start the auto-updater. Idempotent and safe to call unconditionally —
 * it no-ops on unpackaged (dev) runs where update metadata is absent.
 *
 * @param _win reserved for future renderer-facing update UI (progress/prompt).
 */
export function initUpdater(_win: BrowserWindow): void {
  if (initialized) return

  if (!app.isPackaged) {
    log.info('updater: skipped — app is not packaged (no update metadata in dev)')
    return
  }

  initialized = true

  // electron-updater is CommonJS; reach `autoUpdater` via the default interop
  // object. Access is deferred to here (not module top-level) because the
  // `autoUpdater` getter eagerly constructs the updater and calls
  // `app.getVersion()` — doing that at import time crashes unpackaged/test runs.
  const { autoUpdater } = electronUpdater

  // Route electron-updater's own logging through electron-log.
  autoUpdater.logger = log
  // Background download as soon as an update is found; install on quit.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => log.info('updater: checking for update'))
  autoUpdater.on('update-available', (info) =>
    log.info(`updater: update available — ${info.version} (downloading)`),
  )
  autoUpdater.on('update-not-available', () => log.info('updater: no update available'))
  autoUpdater.on('download-progress', (p) =>
    log.info(`updater: downloading ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`),
  )
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`updater: update ${info.version} downloaded — will install on quit`)
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'DewTime update ready',
        body: `Version ${info.version} will be installed when you quit DewTime.`,
      })
      n.show()
    }
  })
  autoUpdater.on('error', (err) =>
    // Errors here are non-fatal (offline, portable target, rate-limit, etc.) —
    // log and keep running; the next interval check retries.
    log.warn(`updater: ${err?.message ?? err}`),
  )

  void autoUpdater.checkForUpdates()
  intervalId = setInterval(() => void autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS)
}

/** Stop the periodic check (used on shutdown / tests). */
export function stopUpdater(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = undefined
  }
  initialized = false
}
