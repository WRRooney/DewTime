// src/main/services/window-geometry.ts
// WindowGeometryService — pure-function module that owns reading, clamping,
// debouncing, and writing the composite `settings.window_geometry` row.
//
// Boot path (consumed by plan 03-04's runMain):
//   1. runMain() calls `readSavedBounds()` BEFORE createWindow — clamps the
//      saved x/y against the live `screen.getAllDisplays()` workAreas; returns
//      constructor-friendly bounds (omits x/y on first launch so Electron
//      centers).
//   2. createWindow uses the returned bounds.
//   3. runMain() calls `attachListeners(win)` AFTER createWindow returns —
//      wires 'moved', 'resized', and 'close' to the debounce/flush surface.
//
// Write path:
//   - win.on('moved') and win.on('resized') both call `scheduleWrite()`.
//   - scheduleWrite clears the pending timer and starts a fresh 250 ms timer
//     (D-10). Single shared timer between both events (RESEARCH § Pitfall 1
//     / AP-01): a continuous drag fires many 'moved' AND many 1-px-oscillation
//     'resized' events (Electron #28134), so two separate timers would write
//     twice per cycle.
//   - On fire: read getBounds() once and persist via settingsRepo.set(...).
//   - On win.on('close'): flushPendingWrite() runs synchronously so the last
//     drag persists even though the process is shutting down (AP-08).
//
// Pure functions only (D-01 carry-forward from Phase 2) — no class
// WindowGeometryService, no DI. Module-scoped state (`pendingTimer`,
// `attachedWindow`) is wiped by the exported `resetForTests()` (AP-16); tests
// call it in `beforeEach` and `afterEach`.
//
// Refs:
//   - 03-CONTEXT.md D-09 (composite JSON key `settings.window_geometry`)
//   - 03-CONTEXT.md D-10 (250 ms debounce; final flush on close)
//   - 03-CONTEXT.md D-11 (boot order: read geometry BEFORE createWindow;
//     attach listeners AFTER createWindow)
//   - 03-CONTEXT.md D-12 (clamp via screen.getAllDisplays() workAreas;
//     fall back to centered when offscreen)
//   - 03-CONTEXT.md D-19 (service-mediator pattern: service composes the
//     repository, the IPC handler need not know about debouncing)
//   - 03-RESEARCH.md § Pattern 3 (full source template — implemented verbatim)
//   - 03-RESEARCH.md § Pitfall 1 (single shared timer for moved+resized)
//   - 03-RESEARCH.md § Pitfall 2 (Chromium 1-px-resize-during-move oscillation
//     — composite-write debounce solves this; do NOT use two separate timers)
//   - 03-RESEARCH.md § Pitfall 4 (resetForTests must detach listeners)
//   - 03-RESEARCH.md § Pitfall 6 (Linux 'moved' undocumented — debounce is
//     the contract, not the native event timing)
//   - 03-RESEARCH.md § Pitfall 10 (mock electron.screen in tests)
//   - 03-RESEARCH.md § Anti-patterns AP-01, AP-08, AP-16

import { screen, type BrowserWindow, type Rectangle } from 'electron'
import * as settingsRepo from '@main/db/repositories/settings'
import log from '@main/log'
import type { WindowGeometry } from '@shared/ipc'

/**
 * Debounce interval in milliseconds for 'moved' + 'resized' writes (D-10).
 * Exported as a named constant — never a magic number. Tests assert
 * `vi.advanceTimersByTime(GEOMETRY_DEBOUNCE_MS)` against the exact value so
 * a future bump (e.g., to 500 ms) does not silently break the contract.
 */
export const GEOMETRY_DEBOUNCE_MS = 250

/**
 * Slack pixels added to each side of every display's workArea when checking
 * whether a saved (x, y) point is "visible". Tolerates minor monitor-layout
 * drift across reboots (e.g., the user dragged the secondary monitor 10 px in
 * their OS display settings since last launch — the saved bounds still feel
 * "the same place"). 50 px is the locked CONTEXT D-12 value.
 */
const MIN_VISIBLE_SLACK_PX = 50

/**
 * Default width / height when no saved row exists or the saved bounds are
 * unreachable. Mirrors `BrowserWindow` constructor defaults (D-03 / WIN-05).
 */
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600

/**
 * Minimum / maximum sanity bounds for the persisted width / height. These
 * guard against a corrupted settings row that would otherwise produce a
 * pathological window (zero, negative, or absurdly huge). The minima
 * match the BrowserWindow constructor `minWidth` / `minHeight` (WIN-05);
 * the maxima are generous enough for the largest reasonable display.
 */
const MIN_WIDTH = 500
const MIN_HEIGHT = 350
const MAX_DIMENSION = 4000

/**
 * Pixels of vertical clearance the title bar needs above the bottom edge of a
 * display's workArea so the user can still grab the window to drag it back to
 * a sane position. Matches the UI-SPEC `title-bar` height of 32 px — even if
 * 90% of the window is offscreen, as long as the top ~32 px of the title bar
 * is reachable, the window is recoverable.
 */
const TITLE_BAR_HEIGHT_PX = 32

// Module-scoped state — wiped by `resetForTests()` (AP-16). `null` for both
// fields means "nothing pending, nothing attached" — the post-construction
// idle state.
let pendingTimer: NodeJS.Timeout | null = null
let attachedWindow: BrowserWindow | null = null

/**
 * Constructor-friendly bounds returned by `readSavedBounds()`. The `x`/`y`
 * keys are intentionally optional: on first launch (or when the saved bounds
 * fall outside every visible workArea) we OMIT them so Electron centers the
 * window using its built-in algorithm. The renderer-facing `WindowGeometry`
 * interface (from `@shared/ipc`) has `x`/`y` as `number | null` because it
 * encodes the persisted row shape; the constructor input prefers omission.
 */
export interface ConstructorBounds {
  width: number
  height: number
  x?: number
  y?: number
}

/**
 * Read the saved geometry from the settings repo, clamp to visible workArea,
 * and return `BrowserWindow` constructor-friendly bounds.
 *
 * - Missing row (NotFoundError) → log warn + default 800x600 (no x/y).
 * - Saved width/height are clamped to [MIN, MAX] (NaN → MIN).
 * - Saved x/y null → return `{ width, height }` only (Electron centers).
 * - Saved x/y outside every visible workArea (slack `MIN_VISIBLE_SLACK_PX`)
 *   → log info + return `{ width, height }` only (Electron centers).
 * - Otherwise → return the full `{ x, y, width, height }`.
 *
 * The "centered fallback" path NEVER throws — even a completely corrupted row
 * with garbage values yields a sane 800x600 centered window.
 */
export function readSavedBounds(): ConstructorBounds {
  let saved: WindowGeometry
  try {
    saved = settingsRepo.get('settings.window_geometry')
  } catch (e) {
    // NotFoundError → first launch (migration 002 inserts the row, so this is
    // only hit if migrations have not yet run — boot-order bug). Returning
    // the constructor default keeps the app launchable; the missing-row
    // condition surfaces as a warn-level log line for post-mortem.
    log.warn('window-geometry: no saved bounds; using defaults', e)
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  }

  const w = clampSize(saved.width, MIN_WIDTH, MAX_DIMENSION)
  const h = clampSize(saved.height, MIN_HEIGHT, MAX_DIMENSION)

  if (saved.x === null || saved.y === null) {
    // First-launch sentinel (D-09): null x/y means "Electron should center
    // the window". Omit x/y from the constructor opts.
    return { width: w, height: h }
  }

  // D-12: clamp to visible workArea across all displays. The point we check
  // is the saved top-left + clamped width/height — checking the clamped
  // dimensions (not the raw saved ones) avoids a corner case where a tiny
  // corrupt saved width passes the visibility check but the post-clamp
  // restored window would actually be off-screen.
  const candidate: Rectangle = { x: saved.x, y: saved.y, width: w, height: h }
  if (isPointVisible(candidate)) {
    return { x: saved.x, y: saved.y, width: w, height: h }
  }

  // Out of bounds (e.g., the user unplugged the monitor the window was
  // last positioned on). Falling back to centered guarantees the user can
  // see + grab the window after a monitor topology change.
  log.info('window-geometry: saved bounds offscreen; falling back to default center')
  return { width: w, height: h }
}

/**
 * Clamp `value` into `[min, max]`. NaN (or any non-finite value) becomes
 * `min` — the safest direction: a tiny window is annoying but recoverable;
 * a window absurdly large could pin a low-end machine. Floor the result so
 * we never write fractional pixels to the settings row (the Zod schema for
 * `WindowGeometry` requires integers — `z.number().int().positive()`).
 */
function clampSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

/**
 * True when the rectangle `b`'s top-left corner is within (or within
 * `MIN_VISIBLE_SLACK_PX` of) some display's workArea AND the title bar (top
 * 32 px) sits above the bottom edge of that same workArea.
 *
 * We check the top-left specifically because the title bar is the only
 * visual the user needs to grab — even if 90% of the window is offscreen,
 * as long as the title bar is reachable, the window can be dragged back.
 *
 * Multi-monitor support: iterates ALL displays from `screen.getAllDisplays()`
 * and returns true on the first match. Handles negative-x secondary monitors
 * correctly because each display's workArea has its own absolute (x, y)
 * origin — we never assume the primary display starts at (0, 0).
 *
 * Exported because plan 03-04's runMain may call it directly for ad-hoc
 * geometry sanity checks (e.g., after a `display-removed` event in a future
 * phase).
 */
export function isPointVisible(b: Rectangle): boolean {
  const displays = screen.getAllDisplays()
  return displays.some((d) => {
    const wa = d.workArea
    return (
      b.x >= wa.x - MIN_VISIBLE_SLACK_PX &&
      b.x + b.width <= wa.x + wa.width + MIN_VISIBLE_SLACK_PX &&
      b.y >= wa.y - MIN_VISIBLE_SLACK_PX &&
      b.y + TITLE_BAR_HEIGHT_PX <= wa.y + wa.height
    )
  })
}

/**
 * Schedule a debounced write of the current window bounds. Called internally
 * by the 'moved' + 'resized' listeners; safe to call rapidly (each call
 * resets the timer). Exported so plan 03-04 / 03-05 callers can request a
 * write programmatically (e.g., after a setSize from a settings dialog).
 *
 * Implementation detail (AP-01): a SINGLE shared timer between 'moved' and
 * 'resized'. Two separate timers would fire two writes per drag-with-resize
 * cycle because Chromium emits both events for the same gesture (Pitfall 2).
 *
 * The `bounds` parameter is OPTIONAL — when omitted, the timer's callback
 * reads `attachedWindow.getBounds()` at fire time. This means a long drag
 * captures the FINAL position, not the position at the first 'moved' event.
 */
export function scheduleWrite(bounds?: Rectangle): void {
  if (!attachedWindow) return
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    writeBoundsNow(bounds)
  }, GEOMETRY_DEBOUNCE_MS)
}

/**
 * Immediate, synchronous write. Called by the 'close' listener so the final
 * drag persists even though the process is shutting down (AP-08). Safe to
 * call when nothing is pending — clears any pending timer and runs the
 * write once; a no-op when no window is attached.
 */
export function flushPendingWrite(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  writeBoundsNow()
}

/**
 * Read the attached window's bounds + persist them via the settings repo.
 * Internal — callers use `scheduleWrite()` or `flushPendingWrite()`.
 *
 * Guards:
 *   - No attached window → no-op (nothing to write).
 *   - Window destroyed → no-op (calling getBounds on a destroyed window
 *     throws). The 'close' event fires BEFORE the BrowserWindow is fully
 *     destroyed, so `isDestroyed()` is false at flushPendingWrite time —
 *     but a stale module reference (e.g., after `detachListeners` raced
 *     with a pending timer) could land here.
 */
function writeBoundsNow(explicitBounds?: Rectangle): void {
  if (!attachedWindow || attachedWindow.isDestroyed()) return
  const b = explicitBounds ?? attachedWindow.getBounds()
  const value: WindowGeometry = {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
  }
  try {
    settingsRepo.set('settings.window_geometry', value)
  } catch (e) {
    // A failed write is non-fatal — the next 'moved'/'resized' will try
    // again. Log at error so post-mortem can find recurring failures.
    log.error('window-geometry: settings.set failed', e)
  }
}

/**
 * Wire 'moved' + 'resized' + 'close' on the live BrowserWindow. Idempotent:
 * if a previous window was attached, its module state is cleared first via
 * `detachListeners()`.
 *
 * Why we don't `win.off(...)` the previous window: by the time `attachListeners`
 * is called with a NEW window, the old window has typically been closed and is
 * about to be GC'd anyway — calling `off` on a soon-to-die window object is
 * defensive theatre. Clearing `attachedWindow` is enough: the next
 * `scheduleWrite()` won't fire on the old window because the timer is gone.
 */
export function attachListeners(win: BrowserWindow): void {
  detachListeners()
  attachedWindow = win
  win.on('moved', () => scheduleWrite())
  win.on('resized', () => scheduleWrite())
  win.on('close', () => flushPendingWrite())
}

/**
 * Clear the pending debounce timer and drop the attached window reference.
 * Exported because tests use it AND because plan 03-04's main process may
 * call it during `window-all-closed` cleanup (defensive — `flushPendingWrite`
 * already ran by then, so this is just resource hygiene).
 */
export function detachListeners(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  attachedWindow = null
}

/**
 * Test-only: clear module state so vitest's beforeEach starts clean.
 * Called from `beforeEach` and `afterEach` in `window-geometry.test.ts`.
 * Same shape as `services/heartbeat.ts` `resetForTests` — same contract.
 */
export function resetForTests(): void {
  detachListeners()
}
