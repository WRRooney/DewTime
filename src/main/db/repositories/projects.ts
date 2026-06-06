// Pure-function CRUD over the `projects` table.
// All SQL uses `?` placeholders to prevent SQL injection.

import type Database from 'better-sqlite3'
import { getDb } from '../database'
import { NotFoundError } from '@shared/errors'
import type { Project } from '@shared/ipc'

// Lazy prepared-statement cache. Tests call `resetStmtCache()` between cases
// so a fresh DB connection gets fresh statements.
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
 * @param name the project_name (required; non-empty enforced at the IPC boundary by Zod)
 * @param number the project_number (nullable)
 */
export function create(name: string, number: string | null): Project {
  // Coerce to `null` defensively: better-sqlite3 throws on `undefined`.
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
