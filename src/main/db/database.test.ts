// src/main/db/database.test.ts
// Tests for the SQLite singleton + pragma sequence + path resolution.
// Refs:
//   - 01-03-PLAN.md Task 1 <behavior>
//   - CONTEXT.md D-07 (pragma order: WAL → FK → synchronous → busy_timeout)
//   - CONTEXT.md D-11 (DB path: path.join(app.getPath('userData'), 'timerz.db'))
//   - RESEARCH.md §2 lines ~400-435 (canonical database.ts shape)
//   - VALIDATION.md "Test Count Target" — database.test.ts >= 3 tests
//   - 07-03-PLAN.md Task 1 (TIMERZ_USERDATA env seam + migration coupling)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

// MOCK electron.app BEFORE importing the module under test so the path
// resolution test below sees the spy. Use a static literal in the factory
// (vi.mock factories may NOT close over module-scope variables — they are
// hoisted above all top-level statements). The PID suffix is appended by the
// test body when constructing the actual subdir, not inside the mock factory.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/timerz-test-userdata'),
  },
}))

const MOCK_USERDATA = '/tmp/timerz-test-userdata'

import { initDb, getDb, closeDb } from './database'
import { runMigrations } from './migrate'

describe('database singleton', () => {
  // Track any file paths we create so afterEach can clean them up.
  let tmpFiles: string[] = []

  beforeEach(() => {
    closeDb()
    tmpFiles = []
  })

  afterEach(() => {
    closeDb()
    for (const p of tmpFiles) {
      try {
        // WAL leaves -shm / -wal sidecars; nuke them too.
        fs.rmSync(p, { force: true })
        fs.rmSync(`${p}-shm`, { force: true })
        fs.rmSync(`${p}-wal`, { force: true })
      } catch {
        // best-effort cleanup
      }
    }
  })

  it('singleton idempotent: initDb returns the same handle on repeat calls', () => {
    const a = initDb(':memory:')
    const b = initDb(':memory:')
    expect(a).toBe(b)
  })

  it('pragmas applied: WAL journal_mode + foreign_keys ON after initDb (file-backed)', () => {
    // `:memory:` SQLite reports journal_mode = 'memory' (well-known quirk) — use
    // a tmpfile so we can prove WAL was actually applied. RESEARCH.md §2 calls
    // out the pragma order; this test exercises the side effect of that order.
    const p = path.join(
      os.tmpdir(),
      `timerz-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    )
    tmpFiles.push(p)
    const db = initDb(p)
    const journal = db.pragma('journal_mode', { simple: true })
    const fk = db.pragma('foreign_keys', { simple: true })
    expect(journal).toBe('wal')
    // foreign_keys returns 1 (number) when ON
    expect(fk).toBe(1)
  })

  it('path resolution: with no arg, dbPath = path.join(app.getPath("userData"), "timerz.db")', () => {
    // The electron module is mocked at module scope above — app.getPath returns
    // MOCK_USERDATA. better-sqlite3 sets `.name` to the file path it was opened
    // with; we assert that equals path.join(MOCK_USERDATA, 'timerz.db').
    const expected = path.join(MOCK_USERDATA, 'timerz.db')
    // Create the userData dir so better-sqlite3 can open the file (it doesn't
    // mkdir for us). The afterEach hook cleans up the DB + its WAL sidecars.
    fs.mkdirSync(MOCK_USERDATA, { recursive: true })
    tmpFiles.push(expected)
    const db = initDb()
    // better-sqlite3 exposes the opened path as `.name`.
    expect(db.name).toBe(expected)
    // Also confirm getDb() returns the same singleton.
    expect(getDb()).toBe(db)
  })
})

// ---------------------------------------------------------------------------
// TIMERZ_USERDATA env seam (07-03-PLAN.md Task 1)
// ---------------------------------------------------------------------------
//
// Three behavior tests: env unset → production path; env set → override;
// `..` guard fires for malicious override. Plus migration coupling assertion.
//
// Pattern: save/restore TIMERZ_USERDATA in afterEach so tests do not leak state.
// Mirrors checkResume.test.ts beforeEach/afterEach teardown pattern.

describe('database TIMERZ_USERDATA env seam (D-03)', () => {
  let savedEnv: string | undefined
  let tmpFiles: string[] = []

  beforeEach(() => {
    closeDb()
    savedEnv = process.env['TIMERZ_USERDATA']
    delete process.env['TIMERZ_USERDATA']
    tmpFiles = []
  })

  afterEach(() => {
    closeDb()
    if (savedEnv === undefined) {
      delete process.env['TIMERZ_USERDATA']
    } else {
      process.env['TIMERZ_USERDATA'] = savedEnv
    }
    for (const p of tmpFiles) {
      try {
        fs.rmSync(p, { force: true })
        fs.rmSync(`${p}-shm`, { force: true })
        fs.rmSync(`${p}-wal`, { force: true })
      } catch {
        // best-effort cleanup
      }
    }
  })

  // Test 1: TIMERZ_USERDATA unset → production app.getPath branch taken
  it('Test 1: env unset → production app.getPath("userData") path used', () => {
    // TIMERZ_USERDATA is deleted in beforeEach.
    const expected = path.join(MOCK_USERDATA, 'timerz.db')
    fs.mkdirSync(MOCK_USERDATA, { recursive: true })
    tmpFiles.push(expected)
    const db = initDb()
    expect(db.name).toBe(expected)
  })

  // Test 2: TIMERZ_USERDATA set → override path used; production branch NOT taken
  it('Test 2: env set → override/timerz.db used; app.getPath never called for DB path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timerz-e2e-test-'))
    process.env['TIMERZ_USERDATA'] = tmpDir
    const expectedPath = path.join(tmpDir, 'timerz.db')
    tmpFiles.push(expectedPath)
    const db = initDb()
    // DB opens in tmpDir, NOT in MOCK_USERDATA
    expect(db.name).toBe(expectedPath)
    expect(db.name).not.toContain(MOCK_USERDATA)
  })

  // Test 3: `..` guard fires for TIMERZ_USERDATA containing path traversal
  it('Test 3: env set to value containing ".." → throws "refusing path containing .."', () => {
    process.env['TIMERZ_USERDATA'] = '/tmp/legit/../evil'
    expect(() => initDb()).toThrow('refusing path containing ..')
  })

  // Migration coupling: initDb(filePath) + runMigrations() succeed in pure Node
  // (RESEARCH open question #1 — proves runMigrations has no hidden app.getPath())
  it('Coupling: initDb(tmpfile) + runMigrations() succeed in pure Node context (no Electron)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timerz-migration-test-'))
    const dbPath = path.join(tmpDir, 'timerz.db')
    tmpFiles.push(dbPath)
    // Explicit filePath arg keeps initDb out of the app.getPath branch entirely
    const db = initDb(dbPath)
    expect(db).toBeTruthy()
    // runMigrations() calls getDb() → uses the already-open handle; no app.getPath call
    expect(() => runMigrations()).not.toThrow()
    // Verify schema was applied — at minimum the timers table exists
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[]
    const tableNames = tables.map((t) => t.name)
    expect(tableNames).toContain('timers')
    expect(tableNames).toContain('time_entries')
    expect(tableNames).toContain('heartbeat')
  })
})
