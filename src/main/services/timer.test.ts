// src/main/services/timer.test.ts
// TimerService FSM tests against :memory: SQLite. Five cases covering the
// public surface of `src/main/services/timer.ts` (Plan 02-02):
//
//   1. start happy-path — returns a running entry with sane epoch + null end
//   2. TIME-03 single-active invariant — DB-level COUNT(*) assertion after
//      starting a second timer while a first is already running
//   3. stopActive() is idempotent at the service layer — null + no throw
//   4. stop(timerId) is selective — wrong timer is a no-op
//   5. elapsedSeconds(timerId) is wall-clock arithmetic — TIME-06 / D-05
//
// Refs:
//   - 02-02-PLAN.md Task 2 <behavior> + <action>
//   - 02-CONTEXT.md D-01..D-05, D-19 (pure functions + db.transaction)
//   - 02-RESEARCH.md § "Vitest fake timers" + § "Single-active-timer invariant test"
//   - timerz/services/timer_service.py (v1 semantic reference)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CRITICAL: `vi.mock('electron', ...)` is hoisted by vitest above all imports.
// Mock electron defensively even though timer.ts does NOT import from electron
// today — Plan 02-03 will edit timer.ts to call heartbeat.ts which transitively
// touches electron-log; mocking at the test boundary prevents native loads.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

// Plan 04-04: mock tickService so start/stop assertions can verify lifecycle
// hooks without actually installing a real setInterval (which would require
// fake timers in every test that touches TimerService).
vi.mock('./tick', () => ({
  start: vi.fn(),
  stop: vi.fn(),
  emit: vi.fn(),
  emitNow: vi.fn(),
  resetForTests: vi.fn(),
  TICK_INTERVAL_MS: 1000,
}))

import { initDb, closeDb, getDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import {
  create as createTimer,
  resetStmtCache as resetTimers,
} from '@main/db/repositories/timers'
import { resetStmtCache as resetTimeEntries } from '@main/db/repositories/timeEntries'
import { resetStmtCache as resetHeartbeat } from '@main/db/repositories/heartbeat'
import * as timerService from '@main/services/timer'
import * as tickService from '@main/services/tick'
import { NotFoundError } from '@shared/errors'

describe('TimerService — FSM behavior', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
    timerService.resetForTests()
    // Reset tickService mock call counts before each test.
    vi.mocked(tickService.start).mockClear()
    vi.mocked(tickService.stop).mockClear()
    vi.mocked(tickService.emitNow).mockClear()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    timerService.resetForTests()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
  })

  // Test 1 — start happy-path
  it('start(timerId) returns a running entry with sane epoch and null end_timestamp', () => {
    const timer = createTimer({ projectId: null, description: 'A' })
    const entry = timerService.start(timer.id)
    expect(entry.timer_id).toBe(timer.id)
    expect(entry.end_timestamp).toBeNull()
    expect(typeof entry.id).toBe('number')
    expect(entry.start_timestamp).toBeGreaterThanOrEqual(1_700_000_000)
    expect(entry.start_timestamp).toBeLessThan(2_000_000_000)
  })

  // Test 2 — TIME-03 single-active invariant (the canonical DB-level proof)
  it('TIME-03: starting timer B while timer A runs leaves exactly one running row (DB-level COUNT)', () => {
    const timerA = createTimer({ projectId: null, description: 'A' })
    const timerB = createTimer({ projectId: null, description: 'B' })

    timerService.start(timerA.id)
    timerService.start(timerB.id)

    // Authoritative invariant assertion — directly count NULL end_timestamp rows.
    const db = getDb()
    const row = db
      .prepare(
        'SELECT COUNT(*) AS n FROM time_entries WHERE end_timestamp IS NULL',
      )
      .get() as { n: number }
    expect(row).toEqual({ n: 1 })

    // The single survivor must be timer B's entry (A was stopped inside the txn).
    expect(timerService.getRunningEntry()?.timer_id).toBe(timerB.id)
  })

  // Test 3 — stopActive idempotent at the service layer
  it('stopActive() returns null and does not throw when no entry is running (idempotent)', () => {
    expect(() => timerService.stopActive()).not.toThrow()
    expect(timerService.stopActive()).toBeNull()
    // Second call is also a no-op.
    expect(timerService.stopActive()).toBeNull()
    expect(timerService.getRunningEntry()).toBeNull()
  })

  // Test 4 — stop(timerId) is selective
  it('stop(timerId) is a no-op when running entry belongs to a different timer; stops correctly when matched', () => {
    const timerA = createTimer({ projectId: null, description: 'A' })
    const timerB = createTimer({ projectId: null, description: 'B' })
    timerService.start(timerA.id)

    // Wrong-timer stop: A is still running afterwards.
    expect(timerService.stop(timerB.id)).toBeNull()
    expect(timerService.getRunningEntry()?.timer_id).toBe(timerA.id)

    // Right-timer stop: returns the stopped entry; nothing is running afterwards.
    const stopped = timerService.stop(timerA.id)
    expect(stopped).not.toBeNull()
    expect(stopped!.timer_id).toBe(timerA.id)
    expect(stopped!.end_timestamp).not.toBeNull()
    expect(timerService.getRunningEntry()).toBeNull()
  })

  // Test 5 — TIME-06 wall-clock arithmetic via elapsedSeconds
  it('TIME-06: elapsedSeconds sums stopped + running segments using wall-clock (multi-entry)', () => {
    // Anchor the clock so `nowSeconds()` is deterministic across the test.
    // 1_700_000_000 keeps us inside the Phase 1 epoch-sanity bounds
    // (>= 1_700_000_000 and < 2_000_000_000).
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_700_000_000 * 1000))

    const timer = createTimer({ projectId: null, description: 'wall-clock' })
    // offset defaults to NULL → contributes 0.

    // Segment 1: start, advance 30s, stop. → 30s of stopped time.
    timerService.start(timer.id)
    vi.setSystemTime(new Date((1_700_000_000 + 30) * 1000))
    timerService.stopActive()

    // Segment 2: start, advance 20s, leave running. → 20s of running time.
    timerService.start(timer.id)
    vi.setSystemTime(new Date((1_700_000_000 + 30 + 20) * 1000))

    // Total elapsed: 30 (stopped) + 20 (running, now - start) + 0 (offset) = 50.
    expect(timerService.elapsedSeconds(timer.id)).toBe(50)
  })

  // =========================================================================
  // Plan 04-04: tickService lifecycle hook tests
  // =========================================================================

  // Test 6 — TimerService.start calls tickService.start once
  it('Plan 04-04: TimerService.start calls tickService.start exactly once', () => {
    const timer = createTimer({ projectId: null, description: 'tick-start' })
    timerService.start(timer.id)
    expect(tickService.start).toHaveBeenCalledTimes(1)
  })

  // Test 7 — TimerService.stopActive calls tickService.stop
  it('Plan 04-04: TimerService.stopActive calls tickService.stop when no running entry remains', () => {
    const timer = createTimer({ projectId: null, description: 'tick-stop-active' })
    timerService.start(timer.id)
    vi.mocked(tickService.stop).mockClear() // ignore any stop calls from startHeartbeat chain
    timerService.stopActive()
    expect(tickService.stop).toHaveBeenCalledTimes(1)
  })

  // =========================================================================
  // Plan 04-04: deleteTimer wrapper tests (D-17)
  // =========================================================================

  // Test 8 — deleteTimer stops the active entry + removes the timer + halts intervals
  it('Plan 04-04 D-17: deleteTimer stops active entry when deleting the running timer', () => {
    const timer = createTimer({ projectId: null, description: 'delete-running' })
    timerService.start(timer.id)

    // Clear call counts accumulated during start().
    vi.mocked(tickService.stop).mockClear()

    timerService.deleteTimer(timer.id)

    // (a) Timer row is gone — timersRepo.byId should throw NotFoundError.
    const db = getDb()
    const row = db.prepare('SELECT * FROM timers WHERE id = ?').get(timer.id)
    expect(row).toBeUndefined()

    // (b) Time entries for the timer are gone (FK CASCADE).
    const entryRow = db.prepare('SELECT COUNT(*) AS n FROM time_entries WHERE timer_id = ?').get(timer.id) as { n: number }
    expect(entryRow.n).toBe(0)

    // (c) tickService.stop was called (interval halted because was-running).
    expect(tickService.stop).toHaveBeenCalledTimes(1)
  })

  // Test 9 — deleteTimer does NOT call tickService.stop when deleting a non-running timer
  it('Plan 04-04 D-17: deleteTimer does NOT call stopActive or tickService.stop when deleting a non-running timer', () => {
    // Create timer A (running) and timer B (idle).
    const timerA = createTimer({ projectId: null, description: 'running-A' })
    const timerB = createTimer({ projectId: null, description: 'idle-B' })
    timerService.start(timerA.id)

    // Clear call counts from start().
    vi.mocked(tickService.stop).mockClear()

    // Delete the non-running timer B.
    timerService.deleteTimer(timerB.id)

    // (a) Timer A's entry is still running.
    expect(timerService.getRunningEntry()?.timer_id).toBe(timerA.id)

    // (b) tickService.stop was NOT called (A is still running).
    expect(tickService.stop).not.toHaveBeenCalled()

    // (c) Timer B row is gone.
    const db = getDb()
    const row = db.prepare('SELECT * FROM timers WHERE id = ?').get(timerB.id)
    expect(row).toBeUndefined()
  })

  // Test 10 — deleteTimer throws NotFoundError on missing id
  it('Plan 04-04 D-17: deleteTimer throws NotFoundError when id does not exist', () => {
    expect(() => timerService.deleteTimer(99999)).toThrow(NotFoundError)
    // tickService.stop must NOT be called — transaction rolled back / NotFoundError thrown.
    expect(tickService.stop).not.toHaveBeenCalled()
  })

  // =========================================================================
  // quick-260609-o1c: deleteEntry FSM-safe behavior
  // =========================================================================

  // Test 11 — deleteEntry removes the running entry and stops heartbeat+tick
  it('deleteEntry: deleting the running entry stops heartbeat + tick and leaves no running entry', () => {
    const timer = createTimer({ projectId: null, description: 'running-entry' })
    timerService.start(timer.id)

    // Clear call counts from start().
    vi.mocked(tickService.stop).mockClear()

    const runningEntry = timerService.getRunningEntry()!
    expect(runningEntry).not.toBeNull()

    timerService.deleteEntry(runningEntry.id)

    // (a) No running entry remains.
    expect(timerService.getRunningEntry()).toBeNull()

    // (b) tickService.stop was called (interval halted because was-running).
    expect(tickService.stop).toHaveBeenCalledTimes(1)
  })

  // Test 12 — deleteEntry on stopped entry does NOT stop heartbeat+tick when sibling is running
  it('deleteEntry: deleting a stopped entry does not stop heartbeat + tick when another timer is running', () => {
    const timerA = createTimer({ projectId: null, description: 'running-A' })
    const timerB = createTimer({ projectId: null, description: 'stopped-B' })

    // Start B, stop it, start A so A is the running one.
    timerService.start(timerB.id)
    timerService.stopActive()
    timerService.start(timerA.id)

    // Clear call counts from start().
    vi.mocked(tickService.stop).mockClear()

    // Get the stopped entry for timerB.
    const db = getDb()
    const stoppedEntry = db
      .prepare('SELECT * FROM time_entries WHERE timer_id = ? AND end_timestamp IS NOT NULL')
      .get(timerB.id) as { id: number } | undefined
    expect(stoppedEntry).toBeDefined()

    timerService.deleteEntry(stoppedEntry!.id)

    // (a) Timer A is still running.
    expect(timerService.getRunningEntry()?.timer_id).toBe(timerA.id)

    // (b) tickService.stop was NOT called (A is still running).
    expect(tickService.stop).not.toHaveBeenCalled()
  })

  // Test 13 — deleteEntry throws NotFoundError for missing id
  it('deleteEntry: throws NotFoundError when entry id does not exist', () => {
    expect(() => timerService.deleteEntry(99999)).toThrow(NotFoundError)
    expect(tickService.stop).not.toHaveBeenCalled()
  })
})
