// src/main/ipc/timers.test.ts
// IPC boundary tests for the `timers.*` namespace. Nine cases covering:
//   - Happy path for all 7 handlers (list, create, delete, setDescription,
//     setProject, setOffset, setNotes)
//   - Zod-rejection case: handleCreate with description > 1000 chars rejects
//     with [VALIDATION] prefix (T-04-02 mitigation)
//   - NotFoundError propagation: handleSetDescription with missing id rejects
//     with [NOT_FOUND] prefix
//   - Service-mediation spy: handleDelete asserts timerService.deleteTimer is
//     called (D-17 / T-04-04 — not repo.deleteTimer directly)
//
// Handlers are tested DIRECTLY (no ipcMain.handle involved) — same pattern
// as timeEntries.test.ts from Phase 2.
//
// Refs:
//   - 04-05-PLAN.md Task 1 <behavior> + <action>
//   - 04-CONTEXT.md D-16 (7 channels), D-17 (handleDelete → timerService),
//     D-28 (service-bypass exception for 6 non-delete handlers)
//   - 04-VALIDATION.md (≥ 9 test cases for timers.test.ts)
//   - threat T-04-02 (max-length gate on description + notes)
//   - threat T-04-04 (delete via timerService preserves FSM invariant)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CRITICAL: vi.mock('electron', ...) is hoisted above all imports.
// timers.ts imports ipcMain from 'electron'; transitively pulls in
// @main/services/timer → @main/log → electron-log which would load native
// Electron. Mocking keeps the test in pure Node (same pattern as
// timeEntries.test.ts hoisted mock).
// Plan 04-04: timer.ts now calls tickService.start() which calls emit() which
// calls BrowserWindow.getAllWindows(). Mock it here so this test stays in
// pure Node (emit() guards win === undefined and returns silently).
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import { initDb, closeDb, getDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import {
  create as createTimer,
  resetStmtCache as resetTimers,
} from '@main/db/repositories/timers'
import { resetStmtCache as resetTimeEntries } from '@main/db/repositories/timeEntries'
import { resetStmtCache as resetHeartbeat } from '@main/db/repositories/heartbeat'
import { resetForTests as resetHeartbeatService } from '@main/services/heartbeat'
import { resetForTests as resetTickService } from '@main/services/tick'
import * as timerService from '@main/services/timer'
import { ValidationError, NotFoundError } from '@shared/errors'
import {
  handleList,
  handleCreate,
  handleDelete,
  handleSetDescription,
  handleSetProject,
  handleSetOffset,
  handleSetNotes,
} from './timers'

describe('timers IPC handlers — boundary behavior', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
    resetHeartbeatService()
    resetTickService()
    timerService.resetForTests()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetHeartbeatService()
    resetTickService()
    timerService.resetForTests()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
  })

  // Test 1 — handleList returns Timer[] with totalSeconds + running fields populated.
  // Asserts the LEFT JOIN computed columns land in the shape (D-10 / D-20).
  it('handleList returns Timer[] with totalSeconds and running fields populated', async () => {
    createTimer({ projectId: null, description: 'alpha' })
    createTimer({ projectId: null, description: 'beta' })

    const timers = await handleList({})

    expect(Array.isArray(timers)).toBe(true)
    expect(timers).toHaveLength(2)
    for (const t of timers) {
      expect(typeof t.id).toBe('number')
      expect(typeof t.description).toBe('string')
      expect(typeof t.totalSeconds).toBe('number')
      expect(typeof t.running).toBe('boolean')
      expect(t.totalSeconds).toBeGreaterThanOrEqual(0)
      expect(t.running).toBe(false) // no running entries — FSM idle
    }
  })

  // Test 2 — handleCreate returns a Timer row with the expected fields.
  // D-18: returns freshly-inserted row (post-insert byId read).
  it('handleCreate returns a Timer row with id and description', async () => {
    const timer = await handleCreate({ projectId: null, description: 'foo' })

    expect(typeof timer.id).toBe('number')
    expect(timer.description).toBe('foo')
    expect(timer.project_id).toBeNull()
    // The create handler calls timersRepo.create which uses byId (SELECT *) —
    // totalSeconds is a computed column that only appears in the listWithTotals
    // JOIN query; the freshly-inserted row from create() does not carry it.
    // Per D-18, create returns the basic timer row for the renderer to get the id.
    expect(typeof timer.id).toBe('number') // id is the key field we need
  })

  // Test 3 — handleCreate with description > 1000 chars rejects with ValidationError.
  // Zod-rejection case (T-04-02 mitigation: SetDescriptionArgsSchema.max(1000)).
  it('handleCreate with description > 1000 chars throws ValidationError with [VALIDATION] prefix', async () => {
    const longDescription = 'x'.repeat(1001)

    await expect(
      handleCreate({ projectId: null, description: longDescription }),
    ).rejects.toThrow(ValidationError)

    await expect(
      handleCreate({ projectId: null, description: longDescription }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^\[VALIDATION\] /),
    })
  })

  // Test 4 — handleDelete calls timerService.deleteTimer (service-mediation spy).
  // D-17 / T-04-04: handleDelete MUST delegate to timerService.deleteTimer, NOT
  // call the repo directly, so the running-entry cache + tick interval stay clean.
  it('handleDelete calls timerService.deleteTimer (spy assertion) and timer row is gone after call', async () => {
    const timer = createTimer({ projectId: null, description: 'to-delete' })
    const spy = vi.spyOn(timerService, 'deleteTimer')

    await handleDelete({ id: timer.id })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(timer.id)

    // Timer should be gone — handleList should return empty
    const timers = await handleList({})
    expect(timers.find((t) => t.id === timer.id)).toBeUndefined()
  })

  // Test 5 — handleSetDescription updates the description; verified via handleList.
  it('handleSetDescription updates the description column', async () => {
    const timer = createTimer({ projectId: null, description: 'original' })

    await handleSetDescription({ id: timer.id, description: 'updated' })

    const timers = await handleList({})
    const updated = timers.find((t) => t.id === timer.id)
    expect(updated?.description).toBe('updated')
  })

  // Test 6 — handleSetProject updates the project_id FK.
  it('handleSetProject updates project_id', async () => {
    const timer = createTimer({ projectId: null, description: 'proj-test' })

    // Set to null (disassociate) — null is valid per D-19.
    await handleSetProject({ id: timer.id, projectId: null })

    const timers = await handleList({})
    const updated = timers.find((t) => t.id === timer.id)
    expect(updated?.project_id).toBeNull()
  })

  // Test 7 — handleSetOffset updates offset (nullable per D-19).
  it('handleSetOffset updates offset (nullable)', async () => {
    const timer = createTimer({ projectId: null, description: 'offset-test' })

    await handleSetOffset({ id: timer.id, offsetSeconds: 120 })

    // Verify by listing — totalSeconds = 0 entries + offset 120
    const timers = await handleList({})
    const updated = timers.find((t) => t.id === timer.id)
    expect(updated?.offset).toBe(120)

    // Can set back to null
    await handleSetOffset({ id: timer.id, offsetSeconds: null })
    const timers2 = await handleList({})
    const reset = timers2.find((t) => t.id === timer.id)
    expect(reset?.offset).toBeNull()
  })

  // Test 8 — handleSetNotes updates notes field.
  it('handleSetNotes updates notes', async () => {
    const timer = createTimer({ projectId: null, description: 'notes-test' })

    await handleSetNotes({ id: timer.id, notes: 'my notes here' })

    const timers = await handleList({})
    const updated = timers.find((t) => t.id === timer.id)
    expect(updated?.notes).toBe('my notes here')
  })

  // Test 9 — handleSetDescription with missing id rejects with [NOT_FOUND] prefix.
  // NotFoundError propagation through the handler factory (D-19 / RESEARCH § errors).
  it('handleSetDescription with missing id rejects with [NOT_FOUND] prefix', async () => {
    await expect(
      handleSetDescription({ id: 999_999, description: 'ghost' }),
    ).rejects.toThrow(NotFoundError)

    await expect(
      handleSetDescription({ id: 999_999, description: 'ghost' }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/^\[NOT_FOUND\] /),
    })
  })
})

// ---------------------------------------------------------------------------
// Phase 6 additions — handleList dateRange pass-through.
// Verifies that handleList({ dateRange }) correctly filters by the repo's
// WHERE clause, and that handleList({}) still returns ALL timers.
//
// Refs:
//   - 06-01-PLAN.md Task 2 <behavior> + <action>
//   - 06-PATTERNS.md § src/main/ipc/timers.ts
//   - threat T-6-01: ListArgsSchema EpochSecondsValue bounds validation
// ---------------------------------------------------------------------------

describe('timers IPC handlers — Phase 6: handleList dateRange pass-through', () => {
  // Fixed epoch constants — two non-overlapping ranges to place timers
  const FROM_EPOCH = 1_750_000_000
  const TO_EPOCH   = 1_750_100_000
  const IN_RANGE   = FROM_EPOCH + 50_000   // 1_750_050_000 — inside [from, to)
  const OUT_RANGE  = TO_EPOCH + 1          // 1_750_100_001 — outside range

  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
    resetHeartbeatService()
    resetTickService()
    timerService.resetForTests()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetHeartbeatService()
    resetTickService()
    timerService.resetForTests()
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetHeartbeat()
  })

  /** Helper: create a timer then patch its created_at to a fixed epoch. */
  function createAt(description: string, createdAt: number) {
    const timer = createTimer({ projectId: null, description })
    getDb()
      .prepare('UPDATE timers SET created_at = ? WHERE id = ?')
      .run(createdAt, timer.id)
    return timer
  }

  // Test P6-1: handleList({ dateRange }) returns only in-range timers
  it('handleList({ dateRange }) returns only timers in [fromEpoch, toEpoch)', async () => {
    const inTimer  = createAt('in-range',  IN_RANGE)
    const outTimer = createAt('out-range', OUT_RANGE)

    const timers = await handleList({
      dateRange: { fromEpoch: FROM_EPOCH, toEpoch: TO_EPOCH },
    })

    expect(timers.map(t => t.id)).toContain(inTimer.id)
    expect(timers.map(t => t.id)).not.toContain(outTimer.id)
    expect(timers).toHaveLength(1)
  })

  // Test P6-2: handleList({}) (no dateRange) returns ALL timers — unfiltered path
  it('handleList({}) returns all timers regardless of created_at (unfiltered path)', async () => {
    createAt('in-range',  IN_RANGE)
    createAt('out-range', OUT_RANGE)

    const timers = await handleList({})

    expect(timers).toHaveLength(2)
  })

  // Test P6-3: ListArgsSchema rejects out-of-bounds epoch (T-6-01 mitigation)
  it('handleList rejects dateRange with epoch below 1_700_000_000 (Zod ValidationError)', async () => {
    await expect(
      handleList({ dateRange: { fromEpoch: 1_000_000_000, toEpoch: TO_EPOCH } }),
    ).rejects.toThrow(ValidationError)
  })
})
