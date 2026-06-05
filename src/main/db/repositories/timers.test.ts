// src/main/db/repositories/timers.test.ts
// CRUD round-trip for the timers repository against :memory: SQLite.
// Refs:
//   - 01-03-PLAN.md Task 2 <behavior> (timers.test.ts contract)
//   - 04-03-PLAN.md Task 2 <behavior> (totalSeconds, running, cascade, NotFoundError)
//   - RESEARCH.md §9 lines ~1302-1325 (in-memory test pattern)
//   - timerz/db/models.py (v1 Timer column semantics)
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDb, closeDb, getDb } from '../database'
import { runMigrations } from '../migrate'
import {
  create,
  list,
  del,
  setDescription,
  setProject,
  setOffset,
  setNotes,
  resetStmtCache,
} from './timers'
import { start, stop, resetStmtCache as resetTimeEntries } from './timeEntries'
import { NotFoundError } from '@shared/errors'

describe('timers repository — CRUD round-trip', () => {
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

  it('create → list with created_at >= 1.7e9 → setDescription → list shows new description', () => {
    const created = create({ projectId: null, description: 'task' })
    expect(created.description).toBe('task')
    expect(created.project_id).toBeNull()
    expect(typeof created.id).toBe('number')
    // EpochSeconds bounds — same range time.test.ts asserts.
    expect(created.created_at).toBeGreaterThanOrEqual(1_700_000_000)
    expect(created.created_at).toBeLessThan(2_000_000_000)
    // v1 defaults — notes='', offset NULL
    expect(created.notes).toBe('')
    expect(created.offset).toBeNull()

    const rows = list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.description).toBe('task')

    setDescription(created.id, 'task v2')
    const after = list()
    expect(after[0]?.description).toBe('task v2')
  })
})

// ---------------------------------------------------------------------------
// Phase 4 additions — totalSeconds aggregation, running flag, FK cascade,
// NotFoundError paths. VALIDATION.md per-task map: ≥ 6 new vitest cases.
//
// BUG FIX (time-drift): totalSeconds now only sums COMPLETED entries.
// The running entry is excluded so DurationCell can add tick.elapsedSeconds
// without double-counting. Test 3 updated accordingly; Test 3b added to
// explicitly verify the exclusion.
//
// Refs:
//   - 04-03-PLAN.md Task 2 <behavior> (test descriptions + tolerance strategy)
//   - CONTEXT.md D-17 (cascade delete), D-19 (NotFoundError pattern), D-20
//     (totalSeconds SQL), D-22 (running boolean)
//   - RESEARCH.md § Pitfall 6 (GROUP BY enforcement test)
// ---------------------------------------------------------------------------

describe('timers repository — Phase 4: totalSeconds + running aggregation', () => {
  beforeEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
  })

  // Test 1: timer with zero entries returns totalSeconds: 0 and running: false
  it('list returns totalSeconds: 0 and running: false for a timer with zero entries', () => {
    create({ projectId: null, description: 'no-entries' })
    const rows = list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.totalSeconds).toBe(0)
    expect(rows[0]?.running).toBe(false)
  })

  // Test 2: stopped entries contribute their full duration to totalSeconds
  it('list returns totalSeconds equal to sum of stopped entry durations + offset', () => {
    const timer = create({ projectId: null, description: 'billable' })
    // Manually insert two stopped entries with known durations via raw SQL for
    // deterministic arithmetic. Inserting via the timeEntries repo would call
    // nowSeconds() twice with wall-clock drift, making exact equality assertions
    // fragile. The raw-SQL approach is the recommended path when we need to
    // control start/end exactly (the repo function itself is already covered by
    // timeEntries.test.ts).
    const db = getDb()
    db.prepare(
      `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`,
    ).run(timer.id, 1_700_000_000, 1_700_000_060) // 60 seconds
    db.prepare(
      `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`,
    ).run(timer.id, 1_700_000_100, 1_700_000_140) // 40 seconds
    // 60 + 40 = 100; offset is NULL (= 0)
    const rows = list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.totalSeconds).toBe(100)
    expect(rows[0]?.running).toBe(false)
  })

  // Test 3: running entry sets running: true but does NOT contribute to totalSeconds
  // (BUG FIX: previously the running entry's elapsed time was baked into totalSeconds
  // at query time, causing DurationCell to double-count it via tick.elapsedSeconds)
  it('list returns running: true and totalSeconds: 0 for a timer with only a running entry', () => {
    const timer = create({ projectId: null, description: 'running-timer' })
    start(timer.id) // creates a time_entry with end_timestamp = NULL
    const rows = list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.running).toBe(true)
    // BUG FIX: running entry must NOT be added to totalSeconds — DurationCell
    // adds tick.elapsedSeconds for the live segment to avoid double-counting.
    expect(rows[0]?.totalSeconds).toBe(0)
  })

  // Test 3b: mixed timer — stopped entries count, running entry does not
  it('list counts only completed entries in totalSeconds when a running entry also exists', () => {
    const timer = create({ projectId: null, description: 'mixed-timer' })
    const db = getDb()
    // Insert a completed entry: 120 seconds
    db.prepare(
      `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`,
    ).run(timer.id, 1_700_000_000, 1_700_000_120)
    // Insert a running entry (end_timestamp IS NULL) — must NOT contribute to totalSeconds
    db.prepare(
      `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`,
    ).run(timer.id, 1_700_000_200, null)
    const rows = list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.running).toBe(true)
    // Only the completed 120-second entry counts; the running entry is excluded.
    expect(rows[0]?.totalSeconds).toBe(120)
  })

  // Test 4: GROUP BY enforcement — exactly one row per timer regardless of entry count
  it('list returns exactly one row per timer regardless of entry count (GROUP BY enforcement)', () => {
    const timerA = create({ projectId: null, description: 'many-entries' })
    const timerB = create({ projectId: null, description: 'few-entries' })
    // Create 5 stopped entries for timerA
    const db = getDb()
    for (let i = 0; i < 5; i++) {
      db.prepare(
        `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`,
      ).run(timerA.id, 1_700_000_000 + i * 100, 1_700_000_060 + i * 100)
    }
    // Create 3 stopped entries for timerB
    for (let i = 0; i < 3; i++) {
      db.prepare(
        `INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)`,
      ).run(timerB.id, 1_700_001_000 + i * 100, 1_700_001_050 + i * 100)
    }
    const rows = list()
    // CRITICAL: must be exactly 2, not 8 (5+3) — GROUP BY timers.id is mandatory.
    expect(rows).toHaveLength(2)
    const rowA = rows.find(r => r.id === timerA.id)
    const rowB = rows.find(r => r.id === timerB.id)
    expect(rowA).toBeDefined()
    expect(rowB).toBeDefined()
    // timerA: 5 entries × 60s each = 300s total
    expect(rowA?.totalSeconds).toBe(300)
    // timerB: 3 entries × 50s each = 150s total
    expect(rowB?.totalSeconds).toBe(150)
  })
})

describe('timers repository — Phase 4: delete + cascade', () => {
  beforeEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
  })

  // Test 5: delete(id) removes timer AND cascades to time_entries (D-17)
  it('del(id) removes the timer row AND its time_entries (FK ON DELETE CASCADE)', () => {
    const timer = create({ projectId: null, description: 'to-delete' })
    // Create some entries to verify CASCADE
    start(timer.id)
    stop(timer.id)
    start(timer.id)
    // Verify entries exist before delete
    const beforeCount = getDb()
      .prepare('SELECT COUNT(*) AS n FROM time_entries WHERE timer_id = ?')
      .get(timer.id) as { n: number }
    expect(beforeCount.n).toBeGreaterThan(0)

    del(timer.id)

    // Timer row should be gone
    const timerCount = getDb()
      .prepare('SELECT COUNT(*) AS n FROM timers WHERE id = ?')
      .get(timer.id) as { n: number }
    expect(timerCount.n).toBe(0)

    // All time_entries for this timer should be gone via ON DELETE CASCADE
    const entryCount = getDb()
      .prepare('SELECT COUNT(*) AS n FROM time_entries WHERE timer_id = ?')
      .get(timer.id) as { n: number }
    expect(entryCount.n).toBe(0)
  })
})

describe('timers repository — Phase 4: NotFoundError on missing id', () => {
  beforeEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
  })

  // Test 6a: setProject throws NotFoundError for unknown id
  it('setProject throws NotFoundError when id does not exist', () => {
    expect(() => setProject(99999, null)).toThrow(NotFoundError)
  })

  // Test 6b: setOffset throws NotFoundError for unknown id
  it('setOffset throws NotFoundError when id does not exist', () => {
    expect(() => setOffset(99999, 30)).toThrow(NotFoundError)
  })

  // Test 6c: setNotes throws NotFoundError for unknown id
  it('setNotes throws NotFoundError when id does not exist', () => {
    expect(() => setNotes(99999, 'some notes')).toThrow(NotFoundError)
  })

  // Test 6d: del throws NotFoundError for unknown id
  it('del throws NotFoundError when id does not exist', () => {
    expect(() => del(99999)).toThrow(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// Phase 6 additions — list(dateRange) WHERE filtering.
// Verifies the half-open [fromEpoch, toEpoch) range, inclusive lower bound,
// exclusive upper bound, empty-range, and unfiltered-all behaviors.
//
// Refs:
//   - 06-01-PLAN.md Task 1 <behavior>
//   - 06-PATTERNS.md § src/main/db/repositories/timers.ts
//   - 06-RESEARCH.md § Pattern 4 + E3
// ---------------------------------------------------------------------------

describe('timers repository — Phase 6: list(dateRange) WHERE filtering', () => {
  // Fixed epoch constants — no wall-clock dependence.
  // T_BEFORE: created_at < range start (excluded)
  // T_AT_START: created_at === fromEpoch (inclusive lower bound — D-06)
  // T_INSIDE: created_at inside range (included)
  // T_AT_END: created_at === toEpoch (exclusive upper bound — excluded)
  // T_AFTER: created_at > range end (excluded)
  const FROM_EPOCH = 1_750_000_000
  const TO_EPOCH   = 1_750_100_000
  const T_BEFORE   = FROM_EPOCH - 1         // 1_749_999_999 — excluded
  const T_AT_START = FROM_EPOCH             // 1_750_000_000 — included
  const T_INSIDE   = FROM_EPOCH + 50_000    // 1_750_050_000 — included
  const T_AT_END   = TO_EPOCH              // 1_750_100_000 — excluded (half-open)
  const T_AFTER    = TO_EPOCH + 1           // 1_750_100_001 — excluded

  beforeEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetStmtCache()
    resetTimeEntries()
  })

  /** Helper: create a timer then adjust its created_at to a known epoch. */
  function createAt(description: string, createdAt: number) {
    const timer = create({ projectId: null, description })
    getDb()
      .prepare('UPDATE timers SET created_at = ? WHERE id = ?')
      .run(createdAt, timer.id)
    return { ...timer, created_at: createdAt as import('@shared/time').EpochSeconds }
  }

  it('list(dateRange) returns only timers with created_at in [fromEpoch, toEpoch)', () => {
    createAt('before', T_BEFORE)
    const timerAtStart = createAt('at-start', T_AT_START)
    const timerInside  = createAt('inside',   T_INSIDE)
    createAt('at-end', T_AT_END)
    createAt('after',  T_AFTER)

    const rows = list({ fromEpoch: FROM_EPOCH as import('@shared/time').EpochSeconds, toEpoch: TO_EPOCH as import('@shared/time').EpochSeconds })
    expect(rows).toHaveLength(2)
    const ids = rows.map(r => r.id)
    expect(ids).toContain(timerAtStart.id)
    expect(ids).toContain(timerInside.id)
  })

  it('list(dateRange) includes timer at fromEpoch (inclusive lower bound)', () => {
    const timerAtStart = createAt('at-start', T_AT_START)
    createAt('before', T_BEFORE)

    const rows = list({ fromEpoch: FROM_EPOCH as import('@shared/time').EpochSeconds, toEpoch: TO_EPOCH as import('@shared/time').EpochSeconds })
    expect(rows.map(r => r.id)).toContain(timerAtStart.id)
  })

  it('list(dateRange) excludes timer at toEpoch (exclusive upper bound)', () => {
    const timerAtEnd = createAt('at-end', T_AT_END)

    const rows = list({ fromEpoch: FROM_EPOCH as import('@shared/time').EpochSeconds, toEpoch: TO_EPOCH as import('@shared/time').EpochSeconds })
    expect(rows.map(r => r.id)).not.toContain(timerAtEnd.id)
  })

  it('list(dateRange) returns empty array when no timers fall in range', () => {
    createAt('before', T_BEFORE)
    createAt('after',  T_AFTER)
    createAt('at-end', T_AT_END)

    const rows = list({ fromEpoch: FROM_EPOCH as import('@shared/time').EpochSeconds, toEpoch: TO_EPOCH as import('@shared/time').EpochSeconds })
    expect(rows).toHaveLength(0)
  })

  it('list() without dateRange returns all timers (unfiltered path preserved)', () => {
    createAt('before', T_BEFORE)
    createAt('at-start', T_AT_START)
    createAt('inside',   T_INSIDE)
    createAt('at-end', T_AT_END)
    createAt('after',  T_AFTER)

    const rows = list()
    expect(rows).toHaveLength(5)
  })

  it('list(dateRange) computes totalSeconds correctly for a timer with a stopped entry inside range', () => {
    const timer = createAt('with-entries', T_INSIDE)
    // Insert a stopped entry with known duration
    getDb()
      .prepare('INSERT INTO time_entries (timer_id, start_timestamp, end_timestamp) VALUES (?, ?, ?)')
      .run(timer.id, 1_750_050_000, 1_750_050_060) // 60 seconds

    const rows = list({ fromEpoch: FROM_EPOCH as import('@shared/time').EpochSeconds, toEpoch: TO_EPOCH as import('@shared/time').EpochSeconds })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.totalSeconds).toBe(60)
    expect(rows[0]?.running).toBe(false)
  })
})
