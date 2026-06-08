// src/main/db/repositories/projects.test.ts
// CRUD round-trip for the projects repository against :memory: SQLite.
// Refs:
//   - 01-03-PLAN.md Task 2 <behavior> (projects.test.ts contract)
//   - RESEARCH.md §9 lines ~1302-1325 (in-memory test pattern)
//   - VALIDATION.md "Test Count Target" — 1 round-trip per repo
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb, getDb } from '../database'
import { runMigrations } from '../migrate'
import { create, list, updateNumber, updateName, remove, countTimerRefs, byId, resetStmtCache } from './projects'
import { NotFoundError, ValidationError } from '@shared/errors'

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

describe('projects repository — updateName', () => {
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

  it('updateName persists and byId reflects the new name', () => {
    const proj = create('Original Name', null)
    updateName(proj.id, 'Updated Name')
    const updated = byId(proj.id)
    expect(updated.project_name).toBe('Updated Name')
  })

  it('updateName throws NotFoundError for unknown id', () => {
    expect(() => updateName(999999, 'Some Name')).toThrow(NotFoundError)
  })

  it('updateName throws ValidationError when renaming to a name used by a different project', () => {
    const proj1 = create('Alpha', null)
    create('Beta', null)
    expect(() => updateName(proj1.id, 'Beta')).toThrow(ValidationError)
  })

  it('create throws ValidationError when the name already exists (symmetric with updateName)', () => {
    create('Dup', null)
    expect(() => create('Dup', null)).toThrow(ValidationError)
  })
})

describe('projects repository — remove', () => {
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

  it('remove deletes the project AND a referencing timer project_id becomes NULL', () => {
    const db = getDb()
    const proj = create('ToDelete', null)
    // Insert a timer referencing this project
    const result = db
      .prepare(`INSERT INTO timers (project_id, description, notes, created_at) VALUES (?, '', '', 1000000)`)
      .run(proj.id)
    const timerId = result.lastInsertRowid as number

    remove(proj.id)

    // Project should be gone
    expect(() => byId(proj.id)).toThrow(NotFoundError)

    // Timer should still exist with project_id = NULL (FK ON DELETE SET NULL)
    const timer = db.prepare(`SELECT project_id FROM timers WHERE id = ?`).get(timerId) as { project_id: number | null } | undefined
    expect(timer).toBeDefined()
    expect(timer?.project_id).toBeNull()
  })

  it('remove throws NotFoundError for unknown id', () => {
    expect(() => remove(999999)).toThrow(NotFoundError)
  })
})

describe('projects repository — countTimerRefs', () => {
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

  it('countTimerRefs returns 0 for a project with no timers', () => {
    const proj = create('Empty Project', null)
    expect(countTimerRefs(proj.id)).toBe(0)
  })

  it('countTimerRefs returns correct count after assigning N timers', () => {
    const db = getDb()
    const proj = create('With Timers', null)
    // Insert 3 timers referencing this project
    for (let i = 0; i < 3; i++) {
      db.prepare(`INSERT INTO timers (project_id, description, notes, created_at) VALUES (?, '', '', 1000000)`)
        .run(proj.id)
    }
    expect(countTimerRefs(proj.id)).toBe(3)
  })

  it('countTimerRefs returns 0 for an unknown id', () => {
    expect(countTimerRefs(999999)).toBe(0)
  })
})
