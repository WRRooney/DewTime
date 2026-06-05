// src/main/db/database.ts
// SQLite singleton + pragma sequence + path resolution.
//
// Refs:
//   - CONTEXT.md D-07 (singleton, pragmas: journal_mode=WAL → foreign_keys=ON
//     → synchronous=NORMAL → busy_timeout=5000)
//   - CONTEXT.md D-11 (DB path: path.join(app.getPath('userData'), 'timerz.db'))
//   - DATA-05 (DB path uses app.getPath('userData'); T-01-05 — never concat)
//   - RESEARCH.md §2 lines ~400-435 (canonical shape; pragma rationale)
//   - RESEARCH.md §2 landmine #5 (HMR-safe early-exit on existing handle)

import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'

// Module-scoped singleton. The `if (db) return db` early-exit in initDb makes
// the function idempotent under electron-vite HMR (where the main bundle may
// be re-imported but module-scoped `let` is preserved per Node ESM semantics).
let db: Database.Database | null = null

/**
 * Open the SQLite database (idempotent — repeat calls return the same handle).
 *
 * Pragmas are applied in this exact order — see CONTEXT.md D-07:
 *   1. `journal_mode = WAL`      — write-ahead log; concurrent reads, sequential
 *                                   writes. Must be set BEFORE write traffic
 *                                   begins (it switches the file format).
 *   2. `foreign_keys = ON`        — off by default per connection; must set on
 *                                   every open. Enforces FK constraints declared
 *                                   in the schema (see 001_initial.sql).
 *   3. `synchronous = NORMAL`     — WAL + NORMAL is durable under crash but not
 *                                   OS-level kernel panic. Faster than FULL.
 *   4. `busy_timeout = 5000`      — defensive: if multiple processes ever
 *                                   contend for the lock, retry for 5s before
 *                                   raising SQLITE_BUSY.
 *
 * @param filePath — for tests, pass `:memory:` or a tmpfile; for prod, omit.
 *                  Production path is `path.join(app.getPath('userData'), 'timerz.db')`.
 * @returns the better-sqlite3 Database handle (singleton)
 */
export function initDb(filePath?: string): Database.Database {
  if (db) return db
  let dbPath: string
  if (filePath !== undefined) {
    dbPath = filePath
  } else {
    // D-03 test seam: TIMERZ_USERDATA overrides the production userData path.
    // ONLY honored when the env var is set (non-empty) — production untouched.
    // Follows the TIMERZ_SMOKE=1 / TIMERZ_NO_SANDBOX=1 convention (src/main/index.ts lines 80-82, 265).
    // The raw override value is checked for `..` BEFORE path.join (path.join resolves .. away,
    // defeating the guard below — checking the raw value catches traversal attempts).
    const testOverride = process.env['TIMERZ_USERDATA']
    if (testOverride && testOverride.length > 0) {
      if (testOverride.includes('..')) {
        throw new Error('refusing path containing ..')
      }
      dbPath = path.join(testOverride, 'timerz.db')
    } else {
      // D-11 + DATA-05 + T-01-05 mitigation: use path.join, never concat. Reject
      // any caller-controlled path containing `..` segments as a defense-in-depth
      // measure (the only real caller is plan 04's main entry, but a future
      // contributor passing a config-derived path should not be able to traverse).
      dbPath = path.join(app.getPath('userData'), 'timerz.db')
    }
  }
  if (dbPath !== ':memory:' && dbPath.includes('..')) {
    throw new Error('refusing path containing ..')
  }
  db = new Database(dbPath)
  // ORDER MATTERS — see CONTEXT.md D-07 + RESEARCH.md §2 lines ~417-422.
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  return db
}

/**
 * Return the singleton DB handle. Throws if `initDb()` has not been called
 * yet — this is the canonical error site for "main entry boot order is wrong".
 */
export function getDb(): Database.Database {
  if (!db) throw new Error('initDb() must be called before getDb()')
  return db
}

/**
 * Close the DB handle and clear the singleton. Used by tests between cases
 * and by the main process on `app.quit()` for clean shutdown.
 */
export function closeDb(): void {
  db?.close()
  db = null
}
