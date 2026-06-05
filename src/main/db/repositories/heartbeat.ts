// src/main/db/repositories/heartbeat.ts
// Single-row repository over the `heartbeat` table. The id=1 single-row
// pattern matches v1 (see timerz/services/timer_service.py ~line 98).
//
// All SQL uses `?` placeholders — T-01-04 mitigation.
//
// Refs:
//   - CONTEXT.md D-09 (pure functions, lazy stmt cache)
//   - timerz/db/models.py (Heartbeat: last_beat NOT NULL, timer_entry_id
//     intentionally NOT a FK — avoids cascade complexity)
//   - 01-03-PLAN.md Task 2 (Phase 1 = primitives; scheduler wires in Phase 2)

import type Database from 'better-sqlite3'
import { getDb } from '../database'
import type { EpochSeconds } from '@shared/time'

let stmts: {
  upsert: Database.Statement<unknown[]>
  read: Database.Statement<unknown[]>
} | null = null

function getStmts() {
  if (stmts) return stmts
  const db = getDb()
  stmts = {
    // The single-row pattern: id is hard-coded to 1; INSERT OR REPLACE
    // overwrites the existing row (if any) atomically.
    upsert: db.prepare(
      `INSERT OR REPLACE INTO heartbeat (id, last_beat, timer_entry_id) VALUES (1, ?, ?)`,
    ),
    read: db.prepare(`SELECT * FROM heartbeat WHERE id = 1`),
  }
  return stmts
}

/** Reset the prepared-statement cache. Called from tests between cases. */
export function resetStmtCache(): void {
  stmts = null
}

/**
 * Write the current heartbeat. Idempotent — every call overwrites the single
 * row (id=1). Called every 60s by the Phase 2 heartbeat scheduler.
 *
 * @param beatAt the current EpochSeconds (caller must use `nowSeconds()`)
 * @param timerEntryId the running time_entries.id, or null if no timer running
 */
export function write(beatAt: EpochSeconds, timerEntryId: number | null): void {
  // RESEARCH.md §2 landmine #4: coerce undefined → null defensively.
  getStmts().upsert.run(beatAt, timerEntryId ?? null)
}

/**
 * Read the current heartbeat row, or null if no row exists yet. The brand
 * is applied at the read boundary: SQLite returns a plain number, but the
 * Heartbeat consumer treats `last_beat` as `EpochSeconds`. RESEARCH.md §2
 * lines ~22-25 sanction the `as EpochSeconds` cast at this boundary.
 */
export function read(): {
  last_beat: EpochSeconds
  timer_entry_id: number | null
} | null {
  const row = getStmts().read.get() as
    | { id: number; last_beat: number; timer_entry_id: number | null }
    | undefined
  if (!row) return null
  return {
    last_beat: row.last_beat as EpochSeconds,
    timer_entry_id: row.timer_entry_id,
  }
}
