// src/main/services/heartbeat.test.ts
// HeartbeatService tests against :memory: SQLite + vi.useFakeTimers().
// Four cases covering the public surface of `src/main/services/heartbeat.ts`
// (Plan 02-03):
//
//   1. CRASH-01 / ROADMAP #2 — heartbeat row written within 65s of
//      startHeartbeat() while a timer is running
//   2. idempotent restart — startHeartbeat() called twice does not leak a
//      second interval (writeHeartbeat called exactly once per tick)
//   3. no-op when no timer is running — writeHeartbeat early-returns;
//      readHeartbeat() stays null after multiple ticks
//   4. single-row id=1 invariant — repeated ticks UPSERT in place; the
//      heartbeat table never accumulates rows (D-07)
//
// Refs:
//   - 02-03-PLAN.md Task 2 <behavior> + <action>
//   - 02-CONTEXT.md D-01 (resetForTests), D-06 (lifecycle), D-07 (id=1),
//     D-08 (nowSeconds), D-21 (vi.useFakeTimers)
//   - 02-RESEARCH.md § "Pattern 1" (heartbeat scheduler shape)
//   - 02-RESEARCH.md § "Vitest test pattern — heartbeat fires within 65 s"
//   - 02-RESEARCH.md § Pitfall 1 (clearInterval before re-setInterval)
//   - 02-RESEARCH.md § Pitfall 6 (electron-log test pollution — restoreAllMocks)
//   - timerz/scheduler.py (v1 semantic reference: write_heartbeat early-returns
//     when no entry has end_timestamp IS NULL)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CRITICAL: `vi.mock('electron', ...)` is hoisted by vitest above all imports.
// heartbeat.ts transitively imports `@main/log` which imports `electron-log`,
// which in production loads `electron`. The mock keeps the test in pure Node.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

import { initDb, closeDb, getDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import {
  create as createTimer,
  resetStmtCache as resetTimers,
} from '@main/db/repositories/timers'
import {
  start as startEntry,
  resetStmtCache as resetTimeEntries,
} from '@main/db/repositories/timeEntries'
import {
  read as readHeartbeat,
  resetStmtCache as resetHeartbeat,
} from '@main/db/repositories/heartbeat'
import * as heartbeatRepo from '@main/db/repositories/heartbeat'
import {
  HEARTBEAT_INTERVAL_MS,
  startHeartbeat,
  stopHeartbeat,
  writeHeartbeat,
  resetForTests as resetHeartbeatService,
} from './heartbeat'

describe('HeartbeatService — 60-second cadence', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
    resetHeartbeatService()
    initDb(':memory:')
    runMigrations()
    vi.useFakeTimers()
  })

  afterEach(() => {
    resetHeartbeatService()
    vi.useRealTimers()
    vi.restoreAllMocks()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
  })

  // Test 1 — CRASH-01 / ROADMAP #2 — heartbeat row arrives within 65s
  it('CRASH-01 / ROADMAP #2: writes a heartbeat row within 65 seconds of startHeartbeat() while a timer is running', () => {
    // Arrange: a running entry exists in the DB. Start the entry directly via
    // the repository — not the TimerService — so this test does not depend on
    // Plan 02-03's wiring of startHeartbeat() into TimerService.start().
    const timer = createTimer({ projectId: null, description: 'task' })
    const entry = startEntry(timer.id)
    expect(readHeartbeat()).toBeNull() // no heartbeat row yet

    // Act
    startHeartbeat()
    vi.advanceTimersByTime(65_000) // simulate 65 wall-clock seconds

    // Assert: a heartbeat row exists; last_beat is a finite epoch second; the
    // timer_entry_id points at the running entry (D-07: single row id=1).
    const beat = readHeartbeat()
    expect(beat).not.toBeNull()
    expect(typeof beat?.last_beat).toBe('number')
    expect(beat?.timer_entry_id).toBe(entry.id)
  })

  // Test 2 — idempotent restart (Pitfall 1: clearInterval before setInterval)
  it('is idempotent — startHeartbeat called twice does not leak a second interval', () => {
    const timer = createTimer({ projectId: null, description: 'task' })
    startEntry(timer.id)

    // Spy on the repository's write export. Calling startHeartbeat twice
    // MUST clear the first interval; otherwise two intervals fire per tick.
    const spy = vi.spyOn(heartbeatRepo, 'write')

    startHeartbeat()
    startHeartbeat() // second call MUST clear the first handle
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS + 5_000) // 65s — exactly one tick

    expect(spy).toHaveBeenCalledTimes(1)
  })

  // Test 3 — no-op when no timer is running (matches v1 scheduler.py:27)
  it('writeHeartbeat is a no-op when no timer is running — readHeartbeat stays null after multiple ticks', () => {
    // No time_entries row exists. startHeartbeat installs the interval, but
    // writeHeartbeat's getRunning() returns null and early-returns.
    startHeartbeat()
    vi.advanceTimersByTime(120_000) // 2 ticks worth

    expect(readHeartbeat()).toBeNull()

    // Direct call also no-ops.
    expect(() => writeHeartbeat()).not.toThrow()
    expect(readHeartbeat()).toBeNull()

    stopHeartbeat()
  })

  // Test 4 — D-07: single-row id=1 invariant proven via COUNT
  it('writes to a single row (id=1) — repeated ticks UPSERT, never INSERT a second row', () => {
    const timer = createTimer({ projectId: null, description: 'task' })
    startEntry(timer.id)

    startHeartbeat()
    vi.advanceTimersByTime(65_000) // tick 1
    vi.advanceTimersByTime(65_000) // tick 2

    // Authoritative D-07 assertion — direct COUNT against the heartbeat table.
    const db = getDb()
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM heartbeat')
      .get() as { n: number }
    expect(row).toEqual({ n: 1 })

    // And the single row's id is 1.
    const idRow = db
      .prepare('SELECT id FROM heartbeat')
      .get() as { id: number }
    expect(idRow.id).toBe(1)
  })
})
