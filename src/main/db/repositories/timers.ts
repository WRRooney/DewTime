// Pure-function CRUD over the `timers` table.
//
// list() uses a single LEFT JOIN GROUP BY query to aggregate `totalSeconds`
// and `running` per timer (no N+1). totalSeconds sums only COMPLETED (stopped)
// entries — running entries are excluded so the renderer's DurationCell can
// add tick.elapsedSeconds without double-counting. The previous
// COALESCE(te.end_timestamp, nowSeconds()) formula baked the running entry's
// elapsed time into totalSeconds at query time, causing drift equal to the
// time since the last refetch.
//
// When `dateRange` is provided to list(), a WHERE half-open range
// (created_at >= fromEpoch AND created_at < toEpoch) is applied.
//
// All SQL uses `?` placeholders to prevent SQL injection.

import type Database from 'better-sqlite3'
import { getDb } from '../database'
import { NotFoundError } from '@shared/errors'
import { nowSeconds } from '@shared/time'
import type { EpochSeconds } from '@shared/time'
import type { Timer } from '@shared/ipc'

let stmts: {
  insert: Database.Statement<unknown[]>
  byId: Database.Statement<unknown[]>
  listWithTotals: Database.Statement<unknown[]>
  filteredList: Database.Statement<unknown[]>
  setDescription: Database.Statement<unknown[]>
  del: Database.Statement<unknown[]>
  setProject: Database.Statement<unknown[]>
  setOffset: Database.Statement<unknown[]>
  setNotes: Database.Statement<unknown[]>
} | null = null

function getStmts() {
  if (stmts) return stmts
  const db = getDb()
  stmts = {
    insert: db.prepare(
      `INSERT INTO timers (project_id, description, notes, created_at, offset) VALUES (?, ?, ?, ?, ?)`,
    ),
    byId: db.prepare(`SELECT * FROM timers WHERE id = ?`),
    // LEFT JOIN aggregates totalSeconds and running in one query — no N+1.
    // GROUP BY timers.id is MANDATORY: without it the JOIN produces N rows per timer.
    // Only COMPLETED entries contribute to totalSeconds (see file header).
    // `running` is 0/1 (SQLite has no boolean type); list() converts via Boolean().
    listWithTotals: db.prepare(`
      SELECT
        timers.id, timers.project_id, timers.description, timers.notes,
        timers.created_at, timers.offset,
        COALESCE(SUM(CASE WHEN te.end_timestamp IS NOT NULL THEN te.end_timestamp - te.start_timestamp ELSE 0 END), 0)
          + COALESCE(timers.offset, 0) AS totalSeconds,
        COALESCE(MAX(CASE WHEN te.id IS NOT NULL AND te.end_timestamp IS NULL THEN 1 ELSE 0 END), 0) AS running
      FROM timers
      LEFT JOIN time_entries te ON te.timer_id = timers.id
      GROUP BY timers.id
      ORDER BY timers.created_at DESC, timers.id DESC
    `),
    // Date-scoped version of listWithTotals. Adds WHERE half-open range on
    // timers.created_at. Placeholder order: ?1 = fromEpoch, ?2 = toEpoch.
    filteredList: db.prepare(`
      SELECT
        timers.id, timers.project_id, timers.description, timers.notes,
        timers.created_at, timers.offset,
        COALESCE(SUM(CASE WHEN te.end_timestamp IS NOT NULL THEN te.end_timestamp - te.start_timestamp ELSE 0 END), 0)
          + COALESCE(timers.offset, 0) AS totalSeconds,
        COALESCE(MAX(CASE WHEN te.id IS NOT NULL AND te.end_timestamp IS NULL THEN 1 ELSE 0 END), 0) AS running
      FROM timers
      LEFT JOIN time_entries te ON te.timer_id = timers.id
      WHERE timers.created_at >= ? AND timers.created_at < ?
      GROUP BY timers.id
      ORDER BY timers.created_at DESC, timers.id DESC
    `),
    setDescription: db.prepare(
      `UPDATE timers SET description = ? WHERE id = ?`,
    ),
    // ON DELETE CASCADE on time_entries.timer_id wipes entries automatically.
    del: db.prepare(`DELETE FROM timers WHERE id = ?`),
    setProject: db.prepare(`UPDATE timers SET project_id = ? WHERE id = ?`),
    setOffset: db.prepare(`UPDATE timers SET offset = ? WHERE id = ?`),
    setNotes: db.prepare(`UPDATE timers SET notes = ? WHERE id = ?`),
  }
  return stmts
}

/** Reset the prepared-statement cache. Called from tests between cases. */
export function resetStmtCache(): void {
  stmts = null
}

/**
 * Return timers ordered by created_at descending, then id descending.
 *
 * Each row includes computed columns:
 *   - `totalSeconds`: sum of all COMPLETED (stopped) entry durations plus the
 *     persistent offset. Running entries are intentionally excluded — the
 *     renderer's DurationCell adds tick.elapsedSeconds for the live segment to
 *     avoid double-counting (see file header). Zero for timers with no
 *     completed entries (COALESCE).
 *   - `running`: true iff any entry has end_timestamp IS NULL.
 *
 * When `dateRange` is provided, only timers whose `created_at` satisfies
 * the half-open range [fromEpoch, toEpoch) are returned via the
 * `filteredList` prepared statement. Without `dateRange`, ALL timers are
 * returned.
 */
export function list(dateRange?: { fromEpoch: EpochSeconds; toEpoch: EpochSeconds }): Timer[] {
  const rows = dateRange
    ? getStmts().filteredList.all([dateRange.fromEpoch, dateRange.toEpoch])
    : getStmts().listWithTotals.all()
  return (rows as (Omit<Timer, 'running'> & { running: number })[])
    .map(r => ({ ...r, running: Boolean(r.running) })) as Timer[]
}

/**
 * Insert a new timer. `created_at` is stamped server-side via `nowSeconds()`.
 * `notes` defaults to empty string; `offset` is NULL (= 0 seconds).
 */
export function create(args: {
  projectId: number | null
  description: string
}): Timer {
  const createdAt = nowSeconds()
  // Coerce to null defensively: better-sqlite3 throws on `undefined`.
  const info = getStmts().insert.run(
    args.projectId ?? null,
    args.description,
    '',
    createdAt,
    null,
  )
  const id = info.lastInsertRowid as number
  const row = getStmts().byId.get(id) as Timer | undefined
  if (!row) {
    throw new NotFoundError(`timer ${id} vanished immediately after insert`)
  }
  return row
}

/**
 * Look up a timer by id. Throws NotFoundError if no such row exists.
 */
export function byId(id: number): Timer {
  const row = getStmts().byId.get(id) as Timer | undefined
  if (!row) throw new NotFoundError(`timer ${id} not found`)
  return row
}

/** Update only the description column. Throws NotFoundError if id missing. */
export function setDescription(id: number, description: string): void {
  const info = getStmts().setDescription.run(description, id)
  if (info.changes === 0) {
    throw new NotFoundError(`timer ${id} not found`)
  }
}

// ---------------------------------------------------------------------------
// Setters — prepared UPDATE, run(), throw NotFoundError when changes === 0.
// ---------------------------------------------------------------------------

/**
 * Delete the timer row. ON DELETE CASCADE on `time_entries.timer_id` wipes all
 * linked entries automatically — no N+1 needed. The running-timer guard lives
 * in `TimerService.deleteTimer` which wraps stopActive + this function in
 * db.transaction; this repo stays pure CRUD.
 *
 * Throws NotFoundError if no row with the given id exists.
 *
 * Exported under two names — `deleteTimer` (canonical) and `del` (alias, since
 * `delete` is a reserved word in TS). Both call the same prepared statement.
 */
export function deleteTimer(id: number): void {
  const info = getStmts().del.run(id)
  if (info.changes === 0) {
    throw new NotFoundError(`timer ${id} not found`)
  }
}

export const del = deleteTimer

/**
 * Update the project_id FK column. Pass `null` to disassociate the timer from
 * any project. Throws NotFoundError if no row with the given id exists.
 */
export function setProject(id: number, projectId: number | null): void {
  const info = getStmts().setProject.run(projectId, id)
  if (info.changes === 0) {
    throw new NotFoundError(`timer ${id} not found`)
  }
}

/**
 * Update the persistent duration offset column (seconds). Pass `null` to
 * clear the offset (semantically 0 s). Throws NotFoundError if no row with
 * the given id exists.
 */
export function setOffset(id: number, offsetSeconds: number | null): void {
  const info = getStmts().setOffset.run(offsetSeconds, id)
  if (info.changes === 0) {
    throw new NotFoundError(`timer ${id} not found`)
  }
}

/**
 * Update the notes column (free-form text). Throws NotFoundError if no row
 * with the given id exists.
 */
export function setNotes(id: number, notes: string): void {
  const info = getStmts().setNotes.run(notes, id)
  if (info.changes === 0) {
    throw new NotFoundError(`timer ${id} not found`)
  }
}
