// src/main/services/tick.ts
// TickService — one-second push-tick scheduler. Started ONLY when a timer is
// running (no zero-payload broadcasts when idle); idempotent start() + stop()
// mirroring heartbeat.ts shape (D-06). While running, every tick calls emit()
// which reads the currently-running TimeEntry from the repository, computes
// elapsedSeconds, and calls `BrowserWindow.getAllWindows()[0].webContents.send(
// 'tick:update', payload)` (D-06 / D-07). start() fires emit() once IMMEDIATELY
// so the renderer does not wait up to 1 s for the first payload.
//
// IMPORTANT — does NOT register `powerMonitor.on('resume', ...)`. That lives
// in `src/main/index.ts` runMain() per plan 04-05 (D-11). The
// `powerMonitor.on` handler calls `tickService.emitNow()` to fire one tick
// immediately after sleep/wake without waiting for the next 1 s interval.
//
// emitNow() is exported for plan 04-05's powerMonitor wiring (D-11): fire one
// immediate tick after sleep/wake so the renderer sees the post-resume state.
//
// NO log per tick (D-20 / RESEARCH § Anti-Patterns) — this fires every second
// while a timer runs and would generate 86,400 log lines/day at info level.
// Only start/stop lifecycle events are logged (ONCE each).
//
// Threat mitigations:
//   T-04-06: webContents.send on a destroyed BrowserWindow throws and crashes
//     main — emit() guards with `if (!win || win.isDestroyed()) return` before
//     every send (RESEARCH § Pitfall 7).
//
// Refs:
//   - 04-CONTEXT.md D-06 (lifecycle: start on TimerService.start, stop when no
//     running entry remains; ONLY installed while a timer is running)
//   - 04-CONTEXT.md D-07 ('tick:update' channel literal; no ipcMain.handle;
//     one-way main→renderer push via webContents.send)
//   - 04-CONTEXT.md D-11 (emitNow() — immediate tick after powerMonitor resume)
//   - 04-RESEARCH.md § Pattern 4 (lines 606-652 — canonical tick.ts template)
//   - 04-RESEARCH.md § Pitfall 7 (BrowserWindow isDestroyed guard)
//   - 04-RESEARCH.md § Anti-Patterns (NO per-tick logging)
//   - src/main/services/heartbeat.ts (exact analog for lifecycle shape)

import { BrowserWindow } from 'electron'
import { getRunning } from '@main/db/repositories/timeEntries'
import { nowSeconds } from '@shared/time'
import log from '@main/log'

/**
 * Tick cadence in milliseconds. Exported as a named constant — never a magic
 * number (D-06). Tests use `TICK_INTERVAL_MS` directly in advanceTimersByTime
 * assertions so the interval is self-documenting.
 */
export const TICK_INTERVAL_MS = 1_000

// Module-scoped interval handle (D-01 pattern from heartbeat.ts). `null`
// distinguishes "no interval installed" from a stale handle. Wiped by
// `resetForTests()` so vitest's beforeEach starts clean.
let intervalHandle: NodeJS.Timeout | null = null

/**
 * Emit one tick to the renderer. Reads the currently-running TimeEntry from
 * the repository; if nothing is running, returns without sending — defensive
 * guard so stop() clearing the interval and emit() being called simultaneously
 * does not crash. Builds `{ timerId, elapsedSeconds }` and calls
 * `webContents.send('tick:update', payload)`.
 *
 * RESEARCH § Pitfall 7: `webContents.send` on a destroyed BrowserWindow throws
 * `Error: Object has been destroyed`. Guard: `if (!win || win.isDestroyed()) return`.
 *
 * NO log inside this function — D-20 / RESEARCH § Anti-Patterns. 86,400
 * calls/day at info level is unacceptable.
 *
 * Exported so vitest tests can invoke it directly without waiting for the
 * interval, and so `emitNow()` delegates to it (D-11 alias pattern).
 */
export function emit(): void {
  const entry = getRunning()
  if (!entry) return // defensive — stop() should have cleared the interval
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return // T-04-06: guard against destroyed window
  const payload = {
    timerId: entry.timer_id,
    elapsedSeconds: Math.max(0, nowSeconds() - entry.start_timestamp),
  }
  win.webContents.send('tick:update', payload)
}

/**
 * Install the 1-second tick interval. Idempotent — if an interval is already
 * running, returns immediately (unlike heartbeat.ts which re-arms; here a
 * second `start()` while running is a no-op because the FSM ensures only one
 * timer can be active). Fires `emit()` once IMMEDIATELY so the renderer does
 * not wait up to 1 s for the first tick payload (RESEARCH § Pattern 4 lines
 * 631-633).
 *
 * Called from `TimerService.start()` after the DB transaction commits (D-06).
 */
export function start(): void {
  if (intervalHandle !== null) return // already running — idempotent
  log.info('tick: started (interval=1s)')
  emit() // fire immediately — renderer sees the first tick without up to 1 s delay
  intervalHandle = setInterval(emit, TICK_INTERVAL_MS)
}

/**
 * Clear the tick interval. Idempotent — calling when no interval is installed
 * is a no-op. Called from `TimerService.stopActive()` / `stop()` / `deleteTimer()`
 * when no more running entry remains (D-06).
 */
export function stop(): void {
  if (intervalHandle === null) return
  clearInterval(intervalHandle)
  intervalHandle = null
  log.info('tick: stopped')
}

/**
 * Thin alias for `emit()`. Exported separately for the powerMonitor.on('resume')
 * handler in plan 04-05's runMain() to call without depending on the interval
 * lifecycle. After a sleep/wake, the stale interval may not have fired yet —
 * calling emitNow() ensures the renderer sees the post-resume state immediately
 * (D-11 / RESEARCH § D-11 resume resync rationale).
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
