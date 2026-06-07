// src/main/services/updater.ts
//
// Auto-update via electron-updater against the GitHub Releases publish target
// configured in electron-builder.yml (provider: github). The release workflow
// uploads latest*.yml / *.blockmap alongside each artifact, which is the
// metadata electron-updater reads to decide whether a newer version exists.
//
// Behavior: approve → download → auto-restart. On a packaged app, check on boot
// and then on a fixed interval (gated by settings.auto_update). When an update
// is found, a native OS dialog asks the user to approve before anything downloads.
// On approval the update downloads and the app restarts/installs automatically —
// no second prompt. On "Later" nothing downloads or installs.
//
// Platform notes:
//   - Linux AppImage and Windows NSIS support in-place auto-update.
//   - The Windows *portable* artifact does NOT — electron-updater logs an error
//     and no-ops there. That is expected; NSIS is the updatable Windows path.
//   - Dev / unpackaged runs have no app-update.yml, so checks are skipped.

import { app, dialog } from 'electron'
import type { BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import log from '@main/log'
import type { UpdateCheckResult } from '@shared/contracts/updates'

// Re-check this often while the widget stays open (always-on app → poll).
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

let initialized = false
let intervalId: ReturnType<typeof setInterval> | undefined

// `win` anchors the native dialog to the main BrowserWindow.
let win: BrowserWindow | undefined

// Guards listener registration — distinct from `initialized` which gates the
// automatic boot/interval path. `wired` ensures we never double-register
// event handlers even when manual checks run before automatic checks.
let wired = false

/**
 * Wire autoUpdater config + event listeners EXACTLY ONCE.
 * Idempotent — safe to call from both initUpdater (automatic path) and
 * checkForUpdatesManual (manual path). The shared `update-available` listener
 * drives the native approval dialog for both paths.
 */
function wireUpdater(): void {
  if (wired) return
  wired = true

  // electron-updater is CommonJS; reach `autoUpdater` via the default interop
  // object. Access is deferred to here (not module top-level) because the
  // `autoUpdater` getter eagerly constructs the updater and calls
  // `app.getVersion()` — doing that at import time crashes unpackaged/test runs.
  const { autoUpdater } = electronUpdater

  // Route electron-updater's own logging through electron-log.
  autoUpdater.logger = log

  // D-01: Approval flow — disable auto-download; user must approve via native dialog.
  autoUpdater.autoDownload = false
  // Once downloaded, install on quit automatically (no second prompt per D-01).
  autoUpdater.autoInstallOnAppQuit = true

  // DO NOT set allowPrerelease / channel / setFeedURL — leave discovery config
  // exactly as-is to avoid regressing update discovery.

  autoUpdater.on('checking-for-update', () => log.info('updater: checking for update'))

  // Shared handler for both automatic and manual checks (D-01).
  // Shows native OS dialog; approve → downloadUpdate, Later → no-op (D-02).
  autoUpdater.on('update-available', (info) => {
    log.info(`updater: update available — ${info.version}`)

    const parentWin = win !== undefined && !win.isDestroyed() ? win : undefined
    void dialog
      .showMessageBox(parentWin as BrowserWindow, {
        type: 'info',
        buttons: ['Download & Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'DewTime update',
        message: `Version ${info.version} is available.`,
        detail: 'Download it now and restart to apply?',
      })
      .then(({ response }) => {
        if (response === 0) {
          log.info('updater: user approved download')
          void autoUpdater.downloadUpdate()
        } else {
          log.info('updater: user deferred update')
        }
      })
  })

  autoUpdater.on('update-not-available', () => log.info('updater: no update available'))

  autoUpdater.on('download-progress', (p) =>
    log.info(
      `updater: downloading ${Math.round(p.percent)}% (${Math.round(p.bytesPerSecond / 1024)} KB/s)`,
    ),
  )

  // D-01: On download complete, auto-restart — no second prompt.
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`updater: update ${info.version} downloaded — restarting now`)
    autoUpdater.quitAndInstall()
  })

  autoUpdater.on('error', (err) =>
    // Errors here are non-fatal (offline, portable target, rate-limit, etc.) —
    // log and keep running; the next interval check retries.
    log.warn(`updater: ${err?.message ?? err}`),
  )
}

/**
 * Wire and start the automatic auto-updater. Idempotent and safe to call
 * unconditionally — it no-ops on unpackaged (dev) runs where update metadata
 * is absent. Gated by the caller on settings.auto_update.
 *
 * @param w the main BrowserWindow (anchors the native approval dialog).
 */
export function initUpdater(w: BrowserWindow): void {
  win = w

  if (!app.isPackaged) {
    log.info('updater: skipped — app is not packaged (no update metadata in dev)')
    return
  }

  if (initialized) return
  initialized = true

  wireUpdater()

  void electronUpdater.autoUpdater.checkForUpdates()
  intervalId = setInterval(() => void electronUpdater.autoUpdater.checkForUpdates(), CHECK_INTERVAL_MS)
}

/**
 * Perform a manual update check. Works regardless of settings.auto_update (D-04).
 * Returns a status object — the native download/approval dialog is driven by
 * the shared update-available listener (not this function directly).
 *
 * Returns 'unsupported' in dev/unpackaged runs (safe no-op).
 */
export async function checkForUpdatesManual(): Promise<UpdateCheckResult> {
  if (!app.isPackaged) {
    return { status: 'unsupported' }
  }

  // Ensure the shared approval dialog listener is wired even when automatic
  // updates are off (i.e., initUpdater was never called).
  wireUpdater()

  try {
    const result = await electronUpdater.autoUpdater.checkForUpdates()
    if (result?.isUpdateAvailable) {
      return { status: 'available', version: result.updateInfo.version }
    }
    return { status: 'up-to-date' }
  } catch (err) {
    log.warn(`updater: manual check error — ${(err as Error)?.message ?? err}`)
    return { status: 'error' }
  }
}

/** Stop the periodic check (used on shutdown / tests). */
export function stopUpdater(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = undefined
  }
  initialized = false
  // Do NOT reset `wired` — leave the shared listeners registered so a later
  // manual check still works (re-registration is guarded by `wired`).
}
