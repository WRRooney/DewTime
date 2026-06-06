// TickService — one-second push-tick scheduler. Started ONLY when a timer is
// running (no zero-payload broadcasts when idle); idempotent start() + stop()
// mirroring heartbeat.ts shape. While running, every tick calls emit() which
// reads the currently-running TimeEntry from the repository, computes
// elapsedSeconds, and pushes via `BrowserWindow.getAllWindows()[0].webContents.send(
// 'tick:update', payload)`. start() fires emit() once IMMEDIATELY so the renderer
// does not wait up to 1 s for the first payload.
//
// IMPORTANT — does NOT register `powerMonitor.on('resume', ...)`. That lives
// in `src/main/index.ts` runMain(). The `powerMonitor.on` handler calls
// `tickService.emitNow()` to fire one tick immediately after sleep/wake so the
// renderer sees the post-resume state without waiting for the next 1 s interval.
//
// NO log per tick — this fires every second while a timer runs and would
// generate 86,400 log lines/day at info level. Only start/stop lifecycle events
// are logged.

import { BrowserWindow } from 'electron'
import { getRunning } from '@main/db/repositories/timeEntries'
import { nowSeconds } from '@shared/time'
import log from '@main/log'

/**
 * Tick cadence in milliseconds. Exported as a named constant — never a magic
 * number. Tests use `TICK_INTERVAL_MS` directly in advanceTimersByTime assertions.
 */
export const TICK_INTERVAL_MS = 1_000

// Module-scoped interval handle. `null` distinguishes "no interval installed"
// from a stale handle. Wiped by `resetForTests()` so vitest's beforeEach starts clean.
let intervalHandle: NodeJS.Timeout | null = null

/**
 * Emit one tick to the renderer. Reads the currently-running TimeEntry from
 * the repository; if nothing is running, returns without sending — defensive
 * guard so stop() clearing the interval and emit() being called simultaneously
 * does not crash. Builds `{ timerId, elapsedSeconds }` and calls
 * `webContents.send('tick:update', payload)`.
 *
 * Guard: `webContents.send` on a destroyed BrowserWindow throws; check
 * `win.isDestroyed()` before every send.
 *
 * NO log inside this function — 86,400 calls/day at info level is unacceptable.
 *
 * Exported so vitest tests can invoke it directly without waiting for the interval.
 */
export function emit(): void {
  const entry = getRunning()
  if (!entry) return // defensive — stop() should have cleared the interval
  const payload = {
    timerId: entry.timer_id,
    elapsedSeconds: Math.max(0, nowSeconds() - entry.start_timestamp),
  }
  // Broadcast to every window, not just getAllWindows()[0]: once the timestamp
  // editor opens as a second window, [0] may be the editor (which has no tick
  // subscriber), freezing the main window's live counters until it closed.
  // Editor windows have no tick:update listener, so the extra send is harmless.
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('tick:update', payload)
  }
}

/**
 * Install the 1-second tick interval. Idempotent — if an interval is already
 * running, returns immediately (unlike heartbeat.ts which re-arms; here a
 * second `start()` while running is a no-op because only one timer can be
 * active at a time). Fires `emit()` once IMMEDIATELY so the renderer does not
 * wait up to 1 s for the first tick payload.
 *
 * Called from `TimerService.start()` after the DB transaction commits.
 */
export function start(): void {
  if (intervalHandle !== null) return // already running — idempotent
  log.info('tick: started (interval=1s)')
  emit() // fire immediately — renderer sees the first tick without up to 1 s delay
  intervalHandle = setInterval(emit, TICK_INTERVAL_MS)
}

/**
 * Clear the tick interval. Idempotent — calling when no interval is installed
 * is a no-op.
 */
export function stop(): void {
  if (intervalHandle === null) return
  clearInterval(intervalHandle)
  intervalHandle = null
  log.info('tick: stopped')
}

/**
 * Thin alias for `emit()`. Exported for the powerMonitor.on('resume') handler
 * to call without depending on the interval lifecycle. After a sleep/wake, the
 * stale interval may not have fired yet — calling emitNow() ensures the renderer
 * sees the post-resume state immediately.
 */
export function emitNow(): void {
  emit()
}

/**
 * Test-only: clear the interval handle without logging so vitest's beforeEach
 * starts clean. Called from `beforeEach` and `afterEach` in `tick.test.ts`.
 * Matches heartbeat.ts resetForTests() convention exactly.
 */
export function resetForTests(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
