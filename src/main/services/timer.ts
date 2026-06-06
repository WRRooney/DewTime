// TimerService — pure-function service module. Source-of-truth for the
// single-active-timer invariant: the FSM is "DB row count of
// `WHERE end_timestamp IS NULL` ≤ 1". All mutating operations run inside a
// synchronous `db.transaction(fn)` — NEVER async (better-sqlite3 commits
// before the await resolves). Repository is dumb CRUD; the transaction
// wrapper lives here.

import { getDb } from '@main/db/database'
import * as timeEntriesRepo from '@main/db/repositories/timeEntries'
import * as timersRepo from '@main/db/repositories/timers'
import { read as readHeartbeat } from '@main/db/repositories/heartbeat'
import { nowSeconds, type EpochSeconds } from '@shared/time'
import { InvariantError } from '@shared/errors'
import type { TimeEntry } from '@shared/ipc'
import log from '@main/log'
import { startHeartbeat, stopHeartbeat } from './heartbeat'
// One-way import: timer.ts → tick.ts; tick.ts does NOT import timer.ts.
import * as tickService from './tick'

/**
 * Crash-detection threshold. A `last_beat` older than this many seconds
 * (relative to `nowSeconds()`) is classified as a crash-suspect resume.
 * Exported as a named constant — never a magic number.
 */
export const CRASH_THRESHOLD_SECONDS = 300

/**
 * Result of the boot-time crash-detection check. `suspectedEnd` is `null` for
 * a clean resume; for a crash-suspect resume it is the last heartbeat's
 * `last_beat` (or, if no heartbeat row exists yet, the running entry's
 * `start_timestamp`).
 */
export interface ResumeResult {
  entry: TimeEntry
  isCleanResume: boolean
  suspectedEnd: EpochSeconds | null
}

// Module-scoped cache for checkResume. `undefined` distinguishes "not yet
// computed" (boot order violation if the IPC handler fires first) from `null`
// (computed, no running entry found).
let lastResumeResult: ResumeResult | null | undefined = undefined

/**
 * Atomically stop any running entry and start a new one for `timerId`.
 *
 * The transaction body is **synchronous** — better-sqlite3's `db.transaction(fn)`
 * requires it. Passing an `async` function silently commits before the awaited
 * work resolves.
 *
 * After the transaction returns, a defensive invariant query asserts that
 * exactly one row has `end_timestamp IS NULL`. If the count is greater than
 * one, the FSM is broken — throws `InvariantError` and logs at `error` level.
 *
 * @param timerId the timer to start
 * @returns the newly-running TimeEntry
 */
export function start(timerId: number): TimeEntry {
  const db = getDb()
  // CRITICAL — sync callback. NEVER `async` (better-sqlite3 commits before await resolves).
  const txn = db.transaction((tid: number): TimeEntry => {
    timeEntriesRepo.stopActive()
    return timeEntriesRepo.start(tid)
  })
  const entry = txn(timerId)

  // Defensive invariant check. The transaction should already guarantee at most
  // one `end_timestamp IS NULL` row, but a direct COUNT query is cheap
  // insurance — surfaces drift loudly at runtime, not only in the test suite.
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

  // Start the 60-second heartbeat after the transaction commits.
  // `startHeartbeat()` is idempotent (clears any prior handle), so repeat
  // starts (e.g., switching from timer A to B) re-arm the interval cleanly.
  startHeartbeat()

  // Start the 1-second tick interval at the same hook point as heartbeat.
  // tickService.start() is idempotent (no-op if already running).
  tickService.start()

  return entry
}

/**
 * Stop whatever's currently running. Idempotent — returns `null` when no
 * running entry exists. Delegates to the repository's `stopActive()` which
 * uses `UPDATE ... RETURNING *` to fetch the post-update row atomically.
 *
 * Stops heartbeat + tick when no running entry remains. The re-check is
 * conservative — the single-active invariant means a successful `stopActive()`
 * always leaves zero running entries — but the explicit guard matches the
 * intended invariant verbatim and is a no-op when nothing was running.
 */
export function stopActive(): TimeEntry | null {
  const stopped = timeEntriesRepo.stopActive()
  if (stopped) {
    log.info(`timer.stopActive: entry_id=${stopped.id}`)
  }
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
 * calls are a no-op (return `null` without modifying any row).
 */
export function stop(timerId: number): TimeEntry | null {
  const stopped = timeEntriesRepo.stop(timerId)
  if (stopped) {
    log.info(`timer.stop: timer_id=${timerId} entry_id=${stopped.id}`)
    // Only checked on the "stopped a row" path — a wrong-timer no-op leaves
    // the heartbeat + tick running because some OTHER timer is still ticking.
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
 * Wall-clock arithmetic only — never an in-memory counter. The return is a
 * plain `number` (a duration in seconds), NOT an `EpochSeconds` branded type.
 */
export function elapsedSeconds(timerId: number): number {
  const now = nowSeconds()
  const entries = timeEntriesRepo.listByTimer(timerId)
  let total = 0
  for (const e of entries) {
    const end = e.end_timestamp ?? now
    total += end - e.start_timestamp
  }
  // `byId` throws NotFoundError if the timer is missing; callers should not
  // request elapsedSeconds for a deleted timer (the UI prevents this).
  const timer = timersRepo.byId(timerId)
  total += timer.offset ?? 0
  return total
}

/**
 * Boot-time resume check. Reads the running entry + heartbeat, classifies as
 * clean-resume vs crash-suspect by heartbeat age. Caches the result in module
 * scope so the IPC handler can serve the first paint without re-querying.
 *
 * - No running entry → cache `null`, return `null`.
 * - `beatAge < CRASH_THRESHOLD_SECONDS` → clean resume; `suspectedEnd: null`.
 * - Otherwise → crash-suspect; `suspectedEnd` is the last heartbeat's
 *   `last_beat` if a heartbeat row exists, else the running entry's
 *   `start_timestamp`. Logs at `warn`.
 *
 * `beatAge` is clamped to `>= 0` so a future-stamped heartbeat (clock skew)
 * does not flip the classification.
 */
export function checkResume(): ResumeResult | null {
  const entry = timeEntriesRepo.getRunning()
  if (!entry) {
    lastResumeResult = null
    return null
  }
  const beat = readHeartbeat()
  const now = nowSeconds()
  // Clamp negatives — clock skew. When the heartbeat's last_beat is greater
  // than the current wall-clock now, the system clock jumped backwards (NTP
  // correction, manual change, dual-boot timezone drift). Treating the negative
  // age as "fresh" (clamp to 0) avoids false-positive crash classification on
  // clock skew. We still surface a warn so post-mortem analysis can grep
  // main.log for the skew event (log token 'clock skew detected: heartbeat in
  // the future' kept stable so log filters do not drift).
  //
  // When no heartbeat row exists at all, treat the age as Infinity so the
  // crash-suspect branch fires unconditionally.
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
 * — that means the IPC handler fired before `runMain()` called `checkResume()`
 * (boot order violation). The `null` cache value is distinct from `undefined`:
 * it means "computed and nothing was running".
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
 * Delete a timer by id. If the timer is currently running, stop its active
 * entry FIRST inside the transaction — so `end_timestamp` is set before the
 * CASCADE wipes the row. The `db.transaction` wraps `stopActive()` +
 * `timersRepo.delete(id)` so a successful stop + failed delete (or vice-versa)
 * cannot leave the FSM in a halfway state.
 *
 * After the transaction commits, `tickService.stop()` + `stopHeartbeat()` are
 * called only when the deleted timer was the running one. These post-txn calls
 * are outside the transaction because `db.transaction` callbacks MUST be
 * synchronous (an async callback commits before the await resolves).
 *
 * ON DELETE CASCADE on `time_entries.timer_id` wipes linked entries automatically.
 */
export function deleteTimer(id: number): void {
  const db = getDb()
  const running = timeEntriesRepo.getRunning()
  const willStop = running?.timer_id === id

  // CRITICAL — sync callback. NEVER `async` (better-sqlite3 commits before await resolves).
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
    tickService.stop()
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
