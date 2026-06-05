// src/main/ipc/projects.test.ts
// IPC boundary tests for the `projects.*` namespace. Five cases covering
// the Zod-validation gate (D-15) and the PROJ-01/03/04/05 CRUD round-trip
// at the IPC boundary.
//
//   1. Zod rejection (D-15) — `handleCreate({})` (missing name) rejects
//      with a `ValidationError` whose `.message` carries the `[VALIDATION]`
//      prefix and contains "name" — preload's `reviveError` depends on this
//      exact prefix (D-14).
//   2. Create round-trip (PROJ-03 main-side) — `handleCreate({ name: 'Acme',
//      number: null })` resolves to a Project with project_name 'Acme' and
//      a positive integer id.
//   3. List after create (PROJ-01/PROJ-05) — `handleList({})` resolves to an
//      array containing the created project.
//   4. UpdateNumber round-trip (PROJ-04) — `handleUpdateNumber({ id, number: '1042' })`
//      resolves; subsequent `handleList` shows project_number === '1042'.
//   5. NotFound guard (T-5-04) — `handleUpdateNumber({ id: 999999, number: '1' })`
//      rejects with NotFoundError.
//
// Handlers are invoked directly (no ipcMain.handle round-trip — matches the
// established direct-invocation pattern in timeEntries.test.ts).
//
// Refs:
//   - 05-01-PLAN.md Task 3 <behavior> + <action>
//   - src/main/ipc/timeEntries.test.ts (canonical IPC test scaffold)
//   - src/main/db/repositories/projects.test.ts (DB setup pattern)
//   - threat model T-5-02 (Zod boundary — CreateArgsSchema.name min(1))
//   - threat model T-5-04 (NotFoundError on 0 changes)

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

// CRITICAL: `vi.mock('electron', ...)` is hoisted by vitest above all imports.
// projects.ts imports `ipcMain` from 'electron' for the
// `registerProjectsHandlers` export, which would load the real Electron.
// Mocking keeps the test in pure Node (same hoisted-mock pattern as
// timeEntries.test.ts — RESEARCH § Pitfall 6).
import { vi } from 'vitest'
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import { initDb, closeDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import { resetStmtCache } from '@main/db/repositories/projects'
import { ValidationError, NotFoundError } from '@shared/errors'
import { handleList, handleCreate, handleUpdateNumber } from './projects'

describe('projects IPC handlers — boundary behavior', () => {
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

  // Test 1 — Zod boundary (D-15 / T-5-02) — missing name rejects with ValidationError.
  // The [VALIDATION] prefix is what preload's `reviveError` matches to rebuild
  // the typed subclass on the renderer side (D-14). Never erode this prefix.
  it('handleCreate rejects with ValidationError when name is missing (Zod boundary)', async () => {
    await expect(handleCreate({})).rejects.toThrow(ValidationError)
    await expect(handleCreate({})).rejects.toMatchObject({
      message: expect.stringMatching(/^\[VALIDATION\] /),
    })
    await expect(handleCreate({})).rejects.toMatchObject({
      message: expect.stringContaining('name'),
    })
  })

  // Test 2 — PROJ-03 main-side round-trip — create returns a well-formed Project.
  it('handleCreate resolves to a Project with project_name and positive integer id', async () => {
    const result = await handleCreate({ name: 'Acme', number: null })
    expect(result.project_name).toBe('Acme')
    expect(result.project_number).toBeNull()
    expect(typeof result.id).toBe('number')
    expect(result.id).toBeGreaterThan(0)
  })

  // Test 3 — PROJ-01/PROJ-05 — list after create contains the created project.
  it('handleList returns an array containing the created project (PROJ-01/PROJ-05)', async () => {
    const created = await handleCreate({ name: 'Acme', number: null })
    const list = await handleList({})
    expect(Array.isArray(list)).toBe(true)
    expect(list.some((p) => p.id === created.id && p.project_name === 'Acme')).toBe(true)
  })

  // Test 4 — PROJ-04 — updateNumber changes project_number; list reflects it.
  it('handleUpdateNumber sets project_number; subsequent handleList shows the new number', async () => {
    const created = await handleCreate({ name: 'Acme', number: null })
    await expect(
      handleUpdateNumber({ id: created.id, number: '1042' }),
    ).resolves.toBeUndefined()
    const list = await handleList({})
    const updated = list.find((p) => p.id === created.id)
    expect(updated?.project_number).toBe('1042')
  })

  // Test 5 — T-5-04 / NotFound guard — updateNumber with non-existent id rejects.
  it('handleUpdateNumber rejects with NotFoundError for non-existent id (T-5-04)', async () => {
    await expect(
      handleUpdateNumber({ id: 999999, number: '1' }),
    ).rejects.toThrow(NotFoundError)
  })
})
