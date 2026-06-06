// src/main/index.test.ts
// Tests for the Electron main entry. We assert the two security-critical
// behaviours documented in CONTEXT.md DATA-02 + threat model T-01-01:
//
//   1. createWindow() constructs BrowserWindow with locked-down webPreferences
//      (contextIsolation: true, nodeIntegration: false, sandbox: true,
//      webSecurity: true, allowRunningInsecureContent: false)
//   2. The TIMERZ_SMOKE=1 short-circuit runs the DB smoke logic and calls
//      app.exit(0) without constructing a BrowserWindow — enables plan 05's
//      packaged-binary smoke test (D-19)
//
// Refs:
//   - 01-04-PLAN.md Task 3 <behavior>
//   - CONTEXT.md DATA-02, D-19 (smoke branch)
//   - RESEARCH.md §5 lines ~933-967 (webPreferences flags)
//   - RESEARCH.md §8 lines ~1156-1190 (TIMERZ_SMOKE branch)

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// vi.mock factories MUST be hoisted above all top-level statements. They MAY
// NOT close over module-scope `let`/`const`. We declare the mock with inline
// vi.fn() instances; tests reach in via `await import('electron')` to grab
// the live spies. The 'app.whenReady' return is wrapped in Promise.resolve()
// so the main entry's `await app.whenReady()` immediately resolves.
vi.mock('electron', () => {
  // Each mocked window exposes a fresh `setAlwaysOnTop` spy so the macOS
  // `'floating'` branch (Phase 3 / WIN-02 / AP-10) can be asserted from a
  // post-construction view. `on` is here for plan 03-02 attachListeners
  // (moved/resized/close) which runMain wires after createWindow returns.
  const browserWindowSpy = vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    getBounds: vi.fn().mockReturnValue({ x: 0, y: 0, width: 800, height: 600 }),
    isDestroyed: vi.fn().mockReturnValue(false),
  }))
  return {
    app: {
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      exit: vi.fn(),
      getPath: vi.fn().mockReturnValue('/tmp/timerz-test-userdata-main'),
      quit: vi.fn(),
    },
    BrowserWindow: browserWindowSpy,
    ipcMain: {
      handle: vi.fn(),
    },
    // Phase 2 boot-order tests do not depend on powerMonitor signal flow
    // because vitest's fake-timers do not fire the OS resume event.
    powerMonitor: {
      on: vi.fn(),
    },
    // Phase 3 (plan 03-02) windowGeometry.readSavedBounds calls
    // screen.getAllDisplays at boot; runMain test scaffolding may import
    // the service even when the WIN-* tests do not exercise it.
    screen: {
      getAllDisplays: vi.fn().mockReturnValue([
        { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      ]),
    },
  }
})

describe('main entry — createWindow webPreferences (T-01-01)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('constructs BrowserWindow with contextIsolation + nodeIntegration:false + sandbox:true + webSecurity + !allowRunningInsecureContent', async () => {
    const { BrowserWindow } = await import('electron')
    const { createWindow } = await import('./index')

    createWindow()

    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as {
      webPreferences: Record<string, unknown>
    }
    expect(opts).toBeDefined()
    expect(opts.webPreferences.contextIsolation).toBe(true)
    expect(opts.webPreferences.nodeIntegration).toBe(false)
    expect(opts.webPreferences.sandbox).toBe(true)
    expect(opts.webPreferences.webSecurity).toBe(true)
    expect(opts.webPreferences.allowRunningInsecureContent).toBe(false)
    // The preload path MUST point at the BUILT bundle, not source. The
    // electron-vite build emits out/preload/index.cjs (CJS is mandatory
    // under sandbox: true — Electron docs:
    // electronjs.org/docs/latest/tutorial/sandbox#preload); main entry
    // sits at out/main/index.mjs so the relative is `../preload/index.cjs`.
    expect(opts.webPreferences.preload).toMatch(/preload[\\/]index\.cjs$/)
  })
})

describe('main entry — TIMERZ_SMOKE branch (D-19)', () => {
  let prevSmoke: string | undefined
  let prevNodeEnv: string | undefined
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    prevSmoke = process.env['TIMERZ_SMOKE']
    prevNodeEnv = process.env['NODE_ENV']
    process.env['TIMERZ_SMOKE'] = '1'
    // NODE_ENV=test prevents the bottom-of-file `runMain()` self-invoke from
    // firing on import; we call runMain() explicitly inside the test.
    process.env['NODE_ENV'] = 'test'
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    if (prevSmoke === undefined) delete process.env['TIMERZ_SMOKE']
    else process.env['TIMERZ_SMOKE'] = prevSmoke
    if (prevNodeEnv === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = prevNodeEnv
    logSpy.mockRestore()
  })

  it('runMain() runs the DB smoke and calls app.exit(0) WITHOUT constructing a BrowserWindow', async () => {
    // Mock the DB layer so the smoke branch can run end-to-end without
    // a real SQLite database in this test. The smoke body uses raw
    // .prepare/.run/.get on the singleton.
    const fakePrepareFor = (rowReturned: unknown) => ({
      run: vi.fn().mockReturnValue({ changes: 1 }),
      get: vi.fn().mockReturnValue(rowReturned),
    })
    const fakeDb = {
      prepare: vi
        .fn()
        // INSERT
        .mockReturnValueOnce(fakePrepareFor(undefined))
        // SELECT
        .mockReturnValueOnce(fakePrepareFor({ id: 1 }))
        // DELETE
        .mockReturnValueOnce(fakePrepareFor(undefined))
        // COUNT
        .mockReturnValueOnce(fakePrepareFor({ n: 0 })),
    }

    vi.doMock('@main/db/database', () => ({
      initDb: vi.fn().mockReturnValue(fakeDb),
      getDb: vi.fn().mockReturnValue(fakeDb),
      closeDb: vi.fn(),
    }))
    vi.doMock('@main/db/migrate', () => ({
      runMigrations: vi.fn(),
    }))

    const { app, BrowserWindow } = await import('electron')
    const { runMain } = await import('./index')

    await runMain()

    // The smoke branch must NOT create a BrowserWindow.
    expect(BrowserWindow).not.toHaveBeenCalled()
    // It must exit with code 0 on success.
    expect(app.exit).toHaveBeenCalledWith(0)
    // And it must log the SMOKE_OK marker (plan 05's smoke script greps for this).
    const loggedAny = logSpy.mock.calls.some((c) =>
      typeof c[0] === 'string' && c[0].includes('SMOKE_OK rowCount='),
    )
    expect(loggedAny).toBe(true)
  })
})

describe('main entry — Phase 3 frameless chrome (WIN-01, WIN-02, WIN-05, WIN-07)', () => {
  // Snapshot/restore process.platform around the macOS branch test (WIN-02).
  // `process.platform` is readonly under normal TS — we override via
  // Object.defineProperty so the createWindow runtime check sees the value we
  // pick, then restore in afterEach so other tests are not contaminated.
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform })
  })

  it('WIN-01 + WIN-05: BrowserWindow opts include frame:false, transparent:false, minWidth:500, minHeight:350, width:800, height:600, useContentSize:false, autoHideMenuBar:true', async () => {
    const { BrowserWindow } = await import('electron')
    const { createWindow } = await import('./index')

    createWindow({ bounds: { width: 800, height: 600 } })

    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(opts).toBeDefined()
    expect(opts['frame']).toBe(false)
    expect(opts['transparent']).toBe(false)
    expect(opts['minWidth']).toBe(500)
    expect(opts['minHeight']).toBe(350)
    expect(opts['width']).toBe(800)
    expect(opts['height']).toBe(600)
    expect(opts['useContentSize']).toBe(false)
    expect(opts['autoHideMenuBar']).toBe(true)
  })

  it("WIN-02: alwaysOnTop reflects persisted setting (false=default, true=opt-in); macOS-only setAlwaysOnTop(true, 'floating') branch fires only when setting is true (AP-10)", async () => {
    // --- darwin path with alwaysOnTop=false (default): no setAlwaysOnTop call ---
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    {
      // Mock settingsRepo to return false (windowed default)
      vi.doMock('@main/db/repositories/settings', () => ({
        get: vi.fn().mockReturnValue(false),
        set: vi.fn(),
        getAll: vi.fn().mockReturnValue({}),
        resetStmtCache: vi.fn(),
      }))
      const { BrowserWindow } = await import('electron')
      const { createWindow } = await import('./index')
      const win = createWindow()
      const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as Record<
        string,
        unknown
      >
      expect(opts['alwaysOnTop']).toBe(false)
      expect(win.setAlwaysOnTop).not.toHaveBeenCalled()
    }

    // --- darwin path with alwaysOnTop=true: setAlwaysOnTop('floating') fires ---
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    {
      vi.doMock('@main/db/repositories/settings', () => ({
        get: vi.fn().mockReturnValue(true),
        set: vi.fn(),
        getAll: vi.fn().mockReturnValue({}),
        resetStmtCache: vi.fn(),
      }))
      const { BrowserWindow } = await import('electron')
      const { createWindow } = await import('./index')
      const win = createWindow()
      const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as Record<
        string,
        unknown
      >
      expect(opts['alwaysOnTop']).toBe(true)
      expect(win.setAlwaysOnTop).toHaveBeenCalledTimes(1)
      expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    }

    // --- linux path with alwaysOnTop=false: no setAlwaysOnTop call ---------------
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'linux' })
    {
      vi.doMock('@main/db/repositories/settings', () => ({
        get: vi.fn().mockReturnValue(false),
        set: vi.fn(),
        getAll: vi.fn().mockReturnValue({}),
        resetStmtCache: vi.fn(),
      }))
      const { BrowserWindow } = await import('electron')
      const { createWindow } = await import('./index')
      const win = createWindow()
      const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as Record<
        string,
        unknown
      >
      expect(opts['alwaysOnTop']).toBe(false)
      expect(win.setAlwaysOnTop).not.toHaveBeenCalled()
    }

    // --- win32 path with alwaysOnTop=true: no 'floating' call (non-darwin) ------
    vi.resetModules()
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32' })
    {
      vi.doMock('@main/db/repositories/settings', () => ({
        get: vi.fn().mockReturnValue(true),
        set: vi.fn(),
        getAll: vi.fn().mockReturnValue({}),
        resetStmtCache: vi.fn(),
      }))
      const { BrowserWindow } = await import('electron')
      const { createWindow } = await import('./index')
      const win = createWindow()
      const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as Record<
        string,
        unknown
      >
      expect(opts['alwaysOnTop']).toBe(true)
      expect(win.setAlwaysOnTop).not.toHaveBeenCalled()
    }
  })

  it("WIN-07: BrowserWindow backgroundColor literal is '#181b21' (--color-bg hex; UI-SPEC anti-pattern A-11 positive gate)", async () => {
    const { BrowserWindow } = await import('electron')
    const { createWindow } = await import('./index')

    createWindow()

    const opts = vi.mocked(BrowserWindow).mock.calls[0]?.[0] as Record<
      string,
      unknown
    >
    expect(opts['backgroundColor']).toBe('#181b21')
  })
})
