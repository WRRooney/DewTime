// src/main/db/repositories/heartbeat.test.ts
// CRUD round-trip for the heartbeat single-row repository against :memory: SQLite.
// Refs:
//   - 01-03-PLAN.md Task 2 <behavior> (heartbeat.test.ts contract)
//   - timerz/db/models.py (Heartbeat: single row, timer_entry_id NOT a FK)
//   - timerz/services/timer_service.py ~line 98 (id=1 single-row pattern)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../database'
import { runMigrations } from '../migrate'
import { nowSeconds } from '@shared/time'
import { write, read, resetStmtCache } from './heartbeat'

describe('heartbeat repository — single-row round-trip', () => {
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

  it('write(now, null) → read() returns the same last_beat with null timer_entry_id', () => {
    const beat = nowSeconds()
    write(beat, null)
    const row = read()
    expect(row).not.toBeNull()
    expect(row?.last_beat).toBe(beat)
    expect(row?.timer_entry_id).toBeNull()
  })
})
