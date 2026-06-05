// src/main/services/heartbeat.ts
// HeartbeatService — pure-function 60-second heartbeat scheduler. Started on
// `TimerService.start()` success; stopped on `TimerService.stopActive()` /
// `stop()` when no running entry remains (D-06). While running, every tick
// writes `nowSeconds()` into the single heartbeat row (id=1, D-07). At idle,
// the interval is not installed at all — no work happens.
//
// Pure functions only (D-01) — no `class HeartbeatService`. Module-scoped
// state (`intervalHandle`) is wiped by the exported `resetForTests()` for
// vitest's beforeEach. Mirrors v1's `timerz/scheduler.py`:
// `write_heartbeat` early-returns when nothing is running; `start_heartbeat`
// uses APScheduler's `replace_existing=True` which we translate to
// `clearInterval(currentHandle)` before re-installing the interval
// (RESEARCH § Pattern 1 + § Pitfall 1).
//
// IMPORTANT — does NOT register `powerMonitor.on('resume', ...)`. That lives
// in `src/main/index.ts` runMain() per Plan 02-04 (D-09). The
// `powerMonitor.on` handler calls `stopHeartbeat(); startHeartbeat();` to
// re-arm the interval after wake (RESEARCH § Pitfall 2: setInterval behaviour
// across system sleep is unreliable; the safe pattern is to restart).
//
// Refs:
//   - 02-CONTEXT.md D-01 (pure functions + module state via resetForTests)
//   - 02-CONTEXT.md D-06 (lifecycle: start on TimerService.start, stop when no
//     running entry remains)
//   - 02-CONTEXT.md D-07 (single-row upsert id=1 — delegated to repository)
//   - 02-CONTEXT.md D-08 (timestamps via nowSeconds() — never raw Date.now())
//   - 02-CONTEXT.md D-19 (service composes repositories; never touches SQL)
//   - 02-CONTEXT.md D-20 (electron-log: info on start/stop; NO log per tick)
//   - 02-RESEARCH.md § "Pattern 1" — canonical scheduler shape
//   - 02-RESEARCH.md § "Common Pitfalls" #1 — clearInterval before setInterval
//   - 02-RESEARCH.md § "Section 3" — interval handle is NOT detached from
//     the event loop (app lifecycle owned by BrowserWindow, not by the timer)
//   - timerz/scheduler.py (v1 semantic reference — NOT byte-port)

import { write as writeHeartbeatRow } from '@main/db/repositories/heartbeat'
import { getRunning } from '@main/db/repositories/timeEntries'
import { nowSeconds } from '@shared/time'
import log from '@main/log'

/**
 * Heartbeat cadence in milliseconds. Exported as a named constant — never a
 * magic number (D-06 / CRASH-01). Tests assert `vi.advanceTimersByTime(
 * HEARTBEAT_INTERVAL_MS + 5_000)` against ROADMAP success criterion #2.
 */
export const HEARTBEAT_INTERVAL_MS = 60_000

// Module-scoped interval handle (D-01). `null` distinguishes "no interval
// installed" from a stale handle. Wiped by `resetForTests()` so vitest's
// beforeEach starts clean.
let intervalHandle: NodeJS.Timeout | null = null

/**
 * Write the current heartbeat row. Reads the currently-running TimeEntry from
 * the repository; if nothing is running, returns without writing — mirrors v1
 * `scheduler.py:27` ("if entry is None: return"). Otherwise, writes
 * `nowSeconds()` + the running entry's id into the single heartbeat row.
 *
 * No log per tick (D-20) — this fires every 60s while a timer runs and would
 * spam the log file with thousands of identical info-level lines per day.
 *
 * Exported so call sites can invoke it directly (e.g., a future "force-flush
 * heartbeat" code path) and so vitest can assert behaviour without waiting
 * for an interval tick.
 */
export function writeHeartbeat(): void {
  const running = getRunning()
  if (!running) return
  writeHeartbeatRow(nowSeconds(), running.id)
}

/**
 * Install the 60-second heartbeat interval. Safe to call repeatedly — any
 * existing handle is cleared first (RESEARCH § Pitfall 1; v1's
 * `replace_existing=True` semantics). Without the `clearInterval` guard,
 * repeat calls (e.g., on `powerMonitor.on('resume', ...)` triggers) would
 * leak intervals; the upsert is idempotent so the heartbeat row stays
 * correct, but the Node event-loop accumulates phantom timers.
 *
 * NOTE — does NOT detach the handle from the libuv event loop (RESEARCH §
 * Section 3). The Electron app's lifecycle is owned by BrowserWindow /
 * `app.quit()`, not by whether timers keep the event loop alive; detaching
 * the handle would let the process exit while a heartbeat is mid-cycle.
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
 * installed interval is a no-op. Wired into `TimerService.stopActive()` /
 * `stop()` when no more running entry remains (D-06).
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
