// src/main/db/repositories/settings.test.ts
// CRUD round-trip for the settings repository against :memory: SQLite.
// Refs:
//   - 01-03-PLAN.md Task 2 <behavior> (settings.test.ts contract)
//   - 001_initial.sql seeded defaults (week_start=0, dark_mode=true,
//     auto_pause=false, widget_mode='floating', auto_launch=false)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../database'
import { runMigrations } from '../migrate'
import { get, set, resetStmtCache } from './settings'

describe('settings repository — typed get/set round-trip', () => {
  beforeEach(() => {
    closeDb()
    resetStmtCache()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetStmtCache()
  })

  it('seeded defaults read correctly; set overwrites; new value reads back', () => {
    // Seeded default: week_start = 0 (JSON-encoded '0')
    expect(get('settings.week_start')).toBe(0)
    // Seeded default: dark_mode = true
    expect(get('settings.dark_mode')).toBe(true)
    // Seeded default: widget_mode = 'floating' (JSON-encoded '"floating"')
    expect(get('settings.widget_mode')).toBe('floating')

    // Overwrite week_start and read it back through the same typed API.
    set('settings.week_start', 3)
    expect(get('settings.week_start')).toBe(3)
  })
})
