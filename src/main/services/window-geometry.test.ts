// src/main/services/window-geometry.test.ts
// Window-geometry service tests against mocked `electron.screen` +
// mocked `@main/db/repositories/settings`. Five cases covering the public
// surface of `src/main/services/window-geometry.ts` (Plan 03-02):
//
//   WIN-06b: readSavedBounds returns saved x/y when point in workArea
//   WIN-06c: readSavedBounds offscreen → center (omit x/y)
//   WIN-06d: scheduleWrite debounces — one write 250 ms after last 'moved'
//   WIN-06e: flushPendingWrite on 'close' writes synchronously
//   WIN-06f: isPointVisible handles multi-monitor including negative-x secondary
//
// Refs:
//   - 03-02-PLAN.md Task 1 <behavior> + <action>
//   - 03-CONTEXT.md D-09..D-12 (composite key, 250 ms debounce, boot order, clamp)
//   - 03-RESEARCH.md § Pattern 3 (full service shape)
//   - 03-RESEARCH.md § Pitfall 4 (resetForTests cleanup), § Pitfall 6 (Linux
//     'moved' undocumented — debounce is the contract, not the native event timing),
//     § Pitfall 10 (mock electron.screen because getAllDisplays() returns [] before
//     app.whenReady() but is mocked in tests anyway)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'

// CRITICAL: `vi.mock(...)` factories are hoisted above all imports. Module-
// scoped `const` declarations are NOT visible to the hoisted factory (the
// factory runs first, before the consts are initialized — "Cannot access X
// before initialization"). The canonical vitest workaround is `vi.hoisted()`:
// declare the spies inside a `vi.hoisted(() => ({...}))` block so the factory
// AND the test bodies both reference the same hoisted handle.
//
// The service-under-test imports `screen` from 'electron' and the @main/log
// chain transitively loads `electron-log` which would load native Electron
// without the mock. We also stub the settings repo (`get` / `set`) so each
// test can stage return values or trigger NotFoundError.
const mocks = vi.hoisted(() => ({
  screenMock: {
    getAllDisplays: vi.fn<
      () => Array<{ workArea: { x: number; y: number; width: number; height: number } }>
    >(),
  },
  settingsGet: vi.fn<(key: string) => unknown>(),
  settingsSet: vi.fn<(key: string, value: unknown) => void>(),
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/never-used-with-:memory:' },
  powerMonitor: { on: vi.fn() },
  ipcMain: { handle: vi.fn() },
  screen: mocks.screenMock,
}))

vi.mock('@main/db/repositories/settings', () => ({
  get: (key: string) => mocks.settingsGet(key),
  set: (key: string, value: unknown) => mocks.settingsSet(key, value),
}))

const { screenMock, settingsGet, settingsSet } = mocks

import * as windowGeometry from './window-geometry'
import { NotFoundError } from '@shared/errors'

/** Build a minimal BrowserWindow shim sufficient for the geometry listener
 *  surface. EventEmitter gives us .on/.emit; getBounds + isDestroyed are
 *  the only other methods the service touches. */
function makeMockWindow(
  bounds: { x: number; y: number; width: number; height: number } = {
    x: 120,
    y: 140,
    width: 820,
    height: 620,
  },
): EventEmitter & {
  getBounds: () => { x: number; y: number; width: number; height: number }
  isDestroyed: () => boolean
} {
  const win = Object.assign(new EventEmitter(), {
    getBounds: vi.fn().mockReturnValue(bounds),
    isDestroyed: vi.fn().mockReturnValue(false),
  })
  return win
}

describe('window-geometry service — read/clamp/write', () => {
  beforeEach(() => {
    windowGeometry.resetForTests()
    settingsGet.mockReset()
    settingsSet.mockReset()
    screenMock.getAllDisplays.mockReset()
  })

  afterEach(() => {
    windowGeometry.resetForTests()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // -------------------------------------------------------------------------
  // WIN-06b — saved bounds inside the visible workArea are returned as-is
  // -------------------------------------------------------------------------
  it('WIN-06b: readSavedBounds returns saved x/y when point is inside visible workArea', () => {
    // Arrange: one 1920x1040 display at origin, saved bounds well inside it.
    settingsGet.mockReturnValue({ x: 100, y: 100, width: 800, height: 600 })
    screenMock.getAllDisplays.mockReturnValue([
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    ])

    const result = windowGeometry.readSavedBounds()

    expect(result).toEqual({ x: 100, y: 100, width: 800, height: 600 })
  })

  // -------------------------------------------------------------------------
  // WIN-06c — saved bounds outside any display → center (omit x/y)
  // -------------------------------------------------------------------------
  it('WIN-06c: readSavedBounds with offscreen saved coords returns width/height only (Electron centers)', () => {
    // Arrange: same single display, but saved coords are way out of range.
    settingsGet.mockReturnValue({ x: 9999, y: 9999, width: 800, height: 600 })
    screenMock.getAllDisplays.mockReturnValue([
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    ])

    const result = windowGeometry.readSavedBounds()

    // No x/y keys in the returned object → Electron centers the window.
    expect(result).not.toHaveProperty('x')
    expect(result).not.toHaveProperty('y')
    expect(result).toEqual({ width: 800, height: 600 })
  })

  // -------------------------------------------------------------------------
  // WIN-06d — debounce: a burst of 'moved' events fires exactly ONE write
  // 250 ms after the LAST event.
  // -------------------------------------------------------------------------
  it('WIN-06d: scheduleWrite debounces 5 rapid moved events into one settings.set after 250 ms', () => {
    vi.useFakeTimers()
    // Arrange: one display so the boot-time clamp (if invoked) works; attach
    // the mock window so the service has something to read getBounds() on.
    screenMock.getAllDisplays.mockReturnValue([
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    ])
    const win = makeMockWindow({ x: 200, y: 300, width: 900, height: 700 })
    windowGeometry.attachListeners(win as unknown as Electron.BrowserWindow)

    // Act: fire 'moved' five times within the debounce window.
    win.emit('moved')
    vi.advanceTimersByTime(50)
    win.emit('moved')
    vi.advanceTimersByTime(50)
    win.emit('moved')
    vi.advanceTimersByTime(50)
    win.emit('moved')
    vi.advanceTimersByTime(50)
    win.emit('moved')

    // No write yet — last event was 0 ms ago, debounce is 250 ms.
    expect(settingsSet).not.toHaveBeenCalled()

    // Advance past the debounce window from the LAST event.
    vi.advanceTimersByTime(windowGeometry.GEOMETRY_DEBOUNCE_MS)

    // Assert: exactly one write with the window's current bounds.
    expect(settingsSet).toHaveBeenCalledTimes(1)
    expect(settingsSet).toHaveBeenCalledWith(
      'settings.window_geometry',
      expect.objectContaining({ x: 200, y: 300, width: 900, height: 700 }),
    )
  })

  // -------------------------------------------------------------------------
  // WIN-06e — flush on 'close' fires synchronously even with a pending timer
  // -------------------------------------------------------------------------
  it('WIN-06e: flushPendingWrite fires synchronously on close, even with a pending debounce timer', () => {
    vi.useFakeTimers()
    screenMock.getAllDisplays.mockReturnValue([
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    ])
    const win = makeMockWindow({ x: 250, y: 350, width: 820, height: 620 })
    windowGeometry.attachListeners(win as unknown as Electron.BrowserWindow)

    // Trigger a pending debounced write — but do NOT advance to fire it.
    win.emit('moved')
    expect(settingsSet).not.toHaveBeenCalled()

    // Fire the 'close' listener — must call settingsSet synchronously without
    // needing any timer advance. This is the AP-08 final-flush contract.
    win.emit('close')

    // Assert (still NO timer advance) — settingsSet was called exactly once.
    expect(settingsSet).toHaveBeenCalledTimes(1)
    expect(settingsSet).toHaveBeenCalledWith(
      'settings.window_geometry',
      expect.objectContaining({ x: 250, y: 350, width: 820, height: 620 }),
    )

    // Advancing the timer must NOT trigger a second write — the pending
    // timer was cleared by flushPendingWrite.
    vi.advanceTimersByTime(windowGeometry.GEOMETRY_DEBOUNCE_MS + 100)
    expect(settingsSet).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // WIN-06f — multi-monitor with negative-x secondary display
  // -------------------------------------------------------------------------
  it('WIN-06f: isPointVisible accepts a point inside a negative-x secondary monitor', () => {
    // Layout: primary 1920x1040 at origin; secondary 1920x1040 at x=-1920.
    // A point at (-1500, 200) sits inside the secondary's workArea.
    screenMock.getAllDisplays.mockReturnValue([
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { workArea: { x: -1920, y: 0, width: 1920, height: 1040 } },
    ])

    expect(
      windowGeometry.isPointVisible({
        x: -1500,
        y: 200,
        width: 800,
        height: 600,
      }),
    ).toBe(true)

    // Sanity: a point in the primary monitor is also visible.
    expect(
      windowGeometry.isPointVisible({
        x: 100,
        y: 100,
        width: 800,
        height: 600,
      }),
    ).toBe(true)

    // And a point well outside both monitors is NOT visible.
    expect(
      windowGeometry.isPointVisible({
        x: 5000,
        y: 5000,
        width: 800,
        height: 600,
      }),
    ).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Bonus: missing settings row (NotFoundError) → defaults to 800x600 + center
  // -------------------------------------------------------------------------
  it('readSavedBounds returns default 800x600 (no x/y) when settings row is missing (NotFoundError)', () => {
    settingsGet.mockImplementation(() => {
      throw new NotFoundError('settings key not found: settings.window_geometry')
    })
    screenMock.getAllDisplays.mockReturnValue([
      { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    ])

    const result = windowGeometry.readSavedBounds()

    expect(result).toEqual({ width: 800, height: 600 })
    expect(result).not.toHaveProperty('x')
    expect(result).not.toHaveProperty('y')
  })
})
