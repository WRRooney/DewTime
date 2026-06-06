// Pure-function CRUD over the `time_entries` table. This module is dumb CRUD
// — the single-active-timer invariant lives in TimerService, which composes
// start() inside `db.transaction(() => { stopActive(); start(id); })`.
//
// All SQL uses `?` placeholders to prevent SQL injection.
// All timestamps use `nowSeconds()` — never raw millisecond arithmetic.

import type Database from 'better-sqlite3'
import { getDb } from '../database'
import { NotFoundError, ValidationError } from '@shared/errors'
import { nowSeconds } from '@shared/time'
import type { EpochSeconds } from '@shared/time'
import type { TimeEntry } from '@shared/ipc'

let stmts: {
  insert: Database.Statement<unknown[]>
  byId: Database.Statement<unknown[]>
  listByTimer: Database.Statement<unknown[]>
  running: Database.Statement<unknown[]>
  stopRunning: Database.Statement<unknown[]>
  // Pure timestamp setters — no FSM transition (see setStart/setEnd below).
  setStart: Database.Statement<unknown[]>
  setEnd: Database.Statement<unknown[]>
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
    // RETURNING surfaces the post-update row in one statement (SQLite ≥ 3.35).
    // idx_time_entries_running keeps the WHERE clause O(1).
    stopRunning: db.prepare(
      `UPDATE time_entries SET end_timestamp = ? WHERE end_timestamp IS NULL RETURNING *`,
    ),
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
 * stamped server-side via `nowSeconds()`. `end_timestamp` is NULL meaning
 * "currently running". The single-active-timer invariant is NOT enforced
 * here — that's TimerService (which calls `stopActive` then `start` inside
 * a transaction).
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
 * the partial index `idx_time_entries_running` for O(1) lookup.
 */
export function getRunning(): TimeEntry | null {
  const row = getStmts().running.get() as TimeEntry | undefined
  return row ?? null
}

// ---------------------------------------------------------------------------
// stop / stopActive — dumb CRUD; TimerService composes these inside
// db.transaction() for FSM invariants.
// ---------------------------------------------------------------------------

/**
 * Stop the currently-running entry (whichever row has `end_timestamp IS NULL`)
 * by writing `end_timestamp = nowSeconds()` and returning the updated row.
 *
 * Idempotent: if no row is running, returns `null` without throwing. Callers
 * including the TimerService FSM transaction rely on this no-throw contract.
 *
 * Uses SQL `UPDATE ... RETURNING *` for the single-statement read-after-write
 * (SQLite ≥ 3.35).
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
 * The "wrong timer is a no-op" branch is intentional: the UI's per-row stop
 * button must not stop a sibling timer just because the user clicked the
 * wrong row.
 *
 * Read-then-update is safe in the single-writer SQLite model — no race window.
 */
export function stop(timerId: number): TimeEntry | null {
  const running = getRunning()
  if (running === null || running.timer_id !== timerId) {
    return null
  }
  return stopActive()
}

// ---------------------------------------------------------------------------
// Timestamp setters — pure writes, no FSM transition.
// setEnd reads the entry first to enforce start < end and reject running entries.
// ---------------------------------------------------------------------------

/**
 * Update a time entry's start_timestamp. Start is always editable regardless
 * of running state; a stopped entry must still satisfy start < end.
 * Throws NotFoundError if no row found.
 */
export function setStart(entryId: number, ts: EpochSeconds): void {
  const entry = getStmts().byId.get(entryId) as TimeEntry | undefined
  if (!entry) throw new NotFoundError(`time_entries ${entryId} not found`)
  // A stopped entry must keep start < end. Running entries have no end to
  // violate, so start stays freely editable.
  if (entry.end_timestamp !== null && ts >= entry.end_timestamp) {
    throw new ValidationError('start_timestamp must be before end_timestamp')
  }
  const info = getStmts().setStart.run([ts, entryId])
  if (info.changes === 0) {
    throw new NotFoundError(`time_entries ${entryId} not found`)
  }
}

/**
 * Update a time entry's end_timestamp. Reads the entry first to validate
 * start < end and reject running entries (end_timestamp IS NULL).
 * Throws NotFoundError if entry missing; ValidationError if ordering violated
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
