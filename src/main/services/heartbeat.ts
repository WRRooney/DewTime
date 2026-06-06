// HeartbeatService — pure-function 60-second heartbeat scheduler. Started on
// `TimerService.start()` success; stopped on `TimerService.stopActive()` /
// `stop()` when no running entry remains. While running, every tick writes
// `nowSeconds()` into the single heartbeat row (id=1). At idle, the interval
// is not installed at all — no work happens.
//
// IMPORTANT — does NOT register `powerMonitor.on('resume', ...)`. That lives
// in `src/main/index.ts` runMain(). The `powerMonitor.on` handler calls
// `stopHeartbeat(); startHeartbeat();` to re-arm the interval after wake —
// setInterval behaviour across system sleep is unreliable; the safe pattern
// is to restart.

import { write as writeHeartbeatRow } from '@main/db/repositories/heartbeat'
import { getRunning } from '@main/db/repositories/timeEntries'
import { nowSeconds } from '@shared/time'
import log from '@main/log'

/**
 * Heartbeat cadence in milliseconds. Exported as a named constant — never a
 * magic number. Tests use `vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + 5_000)`.
 */
export const HEARTBEAT_INTERVAL_MS = 60_000

// Module-scoped interval handle. `null` distinguishes "no interval installed"
// from a stale handle. Wiped by `resetForTests()` so vitest's beforeEach starts clean.
let intervalHandle: NodeJS.Timeout | null = null

/**
 * Write the current heartbeat row. Reads the currently-running TimeEntry from
 * the repository; if nothing is running, returns without writing. Otherwise,
 * writes `nowSeconds()` + the running entry's id into the single heartbeat row.
 *
 * No log per tick — this fires every 60s while a timer runs and would spam
 * the log file with thousands of identical info-level lines per day.
 *
 * Exported so call sites can invoke it directly and so vitest can assert
 * behaviour without waiting for an interval tick.
 */
export function writeHeartbeat(): void {
  const running = getRunning()
  if (!running) return
  writeHeartbeatRow(nowSeconds(), running.id)
}

/**
 * Install the 60-second heartbeat interval. Safe to call repeatedly — any
 * existing handle is cleared first to prevent leaked intervals on resume
 * triggers. Without the `clearInterval` guard, repeat calls would accumulate
 * phantom timers in the Node event loop.
 *
 * NOTE — does NOT detach the handle from the libuv event loop. The Electron
 * app's lifecycle is owned by BrowserWindow / `app.quit()`, not by whether
 * timers keep the event loop alive; detaching the handle would let the process
 * exit while a heartbeat is mid-cycle.
 */
export function startHeartbeat(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
  }
  intervalHandle = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS)
  log.info('heartbeat: started (interval=60s)')
}

/**
 * Clear the heartbeat interval. Idempotent — calling repeatedly with no
 * installed interval is a no-op.
 */
export function stopHeartbeat(): void {
  if (intervalHandle === null) return
  clearInterval(intervalHandle)
  intervalHandle = null
  log.info('heartbeat: stopped')
}

/**
 * Test-only: clear the interval handle so vitest's beforeEach starts clean.
 * Called from `beforeEach` and `afterEach` in `heartbeat.test.ts`. Does NOT
 * log (would noise the test output).
 */
export function resetForTests(): void {
  if (intervalHandle !== null) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
