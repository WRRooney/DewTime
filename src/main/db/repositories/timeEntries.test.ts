// src/main/db/repositories/timeEntries.test.ts
// CRUD round-trip for the time_entries repository against :memory: SQLite.
// Refs:
//   - 01-03-PLAN.md Task 2 <behavior> (timeEntries.test.ts contract)
//   - timerz/db/models.py (v1 TimeEntry column semantics; NULL end_timestamp = running)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../database'
import { runMigrations } from '../migrate'
import { create as createTimer, resetStmtCache as resetTimers } from './timers'
import {
  start,
  listByTimer,
  stop,
  stopActive,
  getRunning,
  deleteEntry,
  resetStmtCache as resetTimeEntries,
} from './timeEntries'
import { NotFoundError, ValidationError } from '@shared/errors'

describe('timeEntries repository — CRUD round-trip', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
  })

  it('create timer → start(timerId) returns running entry → listByTimer returns [entry]', () => {
    const timer = createTimer({ projectId: null, description: 'task' })
    const entry = start(timer.id)
    expect(entry.timer_id).toBe(timer.id)
    expect(entry.end_timestamp).toBeNull()
    expect(entry.start_timestamp).toBeGreaterThanOrEqual(1_700_000_000)
    expect(entry.start_timestamp).toBeLessThan(2_000_000_000)
    expect(typeof entry.id).toBe('number')

    const rows = listByTimer(timer.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(entry)
  })
})

describe('timeEntries repository — stop/stopActive', () => {
  // Refs:
  //   - 02-01-PLAN.md Task 2 <behavior> (Tests A-D)
  //   - 02-CONTEXT.md D-04 (stopActive idempotent — returns null, no throw)
  //   - 02-CONTEXT.md D-08 (timestamps via nowSeconds())
  //   - 02-CONTEXT.md D-19 (repository is dumb CRUD; service composes)
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
  })

  // Test A
  it('stopActive() writes end_timestamp on the running entry', () => {
    const timer = createTimer({ projectId: null, description: 'A' })
    const started = start(timer.id)
    expect(started.end_timestamp).toBeNull()

    const stopped = stopActive()
    expect(stopped).not.toBeNull()
    expect(stopped!.id).toBe(started.id)
    expect(stopped!.timer_id).toBe(timer.id)
    expect(stopped!.end_timestamp).not.toBeNull()
    expect(typeof stopped!.end_timestamp).toBe('number')
    // end_timestamp must be ≥ start_timestamp (wall-clock monotonic at one-second resolution).
    expect(stopped!.end_timestamp!).toBeGreaterThanOrEqual(started.start_timestamp)
    // Sanity: epoch-seconds, not millis.
    expect(stopped!.end_timestamp!).toBeLessThan(2_000_000_000)

    // No row is running afterwards.
    expect(getRunning()).toBeNull()
  })

  // Test B
  it('stopActive() returns null when no entry is running (idempotent — D-04)', () => {
    // Fresh DB with no entries; stopActive must not throw.
    expect(stopActive()).toBeNull()
    // Second call is also a no-op — full idempotency.
    expect(stopActive()).toBeNull()
    expect(getRunning()).toBeNull()
  })

  // Test C
  it('stop(timerId) stops the running entry when timer_id matches', () => {
    const timer = createTimer({ projectId: null, description: 'A' })
    const started = start(timer.id)

    const stopped = stop(timer.id)
    expect(stopped).not.toBeNull()
    expect(stopped!.id).toBe(started.id)
    expect(stopped!.timer_id).toBe(timer.id)
    expect(stopped!.end_timestamp).not.toBeNull()
    expect(getRunning()).toBeNull()
  })

  // Test D
  it('stop(timerId) returns null when running entry belongs to a different timer', () => {
    const timerA = createTimer({ projectId: null, description: 'A' })
    const timerB = createTimer({ projectId: null, description: 'B' })
    const startedA = start(timerA.id)

    // Sanity: A is running, B is not.
    expect(getRunning()?.timer_id).toBe(timerA.id)

    const result = stop(timerB.id)
    expect(result).toBeNull()
    // A is still running — wrong-timer stop must be a no-op.
    const stillRunning = getRunning()
    expect(stillRunning).not.toBeNull()
    expect(stillRunning!.timer_id).toBe(timerA.id)
    expect(stillRunning!.id).toBe(startedA.id)
    expect(stillRunning!.end_timestamp).toBeNull()
  })
})

describe('timeEntries repository — deleteEntry', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
  })

  it('deletes a stopped entry', () => {
    const timer = createTimer({ projectId: null, description: 'task' })
    const entry = start(timer.id)
    stopActive() // give it an end_timestamp so it is deletable
    deleteEntry(entry.id)
    expect(listByTimer(timer.id)).toHaveLength(0)
  })

  it('refuses to delete the running entry (ValidationError)', () => {
    const timer = createTimer({ projectId: null, description: 'task' })
    const entry = start(timer.id) // still running (end_timestamp IS NULL)
    expect(() => deleteEntry(entry.id)).toThrow(ValidationError)
    expect(listByTimer(timer.id)).toHaveLength(1)
  })

  it('throws NotFoundError for a missing entry', () => {
    expect(() => deleteEntry(999_999)).toThrow(NotFoundError)
  })
})
