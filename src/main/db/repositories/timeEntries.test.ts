// src/main/db/repositories/timeEntries.test.ts
// CRUD round-trip for the time_entries repository against :memory: SQLite.
// Refs:
//   - 01-03-PLAN.md Task 2 <behavior> (timeEntries.test.ts contract)
//   - timerz/db/models.py (v1 TimeEntry column semantics; NULL end_timestamp = running)
//   - 09-01-PLAN.md Task 1 <behavior> (listInRange, createEntry, setTimestamps)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb } from '../database'
import { runMigrations } from '../migrate'
import { create as createTimer, resetStmtCache as resetTimers } from './timers'
import {
  start,
  listByTimer,
  listInRange,
  createEntry,
  setTimestamps,
  stop,
  stopActive,
  getRunning,
  deleteEntry,
  resetStmtCache as resetTimeEntries,
} from './timeEntries'
import { NotFoundError, ValidationError } from '@shared/errors'
import type { EpochSeconds } from '@shared/time'

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

  it('deletes the running entry (no longer a ValidationError)', () => {
    const timer = createTimer({ projectId: null, description: 'task' })
    const entry = start(timer.id) // still running (end_timestamp IS NULL)
    expect(() => deleteEntry(entry.id)).not.toThrow()
    expect(listByTimer(timer.id)).toHaveLength(0)
    expect(getRunning()).toBeNull()
  })

  it('throws NotFoundError for a missing entry', () => {
    expect(() => deleteEntry(999_999)).toThrow(NotFoundError)
  })
})

describe('timeEntries repository — listInRange', () => {
  // Refs: 09-01-PLAN.md Task 1 <behavior>
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

  it('returns entries overlapping the range', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    // Entry overlapping range: starts before toEpoch and ends after fromEpoch
    const entry = createEntry(timer.id, 1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    const results = listInRange(1700000000 as EpochSeconds, 1700003000 as EpochSeconds)
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe(entry.id)
  })

  it('excludes an entry fully outside (before) the range', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    // Entry ends before fromEpoch — must be excluded
    createEntry(timer.id, 1700000100 as EpochSeconds, 1700000500 as EpochSeconds)
    const results = listInRange(1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    expect(results).toHaveLength(0)
  })

  it('excludes an entry fully outside (after) the range', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    // Entry starts after toEpoch — must be excluded
    createEntry(timer.id, 1700003000 as EpochSeconds, 1700004000 as EpochSeconds)
    const results = listInRange(1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    expect(results).toHaveLength(0)
  })

  it('includes a running (NULL-end) entry whose start is before toEpoch', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    // start() creates a running entry with nowSeconds() — which will be > 1700000000
    // We use a large toEpoch to ensure the running entry's start is within range.
    const running = start(timer.id)
    expect(running.end_timestamp).toBeNull()
    const results = listInRange(running.start_timestamp - 10 as EpochSeconds, running.start_timestamp + 10 as EpochSeconds)
    expect(results.some(e => e.id === running.id)).toBe(true)
  })

  it('orders results by timer_id then start_timestamp', () => {
    const timerA = createTimer({ projectId: null, description: 'A' })
    const timerB = createTimer({ projectId: null, description: 'B' })
    // timerB has a lower id due to insertion order... actually timers are ordered by creation
    // Create entries: timerB entry first, then timerA entry, both in range
    const eb = createEntry(timerB.id, 1700001000 as EpochSeconds, 1700001500 as EpochSeconds)
    const ea = createEntry(timerA.id, 1700001200 as EpochSeconds, 1700001800 as EpochSeconds)
    const results = listInRange(1700000000 as EpochSeconds, 1700002000 as EpochSeconds)
    expect(results).toHaveLength(2)
    // Ordered by timer_id ASC then start_timestamp ASC
    // timerA.id < timerB.id (created first)
    expect(results[0]!.timer_id).toBe(timerA.id)
    expect(results[0]!.id).toBe(ea.id)
    expect(results[1]!.timer_id).toBe(timerB.id)
    expect(results[1]!.id).toBe(eb.id)
  })
})

describe('timeEntries repository — createEntry', () => {
  // Refs: 09-01-PLAN.md Task 1 <behavior>
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

  it('inserts a completed entry and round-trips it', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    const entry = createEntry(timer.id, 1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    expect(entry.timer_id).toBe(timer.id)
    expect(entry.start_timestamp).toBe(1700001000)
    expect(entry.end_timestamp).toBe(1700002000)
    expect(entry.end_timestamp).not.toBeNull()
    expect(typeof entry.id).toBe('number')
  })

  it('never writes null end_timestamp (single-running-entry invariant preserved)', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    const entry = createEntry(timer.id, 1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    // Verify end_timestamp is non-null
    expect(entry.end_timestamp).not.toBeNull()
    // Running entry invariant: start() creates a running entry, createEntry must not affect it
    const running = start(timer.id)
    expect(running.end_timestamp).toBeNull()
    const entry2 = createEntry(timer.id, 1700003000 as EpochSeconds, 1700004000 as EpochSeconds)
    // The running entry from start() should still be running
    expect(getRunning()?.id).toBe(running.id)
    expect(entry2.end_timestamp).not.toBeNull()
  })
})

describe('timeEntries repository — setTimestamps', () => {
  // Refs: 09-01-PLAN.md Task 1 <behavior>
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

  it('atomically updates both start_timestamp and end_timestamp', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    const entry = createEntry(timer.id, 1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    setTimestamps(entry.id, 1700001500 as EpochSeconds, 1700003000 as EpochSeconds)
    const updated = listByTimer(timer.id)
    expect(updated[0]!.start_timestamp).toBe(1700001500)
    expect(updated[0]!.end_timestamp).toBe(1700003000)
  })

  it('throws ValidationError when the target entry is running (end IS NULL)', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    const running = start(timer.id) // running entry, end_timestamp = NULL
    expect(() =>
      setTimestamps(running.id, 1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    ).toThrow(ValidationError)
  })

  it('throws ValidationError when startTs >= endTs', () => {
    const timer = createTimer({ projectId: null, description: 'T' })
    const entry = createEntry(timer.id, 1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    expect(() =>
      setTimestamps(entry.id, 1700002000 as EpochSeconds, 1700001000 as EpochSeconds)
    ).toThrow(ValidationError)
    expect(() =>
      setTimestamps(entry.id, 1700001500 as EpochSeconds, 1700001500 as EpochSeconds)
    ).toThrow(ValidationError)
  })

  it('throws NotFoundError for a missing entry id', () => {
    expect(() =>
      setTimestamps(999_999, 1700001000 as EpochSeconds, 1700002000 as EpochSeconds)
    ).toThrow(NotFoundError)
  })
})
