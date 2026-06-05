// src/main/index.ts
// Electron main-process entry. Boots in this order:
//
//   1. app.whenReady()        — Electron's app singleton is fully initialized
//   2. initDb()               — open SQLite singleton (idempotent)
//   3. runMigrations()        — apply any pending migrations
//   4. TIMERZ_SMOKE branch    — if set, run headless DB smoke and exit
//   5. powerMonitor.on(...)   — register the 'resume' listener BEFORE handlers
//                                so a system wake during handler registration
//                                can still re-arm the heartbeat (D-09).
//   6. checkResume()          — seed the cached ResumeResult so the renderer's
//                                first IPC call hits a populated cache (D-14;
//                                RESEARCH § Pitfall 4).
//   7. registerAllHandlers()  — wire ipcMain.handle for every namespace
//   8. createWindow()         — open the BrowserWindow with locked-down
//                                webPreferences (T-01-01 / DATA-02)
//
// Refs:
//   - 01-04-PLAN.md Task 3 <action>
//   - CONTEXT.md DATA-02 (contextIsolation + nodeIntegration:false + sandbox)
//   - CONTEXT.md D-11 (DB path via app.getPath('userData'))
//   - CONTEXT.md D-19 (TIMERZ_SMOKE=1 headless smoke for plan 05)
//   - RESEARCH.md §2 lines ~483-503 (import-order constraint — initDb BEFORE
//     any module that statically imports a repository or IPC handler)
//   - RESEARCH.md §5 lines ~933-967 (webPreferences flag rationale)
//   - threat model T-01-01 (locked-down webPreferences)
//   - threat model T-01-04 (parameterised SQL — smoke uses ? placeholders)

import { app, BrowserWindow, powerMonitor } from 'electron'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { initDb, getDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import log from '@main/log'
// Phase 2 boot wiring (02-04 / D-09 + D-14):
//   - powerMonitor.on('resume', ...) hard-restarts the heartbeat after a
//     system wake (RESEARCH § Pattern 4 + § Pitfall 2 — setInterval across
//     system sleep is unreliable; the safe pattern is clearInterval +
//     setInterval, which is what `heartbeat.startHeartbeat()` does).
//   - timerService.checkResume() runs BEFORE registerAllHandlers + createWindow
//     so the renderer's first paint sees the cached ResumeResult on first IPC
//     call (D-14; RESEARCH § Pitfall 4).
import * as timerService from '@main/services/timer'
import { startHeartbeat, stopHeartbeat } from '@main/services/heartbeat'
// Phase 3 boot wiring (Plan 03-04 / D-11):
//   - windowGeometry.readSavedBounds() runs BEFORE createWindow so the
//     constructor receives the clamped saved x/y/width/height (or omitted
//     x/y on first launch → Electron centers).
//   - windowGeometry.attachListeners(win) runs AFTER createWindow so the
//     'moved' / 'resized' / 'close' listeners are bound to the live window.
import * as windowGeometry from '@main/services/window-geometry'
// Phase 4 (Plan 04-05 / D-11 / 04-CONTEXT D-11):
//   - tickService.emitNow() is called in the powerMonitor.on('resume') handler
//     AFTER checkResume() so the renderer receives one immediate tick:update
//     after sleep/wake without waiting for the next 1 s interval. The tick
//     module's interval lifecycle (start/stop) is managed by TimerService at the
//     FSM hook points (timer.ts start/stopActive/stop/deleteTimer → tickService.start/stop);
//     runMain does NOT call tickService.start() directly — the interval is
//     FSM-driven, not boot-driven (D-06).
import * as tickService from '@main/services/tick'

// Env-gated Chromium process-sandbox opt-out for local dev hosts where the
// kernel namespace sandbox is unavailable AND the SUID chrome-sandbox binary
// is not root-owned (typical after `npm install` extracts it unprivileged on
// Linux). When TIMERZ_NO_SANDBOX=1 is set we disable Chromium's OS process
// sandbox via the documented command-line switch.
//
// Threat-model justification (T-01-01 / DATA-02 still hold):
//   - DewTime is a local single-user desktop app per PROJECT.md
//   - The renderer loads ONLY locally-bundled HTML/JS — no remote URLs,
//     no user-supplied content
//   - `webPreferences.sandbox: true` (renderer-level isolation), plus
//     `contextIsolation: true` + `nodeIntegration: false`, stay enforced
//     regardless of this switch; only the OS process-sandbox layer is
//     dropped
//   - Acceptable tradeoff for dev hosts; production packaging should rely
//     on user namespaces or a properly-installed SUID helper
//
// MUST run BEFORE app.whenReady() to take effect on Electron 38.
if (process.env['TIMERZ_NO_SANDBOX'] === '1') {
  app.commandLine.appendSwitch('no-sandbox')
}

// In ESM, `__dirname` does not exist — derive it from import.meta.url. The
// electron-vite main bundle emits ESM (`.mjs`), so this is the canonical
// pattern for resolving sibling-bundle paths (out/main/index.mjs ↔
// out/preload/index.mjs).
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Optional `bounds` argument shape passed to `createWindow` by Phase 3's
 * runMain (after `windowGeometry.readSavedBounds()` resolves). All four
 * fields are optional — when `x`/`y` are omitted, Electron centers the
 * window on first launch (D-12 fallback in window-geometry.ts).
 */
export interface CreateWindowBounds {
  x?: number
  y?: number
  width?: number
  height?: number
}

/**
 * Construct the renderer's BrowserWindow with security-hardened webPreferences
 * AND the Phase 3 frameless / always-on-top / locked-min-size chrome.
 *
 * SECURITY POSTURE (T-01-01 + DATA-02 — Phase 1 carry-forward, UNCHANGED):
 *   - contextIsolation: true            isolated worlds for main+preload+renderer
 *   - nodeIntegration: false            renderer cannot require('fs') / etc.
 *   - sandbox: true                     OS-level v8 sandbox for renderer
 *   - webSecurity: true                 same-origin policy, no file:// bypass
 *   - allowRunningInsecureContent: false no mixed-content downgrade in renderer
 *   - preload                           points at the BUILT bundle, not source
 *
 * FRAMELESS CHROME (Phase 3 — D-01..D-04, WIN-01/02/05/07):
 *   - frame: false                      no native title bar; renderer paints chrome
 *   - transparent: false                solid background → native OS edge-resize
 *                                       works automatically (Pitfall 3); no
 *                                       custom CSS resize handles needed
 *   - alwaysOnTop: true                 widget-style stay-on-top behaviour;
 *                                       on darwin we also call setAlwaysOnTop(
 *                                       true, 'floating') so the window sits
 *                                       above fullscreen apps (D-02; AP-10
 *                                       forbids 'floating' on linux/win32)
 *   - minWidth: 500 / minHeight: 350    sane minimum the layout still fits
 *   - useContentSize: false             width/height are the OUTER window size;
 *                                       the renderer DOM measures its own
 *                                       client area
 *   - autoHideMenuBar: true             no native menubar (we render none)
 *   - backgroundColor: '#181b21'        hex equivalent of --color-bg
 *                                       (hsl(220 13% 11%)) — see
 *                                       .planning/phases/03-frameless-window-settings/03-UI-SPEC.md
 *                                       § Window restore visual moment. Paints
 *                                       this colour BEFORE the renderer mounts
 *                                       so launch + restore-from-minimize do
 *                                       not flash white (UI-SPEC anti-pattern
 *                                       A-11).
 *
 * BOUNDS (Phase 3 — D-09..D-12 via plan 03-02 readSavedBounds):
 *   - Caller passes `bounds` from `windowGeometry.readSavedBounds()`. When the
 *     saved row is missing / corrupt / off-screen, the service strips x/y so
 *     Electron centers; `width`/`height` always carry sane values.
 *   - width/height default to 800/600 (matches v1 baseline + WIN-05).
 *   - x/y are spread conditionally — omitting them tells Electron to center.
 *
 * Exported (not inlined inside `runMain`) so `index.test.ts` can call it
 * directly and assert on the `BrowserWindow` constructor spy.
 *
 * @param opts.bounds optional saved geometry from plan 03-02. Defaults to
 *                    `{}` so legacy zero-arg callers (the T-01-01 test) still
 *                    compile.
 * @returns the constructed BrowserWindow handle
 */
/**
 * Resolve the app icon for the running window. Windows embeds its icon in the
 * .exe and macOS uses the bundle .icns, so `BrowserWindow.icon` mainly affects
 * Linux (window decoration + taskbar) and dev runs — but passing it everywhere
 * is harmless.
 *
 * - Packaged: electron-builder copies build/icon.png to resources/icon.png via
 *   `extraResources` (electron-builder.yml), so it lives at
 *   `process.resourcesPath/icon.png`.
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
    alwaysOnTop: true,
    autoHideMenuBar: true,
    // Set the running-window icon (Linux window/taskbar + dev). Spread only when
    // resolved so a missing file leaves Electron's default untouched.
    ...(icon ? { icon } : {}),
    // hex equivalent of --color-bg (hsl(220 13% 11%)) — see
    // .planning/phases/03-frameless-window-settings/03-UI-SPEC.md § Window
    // restore visual moment. UI-SPEC anti-pattern A-11 forbids drift from
    // this literal; the Phase 3 test (WIN-07) pins the exact value.
    backgroundColor: '#181b21',
    show: false, // wait for 'ready-to-show' to avoid white-flash on launch
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // electron-vite emits the preload bundle to out/preload/index.cjs
      // (CJS is mandatory under sandbox: true — Electron docs:
      // electronjs.org/docs/latest/tutorial/sandbox#preload). Main entry
      // sits at out/main/index.mjs, so the relative is one up.
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
  })

  // macOS-only: bump alwaysOnTop to the 'floating' level so the window sits
  // above other always-on-top windows AND above fullscreen apps. Electron's
  // 'floating' argument is darwin-only — calling it on linux/win32 throws
  // (RESEARCH § Pattern 2 / AP-10). The constructor's `alwaysOnTop: true`
  // already covers the cross-platform case; this is the darwin upgrade.
  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'floating')
  }

  // In dev (`npm run dev`) electron-vite sets ELECTRON_RENDERER_URL to the
  // Vite dev server (http://localhost:5173 by default). In packaged builds
  // load the static HTML from disk.
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  win.once('ready-to-show', () => win.show())
  return win
}

/**
 * Headless DB smoke. Used by the `TIMERZ_SMOKE=1` branch below; the logic
 * is exported so plan 05's packaged-binary smoke script (or this plan's
 * tests) can invoke it without going through the main entry.
 *
 * The smoke writes a single 'smoke' probe row to the projects table,
 * SELECTs it back, DELETEs it, then COUNTs the remaining rows. A clean
 * DB returns 0; a corrupt DB returns nonzero or throws.
 *
 * All SQL uses `?` placeholders OR hardcoded string literals (no
 * template-string interpolation of user input — T-01-04 mitigation).
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
 * Application entry. Exported so `index.test.ts` can call it directly with
 * `TIMERZ_SMOKE=1` set; the bottom-of-file self-invoke is guarded by
 * `NODE_ENV !== 'test'` so tests can opt out cleanly.
 *
 * IMPORT-ORDER CONSTRAINT (RESEARCH.md §2 lines ~485-503):
 *   `registerAllHandlers` indirectly imports the projects repository, which
 *   calls `getDb()` lazily inside `getStmts()`. As long as `initDb()` runs
 *   BEFORE any handler ever fires, this is safe — but we further hedge by
 *   importing the IPC module DYNAMICALLY after `initDb()` resolves, so the
 *   side-effect of module loading (cache setup, etc.) cannot run too early.
 *
 * Phase 2 inserts powerMonitor.on('resume') + checkResume() BETWEEN the SMOKE
 * branch and registerAllHandlers — see 02-CONTEXT.md D-14 (boot order is
 * non-negotiable). The renderer's first IPC call may land within milliseconds
 * of createWindow(), and `timeEntries.checkResume()` (Plan 02-05) returns the
 * cached result populated here — running checkResume() AFTER registerAllHandlers
 * would leave the cache empty for that first call (see RESEARCH § Pitfall 4).
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
      // Surface to BOTH stderr and the structured log so CI can capture
      // either stream. Exit code 2 distinguishes "smoke ran but failed"
      // from "something else made the process die".
      console.error('SMOKE_FAIL', e)
      app.exit(2)
    }
    return
  }

  // ---------------------------------------------------------------------------
  // Phase 2 boot block (Plan 02-04). Order is NON-NEGOTIABLE per 02-CONTEXT.md
  // D-14 + 02-RESEARCH.md § Pattern 4 + § Pitfall 4:
  //
  //   a. Register `powerMonitor.on('resume', ...)` exactly once. The listener
  //      hard-restarts the heartbeat after a system wake — Electron 38
  //      includes PR-40888 (lazy Bluez init on Linux) so this is safe to call
  //      both before and after app.whenReady; we keep it after to mirror v1's
  //      QtScheduler-after-QApplication pattern and to be safe under any
  //      Electron downgrade (RESEARCH § Pitfall 7 + § Section 1).
  //   b. Call `timerService.checkResume()` to populate the module-scoped
  //      `lastResumeResult` cache. The renderer's first IPC call hits this
  //      cache via `timeEntries.checkResume()` (Plan 02-05) — running this
  //      AFTER registerAllHandlers leaves the cache `undefined` for that
  //      first call (the defensive fallback in `getCachedResumeResult` would
  //      then re-run, but it logs at `error` — we want a clean boot).
  //   c. If a running entry survived restart, start the heartbeat so we do
  //      not keep classifying ourselves as crashed (RESEARCH § Pattern 4
  //      lines 472-474).
  // ---------------------------------------------------------------------------
  powerMonitor.on('resume', () => {
    log.info('powerMonitor: resume — restarting heartbeat + immediate tick:update (D-11)')
    // Phase 2: re-arm the heartbeat after a system wake so the next checkResume
    // does not false-positive as a crash (RESEARCH § Pattern 4).
    stopHeartbeat()
    startHeartbeat()
    // Phase 4 (D-11 / 04-CONTEXT D-11): fire an immediate tick:update so the
    // renderer sees the post-resume elapsed time without waiting for the next
    // 1 s interval. If no timer is running, emitNow() is a no-op (tick.ts
    // emit() guards against null running entry). MUST run AFTER checkResume()
    // (which runs once at boot, above this handler) so the classification is
    // already cached — this one-liner does NOT re-run checkResume().
    tickService.emitNow()
  })

  const resumeResult = timerService.checkResume()
  if (resumeResult) {
    log.info(
      `boot: resume detected entry_id=${resumeResult.entry.id} ` +
        `clean=${resumeResult.isCleanResume}`,
    )
    // A running entry survived the restart — re-arm the heartbeat so the next
    // checkResume call (e.g., after a sleep/wake cycle) does not re-classify
    // us as crashed simply because we never wrote a fresh heartbeat post-boot.
    startHeartbeat()
    // Phase 4: also start the tick service so DurationCell sees per-second
    // updates from boot. Without this, the renderer's `useTickStore.tick` stays
    // null after a restart-with-running-timer, and DurationCell falls back to
    // the static `timer.totalSeconds` from the last useTimers query refetch —
    // the user sees the play button correctly highlighted but the duration
    // appears frozen until they stop+start. tickService.emit() lazily resolves
    // BrowserWindow.getAllWindows()[0] each tick, so it is safe to call before
    // createWindow() — early emits no-op until the window mounts.
    tickService.start()
  }

  // ---------------------------------------------------------------------------
  // Phase 3 boot block (Plan 03-04 / D-11). Order is NON-NEGOTIABLE per
  // 03-CONTEXT.md D-11 + 03-VALIDATION static awk gates:
  //
  //   readSavedBounds → registerAllHandlers → createWindow(savedBounds)
  //                                                → attachListeners(win)
  //
  //   - readSavedBounds() reads the composite `settings.window_geometry` row
  //     and clamps against live `screen.getAllDisplays()` workAreas. The
  //     row is seeded by migration 002, so by the time runMain reaches here
  //     (initDb + runMigrations already ran) the row is guaranteed present.
  //     Pitfall 10: readSavedBounds also calls `screen.getAllDisplays`, which
  //     requires `app.whenReady()` — already awaited at the top of runMain.
  //   - attachListeners(win) MUST run AFTER createWindow so we have a live
  //     BrowserWindow handle to bind 'moved' / 'resized' / 'close' on. The
  //     'close' listener flushes any pending debounced write so the user's
  //     last drag persists across shutdown (AP-08).
  // ---------------------------------------------------------------------------
  const savedBounds = windowGeometry.readSavedBounds()
  log.info(`boot: saved window bounds = ${JSON.stringify(savedBounds)}`)

  // Dynamic import: defers registration of IPC handler module side effects
  // until AFTER initDb() returns. See RESEARCH.md §2 lines ~485-503.
  const { registerAllHandlers } = await import('@main/ipc')
  registerAllHandlers()

  log.info('main process ready; opening BrowserWindow')
  const win = createWindow({ bounds: savedBounds })

  // D-10: bind moved/resized (debounced) + close (flush) on the live window.
  // Idempotent — service detaches any prior window before binding the new one.
  windowGeometry.attachListeners(win)

  app.on('window-all-closed', () => {
    // macOS convention: apps stay alive when all windows close. Not strictly
    // needed for Phase 1 (we ship Win + Linux per electron-builder.yml), but
    // matches Electron docs and is the canonical platform check.
    if (process.platform !== 'darwin') app.quit()
  })
}

// Bottom-of-file self-invoke — but NOT under NODE_ENV=test so `index.test.ts`
// can import this module without triggering app.whenReady() implicitly.
if (process.env['NODE_ENV'] !== 'test') {
  runMain().catch((e) => {
    log.error('runMain failed', e)
    app.exit(1)
  })
}
