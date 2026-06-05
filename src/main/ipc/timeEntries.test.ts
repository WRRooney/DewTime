// src/main/ipc/timeEntries.test.ts
// IPC boundary tests for the `timeEntries.*` namespace. Eight cases covering
// the Zod-validation gate, the TIME-07 service-mediation assertion, the
// error-revival round-trip across the prefix-encoded message boundary, and
// the Phase 5 D-08/D-09 timestamp-guard assertions for setStart/setEnd.
//
//   1. Zod rejection (D-15) — `handleStart({})` (missing timerId) rejects
//      with a `ValidationError` whose `.message` carries the `[VALIDATION]`
//      prefix (preload's `reviveError` depends on this exact prefix).
//   2. Dispatch to service (TIME-07 / T-02-03) — `handleStart({ timerId })`
//      with a real timer routes through `timerService.start` (asserted via
//      `vi.spyOn(timerService, 'start')`); the returned TimeEntry has the
//      expected `timer_id` and a null `end_timestamp`.
//   3. Service no-op + null cache (CRASH-03 + CRASH-04 sentinel) —
//      `handleStop({ timerId: 999_999 })` resolves to `null` (no running entry
//      for that timer); `handleCheckResume({})` resolves to `null` (cache is
//      null when checkResume() was called with no running entry, matching the
//      sentinel path of getCachedResumeResult()).
//   4. handleSetStart resolves and persists new start_timestamp (D-09).
//   5. handleSetEnd resolves and persists new end_timestamp (D-09).
//   6. handleSetEnd rejects with ValidationError for end<=start (ordering guard D-09, T-5-01).
//   7. handleSetEnd rejects with ValidationError for running entry (D-08, T-5-06).
//   8. handleSetStart rejects with NotFoundError for non-existent entry (T-5-08).
//
// The handlers are tested directly (no `ipcMain.handle` needed) — this matches
// the system.test.ts pattern from Phase 1 plan 01-04. The captured-handler
// approach Plans 02-02..02-04 used keeps the unit boundary tight.
//
// Refs:
//   - 02-05-PLAN.md Task 2 <behavior> + <action>
//   - 02-CONTEXT.md D-15 (Zod at the boundary → ValidationError)
//   - 02-CONTEXT.md D-16, D-17 (six handler exports + dotted channel names)
//   - 02-CONTEXT.md D-19 (TIME-07 service mediation — every state change
//     routes through services/timer.ts, never the repository directly)
//   - 02-RESEARCH.md § Section 9 (IPC handler test pattern — invoke the
//     handler bodies directly, no ipcMain involved)
//   - threat model T-02-03 (renderer bypassing service via direct repo call)
//   - src/main/ipc/system.test.ts (canonical Phase 1 IPC test shape)
//   - 05-02-PLAN.md Task 3 (Phase 5 D-08/D-09 guard assertions)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CRITICAL: `vi.mock('electron', ...)` is hoisted by vitest above all imports.
// timeEntries.ts imports `ipcMain` from 'electron' for the
// `registerTimeEntriesHandlers` export, and transitively pulls in
// `@main/services/timer` → `@main/log` → electron-log which would load native
// Electron. Mocking keeps the test in pure Node (matches RESEARCH § Pitfall 6
// + the same hoisted-mock pattern used in service tests since Plan 02-02).
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
  // Plan 04-04: timer.ts now calls tickService.start() which calls emit() which
  // calls BrowserWindow.getAllWindows(). Mock it here so this test stays in
  // pure Node (emit() guards win === undefined and returns silently).
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import { initDb, closeDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import {
  create as createTimer,
  resetStmtCache as resetTimers,
} from '@main/db/repositories/timers'
import {
  resetStmtCache as resetTimeEntries,
  listByTimer,
} from '@main/db/repositories/timeEntries'
import { resetStmtCache as resetHeartbeat } from '@main/db/repositories/heartbeat'
import { resetForTests as resetHeartbeatService } from '@main/services/heartbeat'
import * as timerService from '@main/services/timer'
import { ValidationError, NotFoundError } from '@shared/errors'
import {
  handleStart,
  handleStop,
  handleCheckResume,
  handleSetStart,
  handleSetEnd,
} from './timeEntries'

describe('timeEntries IPC handlers — boundary behavior', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
    resetHeartbeatService()
    timerService.resetForTests()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetHeartbeatService()
    timerService.resetForTests()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
  })

  // Test 1 — Zod boundary (D-15) — missing timerId rejects with ValidationError.
  // Asserts on the prefix-encoded message so preload's `reviveError` continues
  // to rebuild the typed subclass on the renderer side (D-14 carry-forward).
  it('handleStart rejects with ValidationError when timerId is missing (Zod boundary)', async () => {
    await expect(handleStart({})).rejects.toThrow(ValidationError)
    // The prefix-encoded message is what preload's reviveError matches against
    // — never erode the [VALIDATION] prefix.
    await expect(handleStart({})).rejects.toMatchObject({
      message: expect.stringMatching(/^\[VALIDATION\] /),
    })
    // The Zod issue summary mentions the offending field so renderer logs
    // are debuggable.
    await expect(handleStart({})).rejects.toMatchObject({
      message: expect.stringContaining('timerId'),
    })
  })

  // Test 2 — TIME-07 service mediation — handleStart delegates through
  // services/timer.start (spied), proving the IPC handler does NOT bypass
  // the service to call the repository directly (threat T-02-03).
  it('TIME-07: handleStart delegates to timerService.start (no repository bypass)', async () => {
    const timer = createTimer({ projectId: null, description: 'TIME-07 task' })
    const spy = vi.spyOn(timerService, 'start')

    const result = await handleStart({ timerId: timer.id })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(timer.id)
    expect(result.timer_id).toBe(timer.id)
    expect(result.end_timestamp).toBeNull()
    expect(typeof result.id).toBe('number')
    expect(result.start_timestamp).toBeGreaterThanOrEqual(1_700_000_000)
  })

  // Test 3 — service no-op + null cache sentinel.
  // handleStop with a phantom timerId routes through timerService.stop and
  // returns null (no running entry for that timer). handleCheckResume with no
  // running entry uses timerService.getCachedResumeResult() — the cache was
  // populated to null by the implicit getRunning() check inside the service.
  // We seed the cache to null via a direct timerService.checkResume() call so
  // the IPC handler hits the cached path rather than the defensive re-run +
  // log.error branch (D-15).
  it('handleStop returns null for a phantom timer; handleCheckResume returns null when no entry was running at boot', async () => {
    // Seed the cache: no running entry exists yet, so checkResume() populates
    // lastResumeResult = null. handleCheckResume then returns that cached null
    // without re-querying (and without firing the boot-order-violation log.error).
    timerService.checkResume()

    // handleStop with a phantom timerId — service routes through repo's stop()
    // which returns null when the running entry doesn't match. No throw.
    await expect(handleStop({ timerId: 999_999 })).resolves.toBeNull()

    // handleCheckResume — cached null sentinel.
    await expect(handleCheckResume({})).resolves.toBeNull()
  })

  // -------------------------------------------------------------------------
  // Phase 5 D-08/D-09 guard tests — setStart/setEnd IPC boundary (05-02-PLAN.md Task 3)
  //
  // Scaffold: create a timer, start+stop an entry (stopped entry), then start
  // another to get a running entry. Tests verify persistence + both guards.
  // -------------------------------------------------------------------------

  // Test 4 — handleSetStart resolves and persists new start_timestamp (D-09).
  it('handleSetStart resolves and updates start_timestamp on a stopped entry', async () => {
    const timer = createTimer({ projectId: null, description: 'setStart test' })

    // Start then stop an entry so we have a stopped entry
    await handleStart({ timerId: timer.id })
    await handleStop({ timerId: timer.id })

    const entries = listByTimer(timer.id)
    expect(entries).toHaveLength(1)
    const stoppedEntry = entries[0]!

    const newStart = stoppedEntry.start_timestamp - 60 // 60 s earlier
    await expect(handleSetStart({ entryId: stoppedEntry.id, ts: newStart })).resolves.toBeUndefined()

    const updated = listByTimer(timer.id)
    expect(updated[0]!.start_timestamp).toBe(newStart)
  })

  // Test 5 — handleSetEnd resolves and persists new end_timestamp (D-09).
  it('handleSetEnd resolves and updates end_timestamp on a stopped entry', async () => {
    const timer = createTimer({ projectId: null, description: 'setEnd test' })

    await handleStart({ timerId: timer.id })
    await handleStop({ timerId: timer.id })

    const entries = listByTimer(timer.id)
    const stoppedEntry = entries[0]!

    const newEnd = stoppedEntry.end_timestamp! + 60 // 60 s later
    await expect(handleSetEnd({ entryId: stoppedEntry.id, ts: newEnd })).resolves.toBeUndefined()

    const updated = listByTimer(timer.id)
    expect(updated[0]!.end_timestamp).toBe(newEnd)
  })

  // Test 6 — handleSetEnd rejects with ValidationError when end <= start (D-09 ordering guard, T-5-01).
  it('handleSetEnd rejects with ValidationError when ts <= start_timestamp (ordering guard D-09)', async () => {
    const timer = createTimer({ projectId: null, description: 'ordering guard test' })

    await handleStart({ timerId: timer.id })
    await handleStop({ timerId: timer.id })

    const entries = listByTimer(timer.id)
    const stoppedEntry = entries[0]!

    // ts equal to start_timestamp — should reject (end must be strictly after start)
    await expect(
      handleSetEnd({ entryId: stoppedEntry.id, ts: stoppedEntry.start_timestamp }),
    ).rejects.toThrow(ValidationError)

    // ts before start_timestamp — should also reject
    await expect(
      handleSetEnd({ entryId: stoppedEntry.id, ts: stoppedEntry.start_timestamp - 1 }),
    ).rejects.toThrow(ValidationError)
  })

  // Test 7 — handleSetEnd rejects with ValidationError for a running entry (D-08, T-5-06).
  it('handleSetEnd rejects with ValidationError when entry is running (D-08 running-entry guard)', async () => {
    const timer = createTimer({ projectId: null, description: 'running guard test' })

    // Start an entry and leave it running (end_timestamp IS NULL)
    const runningEntry = await handleStart({ timerId: timer.id })
    expect(runningEntry.end_timestamp).toBeNull()

    await expect(
      handleSetEnd({ entryId: runningEntry.id, ts: runningEntry.start_timestamp + 60 }),
    ).rejects.toThrow(ValidationError)
  })

  // Test 8 — handleSetStart rejects with NotFoundError for a non-existent entry (T-5-08).
  it('handleSetStart rejects with NotFoundError for a non-existent entry id', async () => {
    await expect(
      handleSetStart({ entryId: 999_999, ts: 1_700_000_000 }),
    ).rejects.toThrow(NotFoundError)
  })

  // Test 9 — handleSetStart rejects with ValidationError when ts >= end_timestamp
  // on a stopped entry (D-09 ordering guard, start-side; closes VALIDATION 5-02-01).
  it('handleSetStart rejects with ValidationError when ts >= end_timestamp (ordering guard D-09)', async () => {
    const timer = createTimer({ projectId: null, description: 'start ordering guard' })

    await handleStart({ timerId: timer.id })
    await handleStop({ timerId: timer.id })

    const entries = listByTimer(timer.id)
    const stoppedEntry = entries[0]!
    expect(stoppedEntry.end_timestamp).not.toBeNull()

    // ts after end — must reject (would invert the range)
    await expect(
      handleSetStart({ entryId: stoppedEntry.id, ts: stoppedEntry.end_timestamp! + 60 }),
    ).rejects.toThrow(ValidationError)

    // ts equal to end — must also reject (start must be strictly before end)
    await expect(
      handleSetStart({ entryId: stoppedEntry.id, ts: stoppedEntry.end_timestamp! }),
    ).rejects.toThrow(ValidationError)
  })
})
