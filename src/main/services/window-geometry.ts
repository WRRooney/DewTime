// WindowGeometryService — pure-function module that owns reading, clamping,
// debouncing, and writing the composite `settings.window_geometry` row.
//
// Boot path:
//   1. runMain() calls `readSavedBounds()` BEFORE createWindow — clamps the
//      saved x/y against the live `screen.getAllDisplays()` workAreas; returns
//      constructor-friendly bounds (omits x/y on first launch so Electron centers).
//   2. createWindow uses the returned bounds.
//   3. runMain() calls `attachListeners(win)` AFTER createWindow returns.
//
// Write path:
//   - win.on('moved') and win.on('resized') both call `scheduleWrite()`.
//   - scheduleWrite uses a SINGLE shared 250 ms debounce timer for both events:
//     a continuous drag fires many 'moved' AND many 1-px-oscillation 'resized'
//     events (Chromium quirk), so two separate timers would write twice per cycle.
//   - On win.on('close'): flushPendingWrite() runs synchronously so the last
//     drag persists even as the process shuts down.

import { screen, type BrowserWindow, type Rectangle } from 'electron'
import * as settingsRepo from '@main/db/repositories/settings'
import log from '@main/log'
import type { WindowGeometry } from '@shared/ipc'

/**
 * Debounce interval in milliseconds for 'moved' + 'resized' writes. Exported
 * as a named constant so tests use `vi.advanceTimersByTime(GEOMETRY_DEBOUNCE_MS)`
 * and a future bump does not silently break the contract.
 */
export const GEOMETRY_DEBOUNCE_MS = 250

/**
 * Slack pixels added to each side of every display's workArea when checking
 * whether a saved (x, y) point is "visible". Tolerates minor monitor-layout
 * drift across reboots (e.g., secondary monitor moved 10 px in OS display
 * settings — the saved bounds still land in a reachable spot).
 */
const MIN_VISIBLE_SLACK_PX = 50

/** Default width / height when no saved row exists or the saved bounds are unreachable. */
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 600

/**
 * Minimum / maximum sanity bounds for the persisted width / height. Guard
 * against a corrupted settings row producing a pathological window (zero,
 * negative, or absurdly huge).
 */
const MIN_WIDTH = 500
const MIN_HEIGHT = 350
const MAX_DIMENSION = 4000

/**
 * Pixels of vertical clearance the title bar needs above the bottom edge of a
 * display's workArea. Even if 90% of the window is offscreen, as long as the
 * top ~32 px of the title bar is reachable, the window is recoverable by dragging.
 */
const TITLE_BAR_HEIGHT_PX = 32

// Module-scoped state — wiped by `resetForTests()`. `null` for both fields
// means "nothing pending, nothing attached" — the post-construction idle state.
let pendingTimer: NodeJS.Timeout | null = null
let attachedWindow: BrowserWindow | null = null

/**
 * Constructor-friendly bounds returned by `readSavedBounds()`. The `x`/`y`
 * keys are intentionally optional: on first launch (or when the saved bounds
 * fall outside every visible workArea) we OMIT them so Electron centers the
 * window. The persisted `WindowGeometry` shape uses `number | null`; the
 * constructor input prefers omission over null.
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
    // NotFoundError → first launch or migrations not yet run. Returning the
    // constructor default keeps the app launchable.
    log.warn('window-geometry: no saved bounds; using defaults', e)
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
  }

  const w = clampSize(saved.width, MIN_WIDTH, MAX_DIMENSION)
  const h = clampSize(saved.height, MIN_HEIGHT, MAX_DIMENSION)

  if (saved.x === null || saved.y === null) {
    // null x/y means Electron should center the window; omit x/y from the constructor opts.
    return { width: w, height: h }
  }

  // Clamp to visible workArea across all displays. We check the clamped
  // dimensions (not the raw saved ones) to avoid a corner case where a tiny
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
 * We check the top-left specifically because the title bar is the only grab
 * target — even if 90% of the window is offscreen, as long as the title bar
 * is reachable, the window can be dragged back.
 *
 * Multi-monitor: iterates ALL displays and returns true on first match.
 * Handles negative-x secondary monitors correctly — we never assume the
 * primary display starts at (0, 0).
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
 * resets the timer). A SINGLE shared timer between 'moved' and 'resized' —
 * two separate timers would fire two writes per drag-with-resize cycle because
 * Chromium emits both events for the same gesture.
 *
 * The `bounds` parameter is OPTIONAL — when omitted, the timer's callback
 * reads `attachedWindow.getBounds()` at fire time, capturing the FINAL
 * position rather than the position at the first 'moved' event.
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
 * drag persists even as the process shuts down. Safe to call when nothing is
 * pending — clears any pending timer and runs the write once; a no-op when no
 * window is attached.
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
 *   - Window destroyed → no-op (calling getBounds on a destroyed window throws).
 *     The 'close' event fires BEFORE the BrowserWindow is fully destroyed, so
 *     `isDestroyed()` is false at flushPendingWrite time — but a stale module
 *     reference (e.g., after `detachListeners` raced with a pending timer)
 *     could land here.
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
 * `detachListeners()`. We don't `win.off(...)` the previous window because by
 * the time a new window is attached, the old one is typically closed and about
 * to be GC'd — clearing `attachedWindow` is sufficient.
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
 * Exported for tests and for `window-all-closed` cleanup (defensive —
 * `flushPendingWrite` already ran by then, so this is resource hygiene).
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
