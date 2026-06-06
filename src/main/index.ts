// Electron main-process entry. Boot order:
//
//   1. app.whenReady()        — Electron app singleton fully initialized
//   2. initDb()               — open SQLite singleton (idempotent)
//   3. runMigrations()        — apply any pending migrations
//   4. TIMERZ_SMOKE branch    — if set, run headless DB smoke and exit
//   5. powerMonitor.on(...)   — register 'resume' listener BEFORE handlers
//                                so a system wake can still re-arm the heartbeat
//   6. checkResume()          — seed the cached ResumeResult so the renderer's
//                                first IPC call hits a populated cache
//   7. registerAllHandlers()  — wire ipcMain.handle for every namespace
//   8. createWindow()         — open the BrowserWindow

import { app, BrowserWindow, powerMonitor } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initDb, getDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import log from '@main/log'
// powerMonitor.on('resume') hard-restarts the heartbeat after a system wake
// (setInterval across system sleep is unreliable; clearInterval+setInterval
// is the safe pattern, which startHeartbeat() uses).
// timerService.checkResume() runs BEFORE registerAllHandlers + createWindow
// so the renderer's first IPC call hits a populated cache.
import * as timerService from '@main/services/timer'
import { startHeartbeat, stopHeartbeat } from '@main/services/heartbeat'
// windowGeometry.readSavedBounds() runs BEFORE createWindow so the constructor
// receives saved x/y/width/height (or omitted x/y on first launch → Electron
// centers). attachListeners(win) runs AFTER createWindow.
import * as windowGeometry from '@main/services/window-geometry'
// initUpdater no-ops on unpackaged dev runs; safe to call unconditionally.
import { initUpdater } from '@main/services/updater'
import * as settingsRepo from '@main/db/repositories/settings'
// tickService.emitNow() fires an immediate tick:update after sleep/wake so
// the renderer doesn't wait for the next 1 s interval.
import * as tickService from '@main/services/tick'

// Opt-out of the Chromium OS-process sandbox for dev hosts where the kernel
// namespace sandbox is unavailable and the SUID chrome-sandbox binary is not
// root-owned. `webPreferences.sandbox: true`, `contextIsolation: true`, and
// `nodeIntegration: false` stay enforced regardless — only the OS-level layer
// is dropped. MUST run BEFORE app.whenReady() to take effect on Electron 38.
if (process.env['TIMERZ_NO_SANDBOX'] === '1') {
  app.commandLine.appendSwitch('no-sandbox')
}

// In ESM `__dirname` does not exist — derive it from import.meta.url.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Optional bounds argument passed to `createWindow`. All four fields are
 * optional — when `x`/`y` are omitted, Electron centers the window on first
 * launch.
 */
export interface CreateWindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

/**
 * Resolve the app icon for the running window. Windows embeds its icon in the
 * .exe and macOS uses the bundle .icns, so `BrowserWindow.icon` mainly affects
 * Linux (window decoration + taskbar) and dev runs.
 *
 * - Packaged: electron-builder copies build/icon.png to resources/icon.png via
 *   `extraResources`, so it lives at `process.resourcesPath/icon.png`.
 * - Dev: the bundle runs from `out/main`, so the repo's `build/icon.png` is two
 *   levels up.
 *
 * Returns undefined when the file is absent so a missing icon never blocks
 * window creation.
 */
function resolveWindowIcon(): string | undefined {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../../build/icon.png')
  return existsSync(candidate) ? candidate : undefined
}

export function createWindow(
  opts: { bounds?: CreateWindowBounds } = { bounds: {} },
): BrowserWindow {
  const b = opts.bounds ?? {}
  const icon = resolveWindowIcon()

  // Read the persisted always_on_top preference at boot time.
  // Mirrors the window-geometry pattern: try/catch returning false on
  // NotFoundError (safe before migration 003 seed, defensive at boot).
  let alwaysOnTop = false
  try {
    alwaysOnTop = settingsRepo.get('settings.always_on_top')
  } catch {
    // NotFoundError before migration 003 seed runs — default to windowed.
    alwaysOnTop = false
  }

  const win = new BrowserWindow({
    width: b.width ?? 800,
    height: b.height ?? 600,
    // Spread x/y only when BOTH are defined — partial position would land the
    // window at (x, 0) or (0, y) which is almost always wrong on multi-monitor.
    ...(b.x !== undefined && b.y !== undefined ? { x: b.x, y: b.y } : {}),
    minWidth: 500,
    minHeight: 350,
    useContentSize: false,
    frame: false,
    transparent: false,
    alwaysOnTop,
    autoHideMenuBar: true,
    // Set the running-window icon (Linux window/taskbar + dev). Spread only when
    // resolved so a missing file leaves Electron's default untouched.
    ...(icon ? { icon } : {}),
    // Hex equivalent of --color-bg (hsl(220 13% 11%)). Paints before the
    // renderer mounts so launch and restore-from-minimize don't flash white.
    backgroundColor: '#181b21',
    show: false, // wait for 'ready-to-show' to avoid white-flash on launch
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // CJS is mandatory under sandbox: true (Electron requirement).
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
  })

  // macOS-only: bump alwaysOnTop to 'floating' so the window sits above other
  // always-on-top windows and above fullscreen apps. The 'floating' argument
  // is darwin-only — calling it on linux/win32 throws; `alwaysOnTop: true`
  // in the constructor already covers the cross-platform case.
  // Only fire when the setting is enabled — no-op when windowed (default).
  if (process.platform === 'darwin' && alwaysOnTop) {
    win.setAlwaysOnTop(true, 'floating')
  }

  // In dev, electron-vite sets ELECTRON_RENDERER_URL to the Vite dev server.
  // In packaged builds, load the static HTML from disk.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.once('ready-to-show', () => win.show())
  return win
}

/**
 * Headless DB smoke. Exported so tests can invoke it without going through
 * the main entry. Writes a probe row, SELECTs it back, DELETEs it, then
 * COUNTs remaining rows. A clean DB returns 0; corrupt DB returns nonzero
 * or throws. All SQL uses `?` placeholders or hardcoded literals.
 */
function runDbSmoke(): { rowCount: number } {
  const db = getDb()
  db.prepare('INSERT INTO projects (project_name) VALUES (?)').run('smoke')
  const row = db
    .prepare("SELECT id FROM projects WHERE project_name = 'smoke'")
    .get()
  if (!row) {
    throw new Error('smoke row not readable')
  }
  db.prepare("DELETE FROM projects WHERE project_name = 'smoke'").run()
  const n = (
    db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }
  ).n
  return { rowCount: n }
}

/**
 * Application entry. Exported so `index.test.ts` can call it directly;
 * the bottom-of-file self-invoke is guarded by `NODE_ENV !== 'test'`.
 *
 * The IPC module is imported DYNAMICALLY after `initDb()` resolves so its
 * module-level side effects (lazy stmt caches) cannot run before the DB is
 * open. `checkResume()` runs BEFORE `registerAllHandlers` so the renderer's
 * first IPC call hits a populated cache rather than triggering a defensive
 * re-run.
 */
export async function runMain(): Promise<void> {
  await app.whenReady()
  initDb()
  runMigrations()

  if (process.env['TIMERZ_SMOKE'] === '1') {
    try {
      const { rowCount } = runDbSmoke()
      console.log(`SMOKE_OK rowCount=${rowCount}`)
      app.exit(0)
    } catch (e) {
      // Exit code 2 distinguishes "smoke ran but failed" from process crashes.
      console.error('SMOKE_FAIL', e)
      app.exit(2)
    }
    return
  }

  powerMonitor.on('resume', () => {
    log.info('powerMonitor: resume — restarting heartbeat + immediate tick:update')
    // Re-arm the heartbeat after a system wake so the next checkResume does
    // not false-positive as a crash.
    stopHeartbeat()
    startHeartbeat()
    // Fire an immediate tick:update so the renderer sees the post-resume
    // elapsed time without waiting for the next 1 s interval. emitNow() is
    // a no-op when no timer is running.
    tickService.emitNow()
  })

  const resumeResult = timerService.checkResume()
  if (resumeResult) {
    log.info(
      `boot: resume detected entry_id=${resumeResult.entry.id} ` +
        `clean=${resumeResult.isCleanResume}`,
    )
    // Re-arm the heartbeat so the next checkResume (e.g. after sleep/wake)
    // does not re-classify us as crashed.
    startHeartbeat()
    // Start the tick service so DurationCell sees per-second updates from boot.
    // Without this, the duration appears frozen after a restart-with-running-timer
    // until the user stops and starts again.
    // tickService.emit() lazily resolves BrowserWindow.getAllWindows()[0] each
    // tick, so it is safe to call before createWindow() — early emits no-op.
    tickService.start()
  }

  // readSavedBounds() reads `settings.window_geometry` and clamps against live
  // screen workAreas. Requires app.whenReady() (already awaited above).
  // attachListeners(win) MUST run AFTER createWindow — it binds 'moved',
  // 'resized', and 'close' on the live handle; 'close' flushes any pending
  // debounced write so the last drag position persists across shutdown.
  const savedBounds = windowGeometry.readSavedBounds()
  log.info(`boot: saved window bounds = ${JSON.stringify(savedBounds)}`)

  // Dynamic import: defers IPC handler module side effects until after initDb().
  const { registerAllHandlers } = await import('@main/ipc')
  registerAllHandlers()

  log.info('main process ready; opening BrowserWindow')
  const win = createWindow({ bounds: savedBounds })

  windowGeometry.attachListeners(win)

  // Start auto-update checks (no-ops in dev/unpackaged builds).
  initUpdater(win)

  app.on('window-all-closed', () => {
    // macOS convention: apps stay alive when all windows close.
    if (process.platform !== 'darwin') app.quit()
  })
}

// Self-invoke, skipped under NODE_ENV=test so tests can import without
// triggering app.whenReady() implicitly.
if (process.env['NODE_ENV'] !== 'test') {
  runMain().catch((e) => {
    log.error('runMain failed', e)
    app.exit(1)
  })
}
