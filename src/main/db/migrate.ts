// src/main/db/migrate.ts
// PRAGMA user_version migration runner. Each migration runs in its own
// transaction. The user_version bump is inside the SAME transaction so a
// crash mid-migration leaves the DB at the previous version, never at a
// partially-applied state.
//
// Refs:
//   - CONTEXT.md D-08 (raw SQL migrations, PRAGMA user_version, partial-apply impossible)
//   - RESEARCH.md §3 lines ~549-595 (canonical runner pattern; VERIFIED)
//   - CONTEXT.md "Specific Ideas" — the single-transaction rule is non-negotiable

import { getDb } from './database'
import { MIGRATIONS } from './migrations'

/**
 * Apply any pending migrations.
 *
 * Reads `PRAGMA user_version` to determine the current schema version. For
 * each migration in MIGRATIONS whose `version` is greater, runs the SQL and
 * bumps `user_version` to match — both inside the same SQLite transaction.
 *
 * Idempotent: if all migrations are already applied, this is a no-op.
 *
 * Each migration runs in its own transaction. The user_version bump is inside
 * the same transaction so a crash mid-migration leaves the DB at the previous
 * version, never at a partially-applied state.
 */
export function runMigrations(): void {
  const db = getDb()
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0

  // Defensive sort: migrations as authored should already be in ascending
  // order, but if a future contributor appends out of order this guards
  // against applying version 3 before version 2.
  const sorted = [...MIGRATIONS].sort((a, b) => a.version - b.version)

  for (const m of sorted) {
    if (m.version <= current) continue
    // The transaction function is synchronous (better-sqlite3 docs/api.md —
    // "Transaction functions do not work with async functions"). Calling the
    // returned function executes the body inside BEGIN/COMMIT, rolling back
    // on any thrown error. The user_version bump being inside the body is
    // load-bearing — moving it outside the txn re-introduces the partial-
    // apply window.
    const apply = db.transaction(() => {
      db.exec(m.sql)
      db.pragma(`user_version = ${m.version}`)
    })
    apply()
  }
}
