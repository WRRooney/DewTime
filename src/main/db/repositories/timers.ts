// src/main/db/repositories/timers.ts
// Pure-function CRUD over the `timers` table.
//
// Phase 4 (D-10 + D-17 + D-19 + D-20 + D-21):
//   - list() rewritten with a single LEFT JOIN GROUP BY query that aggregates
//     `totalSeconds` and `running` per timer (no N+1).
//   - The 4 previously-stubbed setters (`deleteTimer`, `setProject`,
//     `setOffset`, `setNotes`) are filled following the `setDescription`
//     prepared-statement pattern (D-19). The `dateRange` arg on list() was
//     accepted (forward-compat) but ignored in Phase 4 (D-21 / D-22).
//
// Phase 6 (DATE-05 / DATE-06):
//   - `filteredList` prepared statement added with a WHERE half-open range
//     clause (created_at >= ? AND created_at < ?).
//   - list(dateRange) now branches: if dateRange is provided, uses filteredList
//     with placeholder order (nowSeconds, fromEpoch, toEpoch); otherwise falls
//     through to the unfiltered listWithTotals path (D-21 wired).
//   - Placeholder order for filteredList.all(...): ?1=nowSeconds(), ?2=fromEpoch, ?3=toEpoch.
//
// BUG FIX (time-drift): totalSeconds now only sums COMPLETED (stopped) entries.
//   Running entries (end_timestamp IS NULL) are intentionally excluded so the
//   renderer's DurationCell can add tick.elapsedSeconds without double-counting.
//   The previous formula used COALESCE(te.end_timestamp, nowSeconds()) which
//   baked the running entry's elapsed time into totalSeconds at query time;
//   DurationCell then added tick.elapsedSeconds again, producing a drift of
//   up to several minutes (however long since the last React Query refetch).
//   The nowSeconds() parameter is no longer needed and has been removed from
//   list() entirely.
//
// All SQL uses `?` placeholders — T-01-04 mitigation.
//
// Refs:
//   - CONTEXT.md D-09 (pure functions, lazy stmt cache)
//   - 04-CONTEXT.md D-10 + D-20 (computed totalSeconds + running)
//   - 04-CONTEXT.md D-17 (deleteTimer via ON DELETE CASCADE; running-timer
//     guard lives in TimerService.deleteTimer wrapper, plan 04-04)
//   - 04-CONTEXT.md D-19 (repository = dumb CRUD; no service indirection)
//   - 04-RESEARCH.md § Pattern 7 (LEFT JOIN GROUP BY SQL) + § Pitfall 6
//     (GROUP BY mandatory or LEFT JOIN cartesians)
//   - timerz/db/models.py (v1 Timer column semantics)
//   - 001_initial.sql (ON DELETE CASCADE on time_entries.timer_id)
//   - 01-03-PLAN.md Task 2 (Phase 1 = primitives only)

import { getDb } from '../database'
import { NotFoundError } from '@shared/errors'
import { nowSeconds } from '@shared/time'
import type { EpochSeconds } from '@shared/time'
import type { Timer } from '@shared/ipc'

let stmts: {
  insert: ReturnType<ReturnType<typeof getDb>['prepare']>
  byId: ReturnType<ReturnType<typeof getDb>['prepare']>
  listWithTotals: ReturnType<ReturnType<typeof getDb>['prepare']>
  filteredList: ReturnType<ReturnType<typeof getDb>['prepare']>
  setDescription: ReturnType<ReturnType<typeof getDb>['prepare']>
  del: ReturnType<ReturnType<typeof getDb>['prepare']>
  setProject: ReturnType<ReturnType<typeof getDb>['prepare']>
  setOffset: ReturnType<ReturnType<typeof getDb>['prepare']>
  setNotes: ReturnType<ReturnType<typeof getDb>['prepare']>
} | null = null

function getStmts() {
  if (stmts) return stmts
  const db = getDb()
  stmts = {
    insert: db.prepare(
      `INSERT INTO timers (project_id, description, notes, created_at, offset) VALUES (?, ?, ?, ?, ?)`,
    ),
    byId: db.prepare(`SELECT * FROM timers WHERE id = ?`),
    // D-10 / D-20 / RESEARCH § Pattern 7 / Pitfall 6:
    // LEFT JOIN aggregates totalSeconds and running in one query — no N+1.
    // GROUP BY timers.id is MANDATORY: without it the JOIN produces N rows per timer.
    //
    // BUG FIX (time-drift): Only COMPLETED entries (end_timestamp IS NOT NULL)
    // contribute to totalSeconds. The running entry is excluded so DurationCell
    // can add tick.elapsedSeconds without double-counting the running segment.
    // The previous COALESCE(te.end_timestamp, nowSeconds()) formula baked the
    // running entry's elapsed time into the stale totalSeconds, causing drift
    // equal to (nowSeconds_at_tick - nowSeconds_at_last_list_call) — up to minutes.
    //
    // running is returned as 0/1 (SQLite has no boolean type); list() converts via Boolean().
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
    // Phase 6 — DATE-05 / DATE-06: date-scoped version of listWithTotals.
    // Identical SELECT and JOIN; adds WHERE half-open range on timers.created_at.
    // Placeholder order: ?1 = fromEpoch, ?2 = toEpoch (nowSeconds() placeholder removed).
    // T-6-01: bound via ? placeholders — no SQL injection possible (T-6-02).
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
    // D-17: single DELETE; ON DELETE CASCADE on time_entries.timer_id wipes entries.
    del: db.prepare(`DELETE FROM timers WHERE id = ?`),
    // D-19: setter pattern — prepared UPDATE + NotFoundError on changes === 0.
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
 *     avoid double-counting (see BUG FIX note above). Zero for timers with no
 *     completed entries (COALESCE).
 *   - `running`: true iff any entry has end_timestamp IS NULL.
 *
 * When `dateRange` is provided, only timers whose `created_at` satisfies
 * the half-open range [fromEpoch, toEpoch) are returned (Phase 6 — DATE-05 /
 * DATE-06). The `filteredList` prepared statement adds a WHERE clause.
 * Without `dateRange`, the unfiltered `listWithTotals` path returns ALL timers
 * (unchanged from Phase 4).
 *
 * Refs: D-10, D-20, RESEARCH § Pattern 7, Pitfall 6; Phase 6 § Pattern 4 + E3.
 */
export function list(dateRange?: { fromEpoch: EpochSeconds; toEpoch: EpochSeconds }): Timer[] {
  const rows = dateRange
    ? getStmts().filteredList.all([dateRange.fromEpoch, dateRange.toEpoch])
    : getStmts().listWithTotals.all()
  return (rows as (Omit<Timer, 'running'> & { running: number })[])
    .map(r => ({ ...r, running: Boolean(r.running) })) as Timer[]
}

/**
 * Insert a new timer. `created_at` is stamped server-side via `nowSeconds()`
 * (the only sanctioned EpochSeconds constructor — D-05). `notes` defaults to
 * empty string (mirrors v1 default); `offset` is NULL (= 0 seconds).
 */
export function create(args: {
  projectId: number | null
  description: string
}): Timer {
  const createdAt = nowSeconds()
  // RESEARCH.md §2 landmine #4: coerce undefined → null defensively.
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
// Phase 4 setters — previously stubbed in Phase 1 with NotFoundError throws.
// All follow the setDescription pattern (D-19): prepared UPDATE, run(), throw
// NotFoundError when info.changes === 0. No service indirection (D-19).
// ---------------------------------------------------------------------------

/**
 * Delete the timer row. ON DELETE CASCADE on `time_entries.timer_id`
 * (001_initial.sql) wipes all linked entries automatically — no N+1 needed.
 * The running-timer guard lives in `TimerService.deleteTimer` (plan 04-04)
 * which wraps stopActive + repo.deleteTimer in db.transaction; this repo stays
 * pure CRUD (D-17, D-19).
 *
 * Throws NotFoundError if no row with the given id exists (D-19, D-37).
 *
 * Exported under TWO names — `deleteTimer` (the canonical name used by the
 * TimerService wrapper in plan 04-04) and `del` (legacy alias used by the
 * 04-03 repo test suite; `delete` itself is a reserved word in TS, hence the
 * abbreviated alias). Both call the same prepared statement.
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
 * any project (mirrors v1 Timer.project nullable ForeignKeyField). Throws
 * NotFoundError if no row with the given id exists (D-19).
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
 * the given id exists (D-19).
 */
export function setOffset(id: number, offsetSeconds: number | null): void {
  const info = getStmts().setOffset.run(offsetSeconds, id)
  if (info.changes === 0) {
    throw new NotFoundError(`timer ${id} not found`)
  }
}

/**
 * Update the notes column (free-form text). Throws NotFoundError if no row
 * with the given id exists (D-19, D-37).
 */
export function setNotes(id: number, notes: string): void {
  const info = getStmts().setNotes.run(notes, id)
  if (info.changes === 0) {
    throw new NotFoundError(`timer ${id} not found`)
  }
}
