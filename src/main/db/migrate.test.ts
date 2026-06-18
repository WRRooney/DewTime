// src/main/db/migrate.test.ts
// Tests for the PRAGMA user_version migration runner.
// Refs:
//   - 01-03-PLAN.md Task 1 <behavior> (migrate tests, >= 2)
//   - CONTEXT.md D-08 (raw SQL migrations, PRAGMA user_version, single-transaction)
//   - RESEARCH.md §3 lines ~549-595 (canonical runner pattern)
//   - VALIDATION.md "Test Count Target" — migrate.test.ts >= 2 tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, getDb, closeDb } from './database'
import { runMigrations } from './migrate'

describe('migration runner', () => {
  beforeEach(() => {
    closeDb()
    initDb(':memory:')
  })

  afterEach(() => {
    closeDb()
  })

  it('initial-schema: all five tables exist after runMigrations() on a fresh DB', () => {
    runMigrations()
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
    const tableNames = rows.map((r) => r.name).sort()
    // All five v1-mirror tables must be present.
    expect(tableNames).toEqual(
      ['heartbeat', 'projects', 'settings', 'time_entries', 'timers'].sort(),
    )
    // user_version was bumped inside the same transaction. Plan 03-01
    // added migration 002 (settings.window_geometry seed); quick task
    // 260606-0mc added migration 003 (always_on_top seed); quick task
    // 260606-16w added migration 004 (auto_update seed); Phase 9 plan 01
    // added migration 005 (gantt settings seed), so the head is
    // now 5; the dedicated MIGR-002 test below asserts this exact value.
    const version = db.pragma('user_version', { simple: true })
    expect(version).toBe(5)
  })

  it('idempotent re-run: second runMigrations() does not duplicate seeded settings', () => {
    runMigrations()
    const db = getDb()
    const before = (
      db.prepare(`SELECT COUNT(*) as c FROM settings`).get() as { c: number }
    ).c
    // Seed an EXTRA settings row so we can prove the runner does not re-execute
    // the migrations (re-executing would INSERT the same seeded rows again and
    // either trip the PRIMARY KEY constraint or change the count). We use a
    // sentinel key (`__test.sentinel`) that is never produced by any migration,
    // so this assertion stays stable as new migrations add seeded rows.
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      '__test.sentinel',
      '42',
    )
    // Second call MUST be a no-op (user_version is already at the head).
    expect(() => runMigrations()).not.toThrow()
    const after = (
      db.prepare(`SELECT COUNT(*) as c FROM settings`).get() as { c: number }
    ).c
    // Pre-existing rows + one extra. If any migration re-applied, the seeded
    // INSERTs would have thrown (PRIMARY KEY) or the count would diverge.
    expect(after).toBe(before + 1)
  })

  // ---- Plan 03-01 additions (MIGR-002 + WIN-06a) ----

  it('WIN-06a: settings.window_geometry seeded with composite JSON default', () => {
    runMigrations()
    const db = getDb()
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'settings.window_geometry'`)
      .get() as { value: string } | undefined
    expect(row).toBeDefined()
    // Literal JSON string — exact match (no whitespace, null x/y sentinel,
    // 800x600 default per D-09). Consumers JSON.parse this on read.
    expect(row?.value).toBe('{"x":null,"y":null,"width":800,"height":600}')
  })

  it('MIGR-002 idempotency: second runMigrations() leaves a single window_geometry row', () => {
    runMigrations()
    expect(() => runMigrations()).not.toThrow()
    const db = getDb()
    const { c } = db
      .prepare(
        `SELECT COUNT(*) as c FROM settings WHERE key = 'settings.window_geometry'`,
      )
      .get() as { c: number }
    expect(c).toBe(1)
  })

  it('MIGR-002 idempotency: simulated geometry write survives re-run (INSERT OR IGNORE preserves user data)', () => {
    runMigrations()
    const db = getDb()
    // Simulate plan 03-02's window-geometry writer persisting a real bounds row
    // AFTER migration 002 has seeded the default. INSERT OR IGNORE in migration
    // 002 must NOT clobber this on a subsequent runMigrations() call.
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(
      '{"x":120,"y":240,"width":1024,"height":768}',
      'settings.window_geometry',
    )
    expect(() => runMigrations()).not.toThrow()
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'settings.window_geometry'`)
      .get() as { value: string }
    // User's saved bounds survive — INSERT OR IGNORE skipped on existing row.
    expect(row.value).toBe('{"x":120,"y":240,"width":1024,"height":768}')
  })

  it('MIGR-002: PRAGMA user_version is 5 after all migrations (001+002+003+004+005)', () => {
    // Verify the full run yields the current latest version (5 after 005_gantt_settings).
    runMigrations()
    const db = getDb()
    const version = db.pragma('user_version', { simple: true })
    // After all migrations (001, 002, 003, 004, 005), version is 5.
    expect(version).toBe(5)
  })

  // ---- Quick task 260606-0mc additions (MIGR-003) ----

  it('MIGR-003: settings.always_on_top seeded with false (windowed default)', () => {
    runMigrations()
    const db = getDb()
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'settings.always_on_top'`)
      .get() as { value: string } | undefined
    expect(row).toBeDefined()
    // JSON-encoded boolean false — windowed by default per user requirement.
    expect(row?.value).toBe('false')
  })

  it('MIGR-003 idempotency: second runMigrations() leaves a single always_on_top row', () => {
    runMigrations()
    expect(() => runMigrations()).not.toThrow()
    const db = getDb()
    const { c } = db
      .prepare(
        `SELECT COUNT(*) as c FROM settings WHERE key = 'settings.always_on_top'`,
      )
      .get() as { c: number }
    expect(c).toBe(1)
  })

  it('MIGR-003 idempotency: user preference survives re-run (INSERT OR IGNORE preserves user data)', () => {
    runMigrations()
    const db = getDb()
    // Simulate the user enabling always-on-top.
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(
      'true',
      'settings.always_on_top',
    )
    expect(() => runMigrations()).not.toThrow()
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'settings.always_on_top'`)
      .get() as { value: string }
    // User's saved preference survives — INSERT OR IGNORE skipped on existing row.
    expect(row.value).toBe('true')
  })

  // ---- Quick task 260606-16w additions (MIGR-004) ----

  it('MIGR-004: settings.auto_update seeded with true (updates-on by default)', () => {
    runMigrations()
    const db = getDb()
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'settings.auto_update'`)
      .get() as { value: string } | undefined
    expect(row).toBeDefined()
    // JSON-encoded boolean true — updates enabled by default to preserve current behavior.
    expect(row?.value).toBe('true')
  })

  it('MIGR-004 idempotency: second runMigrations() leaves a single auto_update row', () => {
    runMigrations()
    expect(() => runMigrations()).not.toThrow()
    const db = getDb()
    const { c } = db
      .prepare(
        `SELECT COUNT(*) as c FROM settings WHERE key = 'settings.auto_update'`,
      )
      .get() as { c: number }
    expect(c).toBe(1)
  })

  it('MIGR-004 idempotency: user preference survives re-run (INSERT OR IGNORE preserves user data)', () => {
    runMigrations()
    const db = getDb()
    // Simulate the user disabling auto-update.
    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(
      'false',
      'settings.auto_update',
    )
    expect(() => runMigrations()).not.toThrow()
    const row = db
      .prepare(`SELECT value FROM settings WHERE key = 'settings.auto_update'`)
      .get() as { value: string }
    // User's saved preference survives — INSERT OR IGNORE skipped on existing row.
    expect(row.value).toBe('false')
  })
})
