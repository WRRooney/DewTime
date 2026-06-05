// src/main/db/repositories/projects.ts
// Pure-function CRUD over the `projects` table. No classes (D-09).
// All SQL uses `?` placeholders — T-01-04 (SQL injection) mitigation.
//
// Refs:
//   - CONTEXT.md D-09 (pure functions, prepared statements cached at module load)
//   - RESEARCH.md §2 lines ~448-503 (prepared-statement caching pattern;
//     lazy `getStmts()` avoids the import-order constraint)
//   - timerz/db/models.py (v1 Project: id, project_number nullable, project_name)

import type Database from 'better-sqlite3'
import { getDb } from '../database'
import { NotFoundError } from '@shared/errors'
import type { Project } from '@shared/ipc'

// Prepared statement cache — lazy module-scoped accessor. Tests call
// `resetStmtCache()` between cases (after `closeDb()`) so a fresh DB
// connection gets fresh prepared statements.
let stmts: {
  insert: Database.Statement<unknown[]>
  byId: Database.Statement<unknown[]>
  list: Database.Statement<unknown[]>
  updateNumber: Database.Statement<unknown[]>
} | null = null

function getStmts() {
  if (stmts) return stmts
  const db = getDb()
  stmts = {
    insert: db.prepare(
      `INSERT INTO projects (project_name, project_number) VALUES (?, ?)`,
    ),
    byId: db.prepare(`SELECT * FROM projects WHERE id = ?`),
    list: db.prepare(`SELECT * FROM projects ORDER BY id ASC`),
    updateNumber: db.prepare(
      `UPDATE projects SET project_number = ? WHERE id = ?`,
    ),
  }
  return stmts
}

/** Reset the prepared-statement cache. Called from tests between cases. */
export function resetStmtCache(): void {
  stmts = null
}

/** Return all projects ordered by id ascending. */
export function list(): Project[] {
  return getStmts().list.all() as Project[]
}

/**
 * Insert a new project. Returns the created row including its assigned id.
 *
 * @param name the project_name (required; non-empty enforced at the IPC
 *             boundary by Zod — this layer trusts the caller per D-15)
 * @param number the project_number (nullable; v1 CharField(null=True))
 */
export function create(name: string, number: string | null): Project {
  // RESEARCH.md §2 landmine #4: better-sqlite3 throws on `undefined`. Coerce
  // to `null` defensively even though the parameter type already excludes
  // `undefined` — the caller could still pass `undefined as unknown as null`.
  const info = getStmts().insert.run(name, number ?? null)
  const id = info.lastInsertRowid as number
  const row = getStmts().byId.get(id) as Project | undefined
  if (!row) {
    throw new NotFoundError(`project ${id} vanished immediately after insert`)
  }
  return row
}

/**
 * Look up a project by id. Returns the row, or throws NotFoundError if no
 * such row exists.
 */
export function byId(id: number): Project {
  const row = getStmts().byId.get(id) as Project | undefined
  if (!row) throw new NotFoundError(`project ${id} not found`)
  return row
}

/**
 * Update only the project_number column. Other columns are untouched.
 * Throws NotFoundError if no row was updated.
 */
export function updateNumber(id: number, number: string | null): void {
  const info = getStmts().updateNumber.run(number ?? null, id)
  if (info.changes === 0) {
    throw new NotFoundError(`project ${id} not found`)
  }
}
