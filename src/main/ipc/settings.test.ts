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
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

import { initDb, closeDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import { resetStmtCache as resetSettings } from '@main/db/repositories/settings'
import { ValidationError } from '@shared/errors'
import { handleGet, handleSet, handleList } from './settings'

describe('settings IPC handlers — boundary behavior', () => {
  beforeEach(() => {
    closeDb()
    resetSettings()
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
  // new composite window_geometry. JSON parsing happens in the repo's
  // `getAll()` — this test verifies the round-trip from migration seed →
  // repo → handler → renderer payload shape.
  it('SET-IPC-03: settings.list returns all seeded keys plus window_geometry composite', async () => {
    const all = await handleList(undefined)
    expect(all).toMatchObject({
      'settings.week_start': 0,
      'settings.dark_mode': true,
      'settings.auto_pause': false,
      'settings.widget_mode': 'floating',
      'settings.auto_launch': false,
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
})
