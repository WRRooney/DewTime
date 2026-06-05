// src/main/db/repositories/projects.test.ts
// CRUD round-trip for the projects repository against :memory: SQLite.
// Refs:
//   - 01-03-PLAN.md Task 2 <behavior> (projects.test.ts contract)
//   - RESEARCH.md §9 lines ~1302-1325 (in-memory test pattern)
//   - VALIDATION.md "Test Count Target" — 1 round-trip per repo
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../database'
import { runMigrations } from '../migrate'
import { create, list, updateNumber, resetStmtCache } from './projects'

describe('projects repository — CRUD round-trip', () => {
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

  it('create → list → updateNumber → list shows new number', () => {
    const created = create('proj A', 'P-001')
    expect(created.project_name).toBe('proj A')
    expect(created.project_number).toBe('P-001')
    expect(typeof created.id).toBe('number')

    let rows = list()
    expect(rows).toEqual([
      { id: created.id, project_name: 'proj A', project_number: 'P-001' },
    ])

    updateNumber(created.id, 'P-002')
    rows = list()
    expect(rows[0]?.project_number).toBe('P-002')
    expect(rows[0]?.project_name).toBe('proj A')
  })
})
