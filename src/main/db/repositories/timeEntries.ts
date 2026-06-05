// src/main/db/repositories/timeEntries.ts
// Pure-function CRUD over the `time_entries` table. Persistence primitives —
// start, listByTimer, getRunning, stop, stopActive. The
// single-active-timer invariant lives in Phase 2's TimerService FSM (Plan
// 02-02), which composes start() inside `db.transaction(() => { stopActive();
// start(id); })` to prevent two concurrent open entries. This module remains
// dumb CRUD (D-19) — no transaction wrapper here.
//
// All SQL uses `?` placeholders — T-01-04 mitigation (Phase 1 carry-forward).
// All timestamps use `nowSeconds()` from `@shared/time` — never raw
// millisecond-to-second arithmetic (D-08, T-02-02 mitigation).
//
// Refs:
//   - CONTEXT.md D-09 (pure functions, lazy stmt cache)
//   - 02-CONTEXT.md D-04 (stopActive idempotent — returns null, no throw)
//   - 02-CONTEXT.md D-08 (timestamps via nowSeconds())
//   - 02-CONTEXT.md D-19 (repository = dumb CRUD; service composes transactions)
//   - timerz/db/models.py (v1 TimeEntry: timer_id FK NOT NULL, start_timestamp
//     NOT NULL, end_timestamp NULL = running)
//   - timerz/services/timer_service.py (v1 stop_timer/stop_active_timer semantics)
//   - 001_initial.sql idx_time_entries_running (partial index supporting the
//     Phase 2 FSM invariant)
//   - 01-03-PLAN.md Task 2 (Phase 1 = primitives only)
//   - 02-01-PLAN.md (Phase 2 fills stop + stopActive)

import { getDb } from '../database'
import { NotFoundError, ValidationError } from '@shared/errors'
import { nowSeconds } from '@shared/time'
import type { EpochSeconds } from '@shared/time'
import type { TimeEntry } from '@shared/ipc'

let stmts: {
  insert: ReturnType<ReturnType<typeof getDb>['prepare']>
  byId: ReturnType<ReturnType<typeof getDb>['prepare']>
  listByTimer: ReturnType<ReturnType<typeof getDb>['prepare']>
  running: ReturnType<ReturnType<typeof getDb>['prepare']>
  stopRunning: ReturnType<ReturnType<typeof getDb>['prepare']>
  // Phase 5 D-09: service-bypass timestamp setters (pure writes, no FSM transition)
  setStart: ReturnType<ReturnType<typeof getDb>['prepare']>
  setEnd: ReturnType<ReturnType<typeof getDb>['prepare']>
} | null = null

function getStmts() {
  if (stmts) return stmts
  const db = getDb()
  stmts = {
    insert: db.prepare(
      `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`,
    ),
    byId: db.prepare(`SELECT * FROM time_entries WHERE id = ?`),
    listByTimer: db.prepare(
      `SELECT * FROM time_entries WHERE timer_id = ? ORDER BY start_timestamp ASC, id ASC`,
    ),
    running: db.prepare(
      `SELECT * FROM time_entries WHERE end_timestamp IS NULL ORDER BY start_timestamp DESC LIMIT 1`,
    ),
    // SQLite ≥ 3.35 supports RETURNING; better-sqlite3 12.x surfaces the
    // post-update row via `.get()`. The partial index
    // idx_time_entries_running keeps the WHERE clause O(1).
    stopRunning: db.prepare(
      `UPDATE time_entries SET end_timestamp = ? WHERE end_timestamp IS NULL RETURNING *`,
    ),
    // Phase 5 D-09: pure timestamp writes — no FSM transition.
    setStart: db.prepare(
      `UPDATE time_entries SET start_timestamp = ? WHERE id = ?`,
    ),
    setEnd: db.prepare(
      `UPDATE time_entries SET end_timestamp = ? WHERE id = ?`,
    ),
  }
  return stmts
}

/** Reset the prepared-statement cache. Called from tests between cases. */
export function resetStmtCache(): void {
  stmts = null
}

/**
 * Create a new RUNNING time entry for the given timer. `start_timestamp` is
 * stamped server-side via `nowSeconds()`. `end_timestamp` is NULL — meaning
 * "currently running". The single-active-timer invariant is NOT enforced
 * here — that's Phase 2's TimerService FSM (which calls `stopActive` then
 * `start` inside a transaction).
 */
export function start(timerId: number): TimeEntry {
  const startTs = nowSeconds()
  const info = getStmts().insert.run(timerId, startTs, null)
  const id = info.lastInsertRowid as number
  const row = getStmts().byId.get(id) as TimeEntry | undefined
  if (!row) {
    throw new NotFoundError(
      `time_entries ${id} vanished immediately after insert`,
    )
  }
  return row
}

/** Return all entries for a timer ordered by start_timestamp ascending. */
export function listByTimer(timerId: number): TimeEntry[] {
  return getStmts().listByTimer.all(timerId) as TimeEntry[]
}

/**
 * Return the currently-running entry, or null if no timer is running. Uses
 * the partial index `idx_time_entries_running` for O(1) lookup. Phase 2
 * relies on this to enforce the single-active-timer invariant.
 */
export function getRunning(): TimeEntry | null {
  const row = getStmts().running.get() as TimeEntry | undefined
  return row ?? null
}

// ---------------------------------------------------------------------------
// Phase 2 persistence primitives — stop / stopActive. Dumb CRUD (D-19); the
// TimerService FSM (Plan 02-02) composes these inside db.transaction().
// ---------------------------------------------------------------------------

/**
 * Stop the currently-running entry (whichever row has `end_timestamp IS NULL`)
 * by writing `end_timestamp = nowSeconds()` and returning the updated row.
 *
 * Idempotent (02-CONTEXT.md D-04): if no row is running, returns `null`
 * without throwing. Callers — including the upcoming TimerService FSM
 * transaction — rely on this no-throw contract.
 *
 * Uses SQL `UPDATE ... RETURNING *` for the single-statement read-after-write,
 * supported by SQLite ≥ 3.35 (better-sqlite3 12.x).
 */
export function stopActive(): TimeEntry | null {
  const row = getStmts().stopRunning.get(nowSeconds()) as TimeEntry | undefined
  return row ?? null
}

/**
 * Stop a specific timer's running entry. If the currently-running entry
 * belongs to `timerId`, delegate to `stopActive()` and return the updated
 * row. Otherwise — no entry is running, or the running entry belongs to a
 * different timer — return `null` without modifying any row.
 *
 * The "wrong timer is a no-op" branch mirrors v1's `stop_timer` (see
 * timerz/services/timer_service.py): the UI's per-row stop button must not
 * stop a sibling timer just because the user clicked the wrong row.
 *
 * Read-then-update is safe in the single-writer SQLite model and matches
 * better-sqlite3's synchronous semantics — no race window. The TimerService
 * FSM (Plan 02-02) will wrap multi-step compositions in `db.transaction`.
 */
export function stop(timerId: number): TimeEntry | null {
  const running = getRunning()
  if (running === null || running.timer_id !== timerId) {
    return null
  }
  return stopActive()
}

// ---------------------------------------------------------------------------
// Phase 5 D-09: timestamp setters. Service-bypass exception — pure writes,
// no FSM transition. Running-entry end guard: setEnd reads before writing.
// T-5-01/T-5-06/T-5-08/T-5-09 mitigations applied here.
// ---------------------------------------------------------------------------

/**
 * Update a time entry's start_timestamp.
 * D-09/D-08: start is always editable (no running-entry restriction on start);
 * any positive EpochSeconds is accepted. Only the NotFound guard applies.
 * T-5-09: prepared statement with `?` placeholder prevents SQL injection.
 * Throws NotFoundError if no row updated (T-5-08).
 */
export function setStart(entryId: number, ts: EpochSeconds): void {
  const entry = getStmts().byId.get(entryId) as TimeEntry | undefined
  if (!entry) throw new NotFoundError(`time_entries ${entryId} not found`)
  // D-09 ordering guard: a stopped entry must keep start < end. Running entries
  // (end_timestamp IS NULL) have no end to violate, so start stays freely editable (D-08).
  if (entry.end_timestamp !== null && ts >= entry.end_timestamp) {
    throw new ValidationError('start_timestamp must be before end_timestamp')
  }
  const info = getStmts().setStart.run([ts, entryId])
  if (info.changes === 0) {
    throw new NotFoundError(`time_entries ${entryId} not found`)
  }
}

/**
 * Update a time entry's end_timestamp.
 * D-09 guard: validates start < end by reading the entry first (T-5-01).
 * D-08 guard: rejects if current end_timestamp IS NULL (running entry read-only) (T-5-06).
 * T-5-09: prepared statement with `?` placeholder prevents SQL injection.
 * Throws NotFoundError if entry missing (T-5-08); ValidationError if ordering violated
 * or entry is running.
 */
export function setEnd(entryId: number, endTs: EpochSeconds): void {
  const entry = getStmts().byId.get(entryId) as TimeEntry | undefined
  if (!entry) throw new NotFoundError(`time_entries ${entryId} not found`)
  if (entry.end_timestamp === null) {
    throw new ValidationError('cannot edit end_timestamp of a running entry')
  }
  if (entry.start_timestamp >= endTs) {
    throw new ValidationError('end_timestamp must be after start_timestamp')
  }
  const info = getStmts().setEnd.run([endTs, entryId])
  if (info.changes === 0) throw new NotFoundError(`time_entries ${entryId} not found`)
}
