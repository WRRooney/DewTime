// src/main/ipc/system.test.ts
// Tests for system.* IPC handlers (echo + dbSmoke + closeWindow). Exercises
// the handler factory's Zod-validation gate via ValidationError on bad inputs,
// plus the DB round-trip path for dbSmoke against :memory: SQLite, plus the
// close-window delegation to BrowserWindow.getFocusedWindow() (Phase 3 / D-07).
//
// Refs:
//   - 01-04-PLAN.md Task 1 <behavior> (4 tests)
//   - 03-04-PLAN.md Task 1 <behavior> (WIN-04 close handler)
//   - RESEARCH.md §9 lines ~1258-1300 (canonical IPC handler test pattern —
//     test handler bodies directly, no ipcMain involved)
//   - CONTEXT.md D-13 (channel names are dotted; T-01-03 channel whitelist)
//   - CONTEXT.md D-15 (Zod at the IPC boundary; failures → ValidationError)
//   - 03-CONTEXT.md D-07 (closeWindow → BrowserWindow.getFocusedWindow()?.close())
//   - 03-RESEARCH.md § Anti-pattern AP-15 (NEVER use app.quit — bypasses 'close'
//     event so geometry flush in plan 03-02 would not fire)
//
// NOTE: vitest hoists vi.mock above all top-level statements. The 'electron'
// mock is required because system.ts imports `ipcMain` + `BrowserWindow` from
// 'electron' at the top of the file. The handler bodies (`handleEcho`,
// `handleDbSmoke`) do NOT touch ipcMain — they only touch the schemas and
// getDb(); `handleCloseWindow` calls BrowserWindow.getFocusedWindow() and
// invokes `.close()` on the returned handle.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// vi.mock factories MUST be hoisted above top-level statements and MAY NOT
// close over module-scope `let`/`const`. We declare the mock with inline
// vi.fn() instances; tests reach in via `await import('electron')` to grab
// the live spies. `BrowserWindow.getFocusedWindow` is a static method on the
// constructor — attach it directly to the spy function.
vi.mock('electron', () => {
  const browserWindowSpy = vi.fn() as unknown as {
    getFocusedWindow: ReturnType<typeof vi.fn>
  }
  browserWindowSpy.getFocusedWindow = vi.fn().mockReturnValue(null)
  return {
    ipcMain: {
      handle: vi.fn(),
    },
    BrowserWindow: browserWindowSpy,
  }
})

import { initDb, closeDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import { resetStmtCache as resetProjectsStmts } from '@main/db/repositories/projects'
import { ValidationError } from '@shared/errors'
import { handleEcho, handleDbSmoke, handleCloseWindow } from './system'

describe('system.echo handler', () => {
  it('returns the same string for valid input', async () => {
    await expect(handleEcho({ message: 'hi' })).resolves.toBe('hi')
  })

  it('rejects empty message with ValidationError (prefix-encoded)', async () => {
    await expect(handleEcho({ message: '' })).rejects.toThrow(ValidationError)
    // Also confirm the prefix-encoded message survives — preload's reviveError
    // depends on this exact prefix to rebuild the subclass on the renderer side.
    await expect(handleEcho({ message: '' })).rejects.toMatchObject({
      message: expect.stringMatching(/^\[VALIDATION\] /),
    })
  })

  it('rejects malformed args (wrong shape) with ValidationError', async () => {
    await expect(handleEcho({ wrong: 'shape' })).rejects.toThrow(ValidationError)
  })
})

describe('system.dbSmoke handler — DB round-trip', () => {
  beforeEach(() => {
    // Reset BOTH the DB singleton and the projects repository stmt cache so
    // each test gets a fresh :memory: DB + freshly-prepared statements bound
    // to that connection (the lazy-cache pattern established in plan 01-03).
    closeDb()
    resetProjectsStmts()
    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    closeDb()
    resetProjectsStmts()
  })

  it('round-trip: insert probe → SELECT → DELETE → returns { rowCount: 0, canRead: true }', async () => {
    // dbSmoke args schema is z.object({}).optional() — passing {} is fine.
    const result = await handleDbSmoke({})
    // The handler inserts a probe row, reads it back (canRead = true), then
    // DELETEs it. The final COUNT is 0 because cleanup happened in-handler.
    expect(result).toEqual({ rowCount: 0, canRead: true })
  })
})

describe('system.closeWindow handler (WIN-04, D-07)', () => {
  beforeEach(async () => {
    // Reset the BrowserWindow.getFocusedWindow spy between tests so prior
    // test state never leaks. The default return is `null` (no focused
    // window); per-test overrides set this via mockReturnValueOnce / etc.
    const electron = await import('electron')
    ;(electron.BrowserWindow as unknown as {
      getFocusedWindow: ReturnType<typeof vi.fn>
    }).getFocusedWindow.mockReset()
    ;(electron.BrowserWindow as unknown as {
      getFocusedWindow: ReturnType<typeof vi.fn>
    }).getFocusedWindow.mockReturnValue(null)
  })

  it('WIN-04: system.closeWindow calls BrowserWindow.getFocusedWindow().close()', async () => {
    const electron = await import('electron')
    const closeSpy = vi.fn()
    const fakeWin = { close: closeSpy, isDestroyed: vi.fn().mockReturnValue(false) }
    ;(electron.BrowserWindow as unknown as {
      getFocusedWindow: ReturnType<typeof vi.fn>
    }).getFocusedWindow.mockReturnValue(fakeWin)

    // Schema is z.object({}).optional() — both undefined and {} parse cleanly.
    await handleCloseWindow(undefined)

    expect(
      (electron.BrowserWindow as unknown as {
        getFocusedWindow: ReturnType<typeof vi.fn>
      }).getFocusedWindow,
    ).toHaveBeenCalledTimes(1)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('WIN-04: system.closeWindow no-ops when no focused window (no throw, no close call)', async () => {
    const electron = await import('electron')
    // getFocusedWindow returns null by default (set in beforeEach); confirm the
    // handler resolves cleanly without attempting any close-style call.
    await expect(handleCloseWindow(undefined)).resolves.toBeUndefined()
    expect(
      (electron.BrowserWindow as unknown as {
        getFocusedWindow: ReturnType<typeof vi.fn>
      }).getFocusedWindow,
    ).toHaveBeenCalledTimes(1)
  })
})
