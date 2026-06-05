// src/main/services/timer.ts
// TimerService — pure-function service module composing Phase 1 repositories
// (plus Plan 02-01's now-real `stop`/`stopActive`) inside a synchronous
// `db.transaction(fn)`. Source-of-truth for the single-active-timer invariant
// (TIME-03): the FSM is "DB row count of `WHERE end_timestamp IS NULL` ≤ 1".
//
// Pure functions only (D-01) — no `class TimerService`, no FSM library (D-02).
// Module-scoped state (`lastResumeResult`) is wiped by the exported
// `resetForTests()` for vitest's beforeEach. Repository remains dumb CRUD
// (D-19); the transaction wrapper lives here.
//
// EDIT (Plan 02-03): `./heartbeat` is now imported. `start()` calls
// `startHeartbeat()` AFTER the transaction commits — heartbeat ticking begins
// only on successful start. `stopActive()` and `stop()` call `stopHeartbeat()`
// when no more running entry remains (D-06). The 02-03 wiring is intentionally
// minimal — heartbeat module imports nothing from timer service (one-way
// dependency), so this file's behaviour does not regress 02-02's tests.
//
// Refs:
//   - 02-CONTEXT.md D-01 (pure functions + module state via resetForTests)
//   - 02-CONTEXT.md D-02 (no FSM library)
//   - 02-CONTEXT.md D-03 (start runs inside db.transaction(stopActive + start))
//   - 02-CONTEXT.md D-04 (stopActive idempotent — null, no throw)
//   - 02-CONTEXT.md D-05 (elapsedSeconds wall-clock arithmetic only — TIME-06)
//   - 02-CONTEXT.md D-11..D-15 (ResumeResult shape; CRASH_THRESHOLD_SECONDS;
//     suspectedEnd fallback; cache-then-recompute semantics for getCachedResumeResult)
//   - 02-CONTEXT.md D-19 (service composes repositories; service-side transactions)
//   - 02-CONTEXT.md D-20 (electron-log: info on start/stop, warn on crash-suspect,
//     error on invariant violation)
//   - 02-RESEARCH.md § "Pattern 2" (db.transaction wrapping)
//   - 02-RESEARCH.md § "Pattern 3" (module-scoped cache + resetForTests)
//   - 02-RESEARCH.md § "Common Pitfalls" #3 (NEVER pass an async function to
//     db.transaction — better-sqlite3 commits before the await resolves)
//   - 02-RESEARCH.md § "Common Pitfalls" #5 (clamp beatAge to 0 — clock skew)
//   - timerz/services/timer_service.py (v1 semantic reference; NOT byte-port)

import { getDb } from '@main/db/database'
import * as timeEntriesRepo from '@main/db/repositories/timeEntries'
import * as timersRepo from '@main/db/repositories/timers'
import { read as readHeartbeat } from '@main/db/repositories/heartbeat'
import { nowSeconds, type EpochSeconds } from '@shared/time'
import { InvariantError } from '@shared/errors'
import type { TimeEntry } from '@shared/ipc'
import log from '@main/log'
// Plan 02-03: wire HeartbeatService start/stop calls into start() / stopActive() / stop().
import { startHeartbeat, stopHeartbeat } from './heartbeat'
// Plan 04-04: wire TickService start/stop calls at the SAME hook points as heartbeat.
// One-way import: timer.ts → tick.ts; tick.ts does NOT import timer.ts (D-06).
import * as tickService from './tick'

/**
 * Crash-detection threshold. A `last_beat` older than this many seconds
 * (relative to `nowSeconds()`) is classified as a crash-suspect resume.
 * Matches v1 (`timerz/services/timer_service.py CRASH_THRESHOLD_SECONDS`).
 * Exported as a named constant — never a magic number (D-12).
 */
export const CRASH_THRESHOLD_SECONDS = 300

/**
 * Result of the boot-time crash-detection check. Direct TS analog of v1's
 * `ResumeResult` dataclass. `suspectedEnd` is `null` for a clean resume; for
 * a crash-suspect resume it is the last heartbeat's `last_beat` (or, if no
 * heartbeat row exists yet, the running entry's `start_timestamp` per D-13).
 */
export interface ResumeResult {
  entry: TimeEntry
  isCleanResume: boolean
  suspectedEnd: EpochSeconds | null
}

// Module-scoped cache for checkResume. `undefined` distinguishes
// "not yet computed" (boot order violation if the IPC handler fires first)
// from `null` (computed, no running entry found). D-15.
let lastResumeResult: ResumeResult | null | undefined = undefined

/**
 * Atomically stop any running entry and start a new one for `timerId`.
 *
 * The transaction body is **synchronous** — better-sqlite3 v12's
 * `db.transaction(fn)` requires it. Passing an `async` function silently
 * commits before the awaited work resolves (02-RESEARCH.md § Pitfall 3).
 * The grep gate `db\.transaction\(\s*async` enforces this at the file level.
 *
 * After the transaction returns, a defensive invariant query asserts that
 * exactly one row has `end_timestamp IS NULL`. If the count is greater than
 * one, the FSM is broken (should be impossible given the transaction) — we
 * throw `InvariantError` and log at `error` level per D-20.
 *
 * @param timerId the timer to start
 * @returns the newly-running TimeEntry
 */
export function start(timerId: number): TimeEntry {
  const db = getDb()
  // CRITICAL — sync callback. NEVER `async`. RESEARCH § Pitfall 3.
  const txn = db.transaction((tid: number): TimeEntry => {
    timeEntriesRepo.stopActive()
    return timeEntriesRepo.start(tid)
  })
  const entry = txn(timerId)

  // Defensive invariant check (D-20). The transaction should already
  // guarantee at most one `end_timestamp IS NULL` row, but a direct COUNT
  // query is cheap insurance — and the same query Test 2 (TIME-03) asserts
  // against, so we surface any drift loudly at runtime rather than only in
  // the test suite.
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n FROM time_entries WHERE end_timestamp IS NULL',
    )
    .get() as { n: number }
  if (row.n > 1) {
    log.error(
      `timer.start: single-active-timer broken — ${row.n} running entries`,
    )
    throw new InvariantError(
      `single-active-timer broken: ${row.n} running entries`,
    )
  }

  log.info(`timer.start: timer_id=${timerId} entry_id=${entry.id}`)

  // Plan 02-03 / D-06: start the 60-second heartbeat after the transaction
  // commits. `startHeartbeat()` is idempotent (clears any prior handle), so
  // calling it on every successful `start()` is safe — repeat starts (e.g.,
  // switching from timer A to timer B) re-arm the interval cleanly.
  startHeartbeat()

  // Plan 04-04 / D-06: start the 1-second tick interval at the same hook point
  // as heartbeat. tickService.start() is idempotent (no-op if already running).
  tickService.start()

  return entry
}

/**
 * Stop whatever's currently running. Idempotent — returns `null` when no
 * running entry exists (D-04). Delegates to the repository's `stopActive()`
 * which uses `UPDATE ... RETURNING *` to fetch the post-update row atomically.
 *
 * Plan 02-03 / D-06: calls `stopHeartbeat()` when no running entry remains
 * after the repository call. The re-check is conservative — the single-active
 * invariant (TIME-03) means a successful `stopActive()` always leaves zero
 * running entries — but the explicit `getRunning() === null` guard matches
 * D-06's wording ("when no more running entry remains") verbatim. Idempotent:
 * if nothing was running, the no-op `stopHeartbeat()` is also a no-op.
 */
export function stopActive(): TimeEntry | null {
  const stopped = timeEntriesRepo.stopActive()
  if (stopped) {
    log.info(`timer.stopActive: entry_id=${stopped.id}`)
  }
  // Plan 02-03 / D-06: stop the heartbeat when no running entry remains.
  // Plan 04-04 / D-06: stop the tick interval at the same hook point.
  if (timeEntriesRepo.getRunning() === null) {
    stopHeartbeat()
    tickService.stop()
  }
  return stopped
}

/**
 * Stop a SPECIFIC timer if it has a running entry. Useful for the per-row
 * "stop" button — distinguishes from `stopActive()` (which stops whatever
 * is running) when the UI cares which timer the user clicked. Wrong-timer
 * calls are a no-op (return `null` without modifying any row), matching v1's
 * `TimerService.stop_timer` semantics.
 */
export function stop(timerId: number): TimeEntry | null {
  const stopped = timeEntriesRepo.stop(timerId)
  if (stopped) {
    log.info(`timer.stop: timer_id=${timerId} entry_id=${stopped.id}`)
    // Plan 02-03 / D-06: stop the heartbeat when no running entry remains.
    // Plan 04-04 / D-06: stop the tick interval at the same hook point.
    // Only checked on the "stopped a row" path — wrong-timer no-op leaves the
    // heartbeat + tick running because some OTHER timer is still ticking.
    if (timeEntriesRepo.getRunning() === null) {
      stopHeartbeat()
      tickService.stop()
    }
  }
  return stopped
}

/** Currently-running TimeEntry, or null. Thin pass-through to the repository. */
export function getRunningEntry(): TimeEntry | null {
  return timeEntriesRepo.getRunning()
}

/**
 * Total elapsed seconds across all entries for `timerId`. Running entries
 * (those with `end_timestamp === null`) contribute `nowSeconds() - start`;
 * stopped entries contribute `end_timestamp - start`. The persistent
 * `timers.offset` (null → 0) is added once at the end.
 *
 * TIME-06 / D-05: wall-clock arithmetic only — never an in-memory counter.
 * The return is a plain `number` (a duration in seconds), NOT an
 * `EpochSeconds`. Durations are not epoch values; the brand would be
 * incorrect here.
 */
export function elapsedSeconds(timerId: number): number {
  const now = nowSeconds()
  const entries = timeEntriesRepo.listByTimer(timerId)
  let total = 0
  for (const e of entries) {
    const end = e.end_timestamp ?? now
    total += end - e.start_timestamp
  }
  // Repository export is `byId`, NOT `getById` — RESEARCH example was wrong.
  // `byId` throws NotFoundError if the timer is missing; callers should not
  // request elapsedSeconds for a deleted timer (UI prevents this).
  const timer = timersRepo.byId(timerId)
  total += timer.offset ?? 0
  return total
}

/**
 * Boot-time resume check (D-11, D-12, D-13). Reads the running entry +
 * heartbeat, classifies as clean-resume vs crash-suspect by heartbeat age.
 * Caches the result in module scope so the IPC handler can serve the first
 * paint without re-querying (D-15).
 *
 * - No running entry → cache `null`, return `null`.
 * - `beatAge < CRASH_THRESHOLD_SECONDS` → clean resume; `suspectedEnd: null`.
 * - Otherwise → crash-suspect; `suspectedEnd` is the last heartbeat's
 *   `last_beat` if a heartbeat row exists, else the running entry's
 *   `start_timestamp` (D-13). Logs at `warn` (D-20).
 *
 * `beatAge` is clamped to `>= 0` so a future-stamped heartbeat (clock skew —
 * RESEARCH § Pitfall 5) does not flip the classification.
 */
export function checkResume(): ResumeResult | null {
  const entry = timeEntriesRepo.getRunning()
  if (!entry) {
    lastResumeResult = null
    return null
  }
  const beat = readHeartbeat()
  const now = nowSeconds()
  // Clamp negatives — clock skew (RESEARCH § Pitfall 5 / T-02-06). When the
  // heartbeat's last_beat is greater than the current wall-clock now, the
  // system clock jumped backwards (NTP correction, manual change, dual-boot
  // timezone drift). Treating the negative age as "fresh" (clamp to 0) is the
  // SAFE interpretation — don't false-positive a crash on clock skew. We
  // still surface a warn so post-mortem analysis can grep main.log for the
  // skew event (token 'clock skew detected: heartbeat in the future' kept
  // stable so log filters do not drift).
  //
  // When no heartbeat row exists at all, treat the age as Infinity so the
  // crash-suspect branch fires unconditionally per D-13.
  if (beat && beat.last_beat > now) {
    log.warn(
      `timer.checkResume: clock skew detected: heartbeat in the future ` +
        `last_beat=${beat.last_beat}s now=${now}s delta=${beat.last_beat - now}s`,
    )
  }
  const beatAge = beat ? Math.max(0, now - beat.last_beat) : Infinity

  let result: ResumeResult
  if (beatAge < CRASH_THRESHOLD_SECONDS) {
    result = { entry, isCleanResume: true, suspectedEnd: null }
  } else {
    const suspectedEnd = (beat?.last_beat ?? entry.start_timestamp) as EpochSeconds
    result = { entry, isCleanResume: false, suspectedEnd }
    log.warn(
      `timer.checkResume: crash-suspect entry_id=${entry.id} ` +
        `beat_age=${beat ? `${beatAge}s` : 'no-heartbeat'}`,
    )
  }
  lastResumeResult = result
  return result
}

/**
 * IPC-facing accessor. Returns the cached result on first call (so the
 * renderer's first paint sees the boot-time classification without an extra
 * DB round-trip). Re-runs the check defensively if the cache is `undefined`
 * — that means the IPC handler fired before `runMain()` called
 * `checkResume()` (boot order violation, D-15). The `null` cache value is
 * distinct from `undefined`: it means "computed and nothing was running".
 */
export function getCachedResumeResult(): ResumeResult | null {
  if (lastResumeResult === undefined) {
    log.error(
      'timer.getCachedResumeResult: cache empty (boot order violation) — re-running',
    )
    return checkResume()
  }
  return lastResumeResult
}

/**
 * Delete a timer by id (D-17). If the timer is currently running, stop its
 * active entry FIRST inside the transaction — so the `end_timestamp` is set
 * and the in-memory running-entry cache is invalidated before the CASCADE
 * wipes the row. The `db.transaction` wraps `stopActive()` + `timersRepo.delete(id)`
 * so a successful stop + failed delete (or vice-versa) cannot leave the FSM in
 * a halfway state.
 *
 * After the transaction commits, `tickService.stop()` + `stopHeartbeat()` are
 * called only when the deleted timer was the running one — the intervals must
 * halt when no running entry remains (D-06). These post-txn calls are outside
 * the transaction because `db.transaction` callbacks MUST be synchronous
 * (RESEARCH § Pitfall 3 / T-04-Pitfall3).
 *
 * ON DELETE CASCADE on `time_entries.timer_id` (001_initial.sql) wipes linked
 * entries automatically.
 *
 * Refs:
 *   - 04-CONTEXT.md D-17 (deleteTimer wrapper — stop-then-delete in transaction)
 *   - 04-RESEARCH.md § Pattern 8 (lines 909-951 — canonical template)
 *   - 04-RESEARCH.md § Pitfall 3 (SYNC callback — no async in db.transaction)
 *   - Threat T-04-04 (T-04-Pitfall3): async callback would commit before await
 */
export function deleteTimer(id: number): void {
  const db = getDb()
  const running = timeEntriesRepo.getRunning()
  const willStop = running?.timer_id === id

  // CRITICAL — sync callback. NEVER `async`. RESEARCH § Pitfall 3 / T-04-Pitfall3.
  const txn = db.transaction((tid: number) => {
    if (willStop) {
      // Stop the active entry first so end_timestamp is set and the running-
      // entry cache is invalidated before CASCADE wipes the row.
      timeEntriesRepo.stopActive()
    }
    timersRepo.deleteTimer(tid) // throws NotFoundError if the id does not exist
  })
  txn(id) // execute; bubbles NotFoundError if thrown

  // Post-transaction cleanup — outside db.transaction (must stay sync).
  if (willStop) {
    tickService.stop()  // D-06: halt tick interval when no running entry remains
    stopHeartbeat()
    log.info(`timer.deleteTimer: id=${id} (was running)`)
  } else {
    log.info(`timer.deleteTimer: id=${id}`)
  }
}

/**
 * Test-only: wipe module-scoped state so vitest's beforeEach starts clean.
 * Called from `beforeEach` and `afterEach` in `timer.test.ts`.
 */
export function resetForTests(): void {
  lastResumeResult = undefined
}
