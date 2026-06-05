// src/main/services/tick.test.ts
// TickService tests against :memory: SQLite + vi.useFakeTimers().
// Four cases covering the public surface of `src/main/services/tick.ts`
// (Plan 04-04):
//
//   1. start() fires emit() immediately then once every 1000 ms while a timer
//      is running — verifies first-paint and interval cadence.
//   2. stop() clears the interval and no further emits happen.
//   3. start() is idempotent — calling twice does not double the emit rate.
//   4. emit() returns silently when getAllWindows returns [] or the only window
//      isDestroyed === true (RESEARCH § Pitfall 7 / T-04-06 guard).
//
// Refs:
//   - 04-04-PLAN.md Task 1 <behavior> + <action>
//   - 04-CONTEXT.md D-06 (lifecycle + no idle broadcasts)
//   - 04-CONTEXT.md D-07 ('tick:update' channel literal)
//   - 04-RESEARCH.md § Pattern 4 (tick.ts template)
//   - 04-RESEARCH.md § Pitfall 7 (BrowserWindow isDestroyed guard)
//   - 04-PATTERNS.md § tick.test.ts (hoisted vi.mock('electron') shape)
//   - src/main/services/heartbeat.test.ts (exact analog: beforeEach/afterEach
//     DB+state reset pattern; vi.useFakeTimers setup)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// CRITICAL: `vi.mock('electron', ...)` is hoisted by vitest above all imports.
// tick.ts calls BrowserWindow.getAllWindows() — must be mocked so the send
// calls are intercepted by a spy. Also mocks app/powerMonitor/ipcMain so
// transitively-imported modules (electron-log) stay in pure Node (Pitfall 7 +
// 04-PATTERNS.md § tick.test.ts hoisted mock shape).
// NOTE: The factory MUST NOT reference module-level variables (hoisting
// restriction). BrowserWindow.getAllWindows is wired with a vi.fn() that the
// tests reassign via mockImplementation in beforeEach.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => [
      {
        isDestroyed: () => false,
        webContents: { send: vi.fn() },
      },
    ]),
  },
}))

import { initDb, closeDb } from '@main/db/database'
import { runMigrations } from '@main/db/migrate'
import {
  create as createTimer,
  resetStmtCache as resetTimers,
} from '@main/db/repositories/timers'
import {
  start as startEntry,
  resetStmtCache as resetTimeEntries,
} from '@main/db/repositories/timeEntries'
import * as tickService from './tick'
import { TICK_INTERVAL_MS, resetForTests } from './tick'
import { BrowserWindow } from 'electron'

/**
 * Helper: get the current webContents.send spy from the mocked BrowserWindow.
 * Returns undefined when getAllWindows returns [].
 */
function getSendSpy(): ReturnType<typeof vi.fn> | undefined {
  const wins = (BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>)()
  return wins[0]?.webContents?.send as ReturnType<typeof vi.fn> | undefined
}

/**
 * Helper: wire a fresh send spy into the BrowserWindow mock so each test
 * starts with a clean call-count.
 */
function freshWindow(): ReturnType<typeof vi.fn> {
  const send = vi.fn()
  ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([
    { isDestroyed: () => false, webContents: { send } },
  ])
  return send
}

describe('TickService — 1-second push-tick cadence', () => {
  beforeEach(() => {
    closeDb()
    resetTimers()
    resetTimeEntries()
    resetForTests()
    initDb(':memory:')
    runMigrations()
    vi.useFakeTimers()
    // Install a fresh send spy for each test.
    freshWindow()
  })

  afterEach(() => {
    resetForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
    closeDb()
    resetTimers()
    resetTimeEntries()
  })

  // Test 1 — start() emits immediately then every 1000 ms while a timer is running
  it('emits immediately on start() then once every 1000 ms while a timer is running', () => {
    // Arrange: a running entry exists so emit() does not early-return on
    // getRunning() === null.
    const timer = createTimer({ projectId: null, description: 'tick-test' })
    startEntry(timer.id)

    const send = freshWindow()

    // Act: start the tick service.
    tickService.start()

    // Assert: immediate emit fires once on start().
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('tick:update', expect.objectContaining({
      timerId: timer.id,
      elapsedSeconds: expect.any(Number),
    }))

    // Advance by 1000 ms — interval fires once more.
    vi.advanceTimersByTime(TICK_INTERVAL_MS)
    expect(send).toHaveBeenCalledTimes(2)

    // Advance by another 1000 ms — fires again.
    vi.advanceTimersByTime(TICK_INTERVAL_MS)
    expect(send).toHaveBeenCalledTimes(3)

    // Stop and advance — no more emits.
    tickService.stop()
    vi.advanceTimersByTime(TICK_INTERVAL_MS * 5)
    expect(send).toHaveBeenCalledTimes(3)
  })

  // Test 2 — stop() clears the interval and no further emits happen
  it('stop() clears the interval and no further emits happen', () => {
    const timer = createTimer({ projectId: null, description: 'stop-test' })
    startEntry(timer.id)

    const send = freshWindow()

    tickService.start()
    // Advance 1 full tick — immediate emit + interval emit = 2.
    vi.advanceTimersByTime(TICK_INTERVAL_MS)
    expect(send).toHaveBeenCalledTimes(2)

    tickService.stop()

    // Advance 5 more ticks — no new emits; count stays at 2.
    vi.advanceTimersByTime(TICK_INTERVAL_MS * 5)
    expect(send).toHaveBeenCalledTimes(2)
  })

  // Test 3 — start() is idempotent — calling twice does not double the emit rate
  it('start() is idempotent — calling twice does not install two intervals', () => {
    const timer = createTimer({ projectId: null, description: 'idempotent-test' })
    startEntry(timer.id)

    const send = freshWindow()

    // Two consecutive starts: second call must be a no-op (intervalHandle !== null
    // prevents re-entry). The second call also does NOT fire another immediate emit.
    tickService.start()
    tickService.start()

    // After 1 tick: 1 (immediate from first start) + 1 (interval) = 2.
    // If two intervals were installed, it would be 1 (immediate) + 1 (immediate, second call)
    // + 2 (two intervals firing) = 4. Since second start() is a no-op, count is 2.
    vi.advanceTimersByTime(TICK_INTERVAL_MS)
    expect(send).toHaveBeenCalledTimes(2) // NOT 4 — only one interval installed
  })

  // Test 4 — emit() returns silently when window array is empty or isDestroyed === true
  // RESEARCH § Pitfall 7 / T-04-06 guard.
  it('emit() returns silently when window array is empty or window is destroyed', () => {
    const timer = createTimer({ projectId: null, description: 'destroyed-win-test' })
    startEntry(timer.id)

    // Case A: getAllWindows returns empty array.
    ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([])
    tickService.start()
    // No send — the undefined window guard short-circuits.
    vi.advanceTimersByTime(TICK_INTERVAL_MS)
    tickService.stop()

    // Case B: getAllWindows returns a destroyed window.
    const destroyedSend = vi.fn()
    ;(BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([
      { isDestroyed: () => true, webContents: { send: destroyedSend } },
    ])
    tickService.start()
    expect(destroyedSend).toHaveBeenCalledTimes(0) // isDestroyed guard prevents send
    vi.advanceTimersByTime(TICK_INTERVAL_MS)
    expect(destroyedSend).toHaveBeenCalledTimes(0)
    tickService.stop()
  })
})
