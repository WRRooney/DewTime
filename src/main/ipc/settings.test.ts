// src/main/ipc/settings.test.ts
// IPC boundary tests for the `settings.*` namespace. Four cases covering the
// SET-IPC-01..04 requirements:
//
//   1. SET-IPC-01 — `settings.get` rejects unknown key with ValidationError
//      (the SettingKeySchema enum gate fires inside GetArgsSchema).
//   2. SET-IPC-02 — `settings.set` discriminatedUnion gate: week_start=7 →
//      reject; week_start=0 + 6 → accept; window_geometry width=-1 → reject.
//   3. SET-IPC-03 — `settings.list` returns every seeded key (the five from
//      001_initial.sql plus the composite settings.window_geometry from
//      002_window_geometry.sql) with JSON-parsed values.
//   4. SET-04 / SET-IPC-04 — handleSet → handleGet round-trip writes through
//      to the SQLite settings table (service-bypass exception verified end-
//      to-end; the static grep gate `grep -c "@main/services" ... = 0` is
//      enforced in the plan's <verify> step, not in this file).
//
// Handlers are tested directly (not via `ipcMain.handle`) — matches the
// Phase 2 `timeEntries.test.ts` shape and the Phase 1 `system.test.ts` shape.
//
// Refs:
//   - 03-03-PLAN.md Task 1 <behavior>
//   - 03-CONTEXT.md D-18, D-19, D-21, D-28 (service-bypass exception)
//   - 03-VALIDATION.md § Per-Requirement Verification Map (SET-IPC-01..04)
//   - 03-RESEARCH.md § Pattern 6 (literal handler shape) + § Pattern 11
//     (discriminated union)
//   - src/main/ipc/timeEntries.test.ts (canonical Phase 2 IPC test scaffold)
//   - src/shared/contracts/settings.ts (SetArgsSchema discriminatedUnion shipped
//     by plan 03-01)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// `vi.mock('electron', ...)` is hoisted by vitest above all imports.
// `settings.ts` imports `ipcMain` from 'electron' for the
// `registerSettingsHandlers` export; mocking keeps the test in pure Node
// (matches the Phase 2 `timeEntries.test.ts` pattern).
// BrowserWindow is also mocked so the always_on_top live-apply side effect
// can be tested without a real Electron environment.
// NOTE: vi.mock factories are hoisted — do NOT close over module-scope
// variables (they are not yet initialized at hoist time). Instead, use
// vi.importMock or access the mocks via the imported module after vi.mock.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(),
  },
}))

// Mock the updater service so auto_update live-apply side effects can be tested
// without a real electron-updater or packaged app environment.
// NOTE: hoisted alongside the electron mock — do NOT close over module-scope vars.
vi.mock('@main/services/updater', () => ({
  initUpdater: vi.fn(),
  stopUpdater: vi.fn(),
}))

import { BrowserWindow } from 'electron'
import { initUpdater, stopUpdater } from '@main/services/updater'
import { initDb, closeDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import { resetStmtCache as resetSettings } from '@main/db/repositories/settings'
import { ValidationError } from '@shared/errors'
import { handleGet, handleSet, handleList } from './settings'

// Per-test mock window spies. Re-assigned in beforeEach after vi.clearAllMocks()
// so the fresh instances are available for each test body.
let mockSetAlwaysOnTop: ReturnType<typeof vi.fn>
let mockIsDestroyed: ReturnType<typeof vi.fn>

describe('settings IPC handlers — boundary behavior', () => {
  beforeEach(() => {
    closeDb()
    resetSettings()
    vi.clearAllMocks()

    // Recreate fresh spy instances for each test so clearAllMocks does not
    // leave the getAllWindows mock returning undefined.
    mockSetAlwaysOnTop = vi.fn()
    mockIsDestroyed = vi.fn().mockReturnValue(false)
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      { setAlwaysOnTop: mockSetAlwaysOnTop, isDestroyed: mockIsDestroyed } as unknown as Electron.BrowserWindow,
    ])

    initDb(':memory:')
    runMigrations()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    closeDb()
    resetSettings()
  })

  // SET-IPC-01 — unknown-key rejection.
  // The Zod gate (`SettingKeySchema` enum inside `GetArgsSchema`) fires
  // before any DB call. Unknown keys reject with a prefix-encoded
  // ValidationError so preload's reviveError can rebuild the typed subclass
  // on the renderer side (T-03-02 spoofing mitigation).
  it('SET-IPC-01: settings.get rejects unknown key with ValidationError', async () => {
    await expect(handleGet({ key: 'foo.bar' })).rejects.toThrow(ValidationError)
    // Prefix-encoded message survives Electron's IPC structured-clone.
    await expect(handleGet({ key: 'foo.bar' })).rejects.toMatchObject({
      message: expect.stringMatching(/^\[VALIDATION\] /),
    })
  })

  // SET-IPC-02 — discriminated union value gate.
  // Three sub-assertions:
  //   (a) week_start=7 → reject (T-03-01 — value outside {0,6}).
  //   (b) week_start=0 → accept; week_start=6 → accept (Monday + Sunday).
  //   (c) window_geometry width=-1 → reject (T-03-03 bad bounds; Zod's
  //       `.int().positive()` rejects negative width).
  it('SET-IPC-02: settings.set discriminated union — week_start=7 rejected; 0 and 6 accepted; window_geometry width=-1 rejected', async () => {
    // (a) week_start=7 — out of {0,6} → reject.
    await expect(
      handleSet({ key: 'settings.week_start', value: 7 }),
    ).rejects.toThrow(ValidationError)

    // (b) week_start=0 (Monday) → accept (resolves, no throw).
    await expect(
      handleSet({ key: 'settings.week_start', value: 0 }),
    ).resolves.toBeUndefined()
    // (b) week_start=6 (Sunday) → accept.
    await expect(
      handleSet({ key: 'settings.week_start', value: 6 }),
    ).resolves.toBeUndefined()

    // (c) window_geometry width=-1 → reject (positive-int gate).
    await expect(
      handleSet({
        key: 'settings.window_geometry',
        value: { x: null, y: null, width: -1, height: 600 },
      }),
    ).rejects.toThrow(ValidationError)
  })

  // SET-IPC-03 — `settings.list` returns every seeded key including the
  // new composite window_geometry, always_on_top, and auto_update. JSON parsing
  // happens in the repo's `getAll()` — this test verifies the round-trip from
  // migration seed → repo → handler → renderer payload shape.
  it('SET-IPC-03: settings.list returns all seeded keys plus window_geometry composite, always_on_top, and auto_update', async () => {
    const all = await handleList(undefined)
    expect(all).toMatchObject({
      'settings.week_start': 0,
      'settings.dark_mode': true,
      'settings.auto_pause': false,
      'settings.widget_mode': 'floating',
      'settings.auto_launch': false,
      'settings.always_on_top': false,
      'settings.auto_update': true,
      'settings.window_geometry': {
        x: null,
        y: null,
        width: 800,
        height: 600,
      },
    })
  })

  // SET-04 / SET-IPC-04 — round-trip writes through to SQLite via the repo
  // (no service indirection). The service-bypass exception (D-28) is
  // statically enforced by the plan's <verify> step (`grep -c "@main/services"
  // src/main/ipc/settings.ts` returns 0); this test exercises the end-to-end
  // DB write path that the bypass enables.
  it('SET-04 / SET-IPC-04: handleSet writes through to the SQLite settings table (service-bypass round-trip)', async () => {
    // Default seed is week_start=0 (Monday).
    await expect(
      handleGet({ key: 'settings.week_start' }),
    ).resolves.toBe(0)

    // Switch to Sunday (6) via the IPC handler — exercises repo.set().
    await handleSet({ key: 'settings.week_start', value: 6 })

    // Read back via the IPC handler — exercises repo.get() against the
    // freshly-written row. If the write or the read went through any
    // service layer, the path would diverge here; the direct-repo bypass
    // is what makes this round-trip a single get→set→get against the
    // same connection.
    await expect(
      handleGet({ key: 'settings.week_start' }),
    ).resolves.toBe(6)
  })

  // ALWAYS-ON-TOP-01: setting always_on_top=true calls setAlwaysOnTop on live windows
  it('ALWAYS-ON-TOP-01: handleSet("settings.always_on_top", true) persists and calls setAlwaysOnTop(true) on live non-destroyed windows', async () => {
    // Seed default is false
    await expect(
      handleGet({ key: 'settings.always_on_top' }),
    ).resolves.toBe(false)

    // Set to true — should call live window's setAlwaysOnTop
    await handleSet({ key: 'settings.always_on_top', value: true })

    // Persisted in DB
    await expect(
      handleGet({ key: 'settings.always_on_top' }),
    ).resolves.toBe(true)

    // Side effect: live window setAlwaysOnTop was called
    expect(mockSetAlwaysOnTop).toHaveBeenCalledTimes(1)
    // On non-darwin the second arg ('floating') is NOT passed; we just check true was set
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  // ALWAYS-ON-TOP-02: setting always_on_top=false calls setAlwaysOnTop(false)
  it('ALWAYS-ON-TOP-02: handleSet("settings.always_on_top", false) calls setAlwaysOnTop(false) on live windows', async () => {
    await handleSet({ key: 'settings.always_on_top', value: false })
    expect(mockSetAlwaysOnTop).toHaveBeenCalledTimes(1)
    expect(mockSetAlwaysOnTop).toHaveBeenCalledWith(false)
  })

  // ALWAYS-ON-TOP-03: other keys do NOT trigger setAlwaysOnTop
  it('ALWAYS-ON-TOP-03: handleSet for other keys does NOT call setAlwaysOnTop', async () => {
    await handleSet({ key: 'settings.week_start', value: 6 })
    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled()
  })

  // ALWAYS-ON-TOP-04: destroyed windows are skipped
  it('ALWAYS-ON-TOP-04: handleSet skips destroyed windows when applying always_on_top', async () => {
    mockIsDestroyed.mockReturnValueOnce(true)
    await handleSet({ key: 'settings.always_on_top', value: true })
    expect(mockSetAlwaysOnTop).not.toHaveBeenCalled()
  })

  // AUTO-UPDATE-01: handleSet('settings.auto_update', true) persists AND calls initUpdater once
  it('AUTO-UPDATE-01: handleSet("settings.auto_update", true) persists and calls initUpdater with a non-destroyed window', async () => {
    // Default seed from migration 004 is true; set to false first to test toggling on
    await handleSet({ key: 'settings.auto_update', value: false })
    vi.mocked(initUpdater).mockClear()
    vi.mocked(stopUpdater).mockClear()

    await handleSet({ key: 'settings.auto_update', value: true })

    // Persisted in DB
    await expect(
      handleGet({ key: 'settings.auto_update' }),
    ).resolves.toBe(true)

    // Side effect: initUpdater called once with a BrowserWindow
    expect(initUpdater).toHaveBeenCalledTimes(1)
    expect(stopUpdater).not.toHaveBeenCalled()
  })

  // AUTO-UPDATE-02: handleSet('settings.auto_update', false) persists AND calls stopUpdater
  it('AUTO-UPDATE-02: handleSet("settings.auto_update", false) persists and calls stopUpdater, not initUpdater', async () => {
    await handleSet({ key: 'settings.auto_update', value: false })

    // Persisted in DB
    await expect(
      handleGet({ key: 'settings.auto_update' }),
    ).resolves.toBe(false)

    // Side effect: stopUpdater called, initUpdater NOT called
    expect(stopUpdater).toHaveBeenCalledTimes(1)
    expect(initUpdater).not.toHaveBeenCalled()
  })

  // AUTO-UPDATE-03: other keys do NOT trigger initUpdater or stopUpdater
  it('AUTO-UPDATE-03: handleSet for other keys does NOT call initUpdater or stopUpdater', async () => {
    await handleSet({ key: 'settings.week_start', value: 6 })
    expect(initUpdater).not.toHaveBeenCalled()
    expect(stopUpdater).not.toHaveBeenCalled()
  })
})
