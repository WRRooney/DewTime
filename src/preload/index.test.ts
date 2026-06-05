// src/preload/index.test.ts
// Tests for the preload contextBridge wiring. The preload module's side
// effects (registering a wrapper object via contextBridge.exposeInMainWorld)
// run at import time, so we mock 'electron' BEFORE importing the module.
//
// Phase 4 (Plan 04-05) extends this file with:
//   - 7 tests for the timers.* real invokeWrapped bridges (replaces notImpl stubs)
//   - 1 test for tick.subscribe/unsubscribe contract (D-07/D-08/RESEARCH § Pitfall 1)
//
// Refs:
//   - 01-04-PLAN.md Task 2 <behavior> (2 tests minimum — Phase 1)
//   - 04-05-PLAN.md Task 2 <action> (8 new tests — Phase 4)
//   - RESEARCH.md §4 lines ~821 (planner flag: explicit method enumeration)
//   - threat model T-01-02 (no ipcRenderer leak via contextBridge)
//   - threat model T-04-08 (tick.subscribe returns cleanup; removeListener called)
//   - CONTEXT.md D-14 + src/shared/errors.ts (reviveError round-trip)
//   - 04-CONTEXT.md D-07/D-08 (tick:update channel + preload bridge shape)
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ValidationError } from '@shared/errors'

// `vi.mock` factories are hoisted ABOVE all top-level statements (vitest
// behaviour); they may NOT close over module-scope `let`/`const`. We declare
// stubs inside the factory, then re-import them via `await import('electron')`
// inside each test to grab the live spy references.
// Phase 4: add `on` and `removeListener` to ipcRenderer mock for tick.subscribe
// contract tests (T-04-08 — same listener reference used for both on + removeListener).
vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

describe('preload — contextBridge wiring', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('exposes only the named ElectronApi shape — no ipcRenderer / _invoke escape hatch', async () => {
    const { contextBridge } = await import('electron')
    // Import the preload — this triggers exposeInMainWorld at module-load time.
    await import('./index')

    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1)
    // Phase 4: tick namespace is now present alongside the existing namespaces
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      'api',
      expect.objectContaining({
        system: expect.any(Object),
        timers: expect.any(Object),
        projects: expect.any(Object),
        timeEntries: expect.any(Object),
        settings: expect.any(Object),
        tick: expect.any(Object),
      }),
    )

    // T-01-02: no ipcRenderer leak; no _invoke escape hatch on the exposed
    // object. Pull the second argument out of the spy and inspect its keys.
    const callArgs = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]
    expect(callArgs).toBeDefined()
    const exposed = callArgs![1] as Record<string, unknown>
    const topLevelKeys = Object.keys(exposed)
    expect(topLevelKeys).toEqual(
      expect.arrayContaining([
        'system',
        'timers',
        'projects',
        'timeEntries',
        'settings',
        'tick',
      ]),
    )
    expect(topLevelKeys).not.toContain('ipcRenderer')
    expect(topLevelKeys).not.toContain('_invoke')
    expect(topLevelKeys).not.toContain('invoke')
  })

  it('invokeWrapped rebuilds typed Error subclasses via reviveError', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    // Arrange the ipcRenderer.invoke spy to reject with the [VALIDATION]
    // prefix-encoded message that handlers produce. reviveError should
    // unwrap that into a fresh ValidationError on the renderer side.
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('[VALIDATION] bad input'),
    )

    await import('./index')

    // Import the fresh ValidationError from the same module instance that the
    // preload's reviveError will use. vi.resetModules() in beforeEach causes each
    // test to load fresh module instances; importing at the top-level would give
    // a stale class reference that fails instanceof checks (different class from
    // the fresh module).
    const { ValidationError: FreshValidationError } = await import('@shared/errors')

    const callArgs = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]
    expect(callArgs).toBeDefined()
    const exposed = callArgs![1] as {
      system: { echo: (msg: string) => Promise<string> }
    }

    // The renderer-side call should reject with a real ValidationError —
    // not the plain Error the IPC bus actually delivered.
    let caught: unknown
    try {
      await exposed.system.echo('hi')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(FreshValidationError)
    // .message has the prefix stripped (per reviveError contract).
    expect((caught as Error).message).toBe('bad input')
  })

  // ---------------------------------------------------------------------------
  // Phase 4: timers.* real invokeWrapped bridges (7 tests — replaces notImpl stubs)
  // Asserts each method calls ipcRenderer.invoke with the EXACT channel literal
  // and properly-shaped args envelope (T-01-03 channel-name-literal contract).
  // ---------------------------------------------------------------------------

  it('timers.list invokes ipcRenderer with "timers.list" channel', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce([])
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as { timers: { list: (dr?: unknown) => Promise<unknown> } }

    await exposed.timers.list()

    expect(ipcRenderer.invoke).toHaveBeenCalledWith('timers.list', { dateRange: undefined })
  })

  it('timers.create invokes ipcRenderer with "timers.create" channel and args envelope', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 1, description: 'foo' })
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as { timers: { create: (args: { projectId: number | null; description: string }) => Promise<unknown> } }

    await exposed.timers.create({ projectId: null, description: 'foo' })

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'timers.create',
      { projectId: null, description: 'foo' },
    )
  })

  it('timers.delete invokes ipcRenderer with "timers.delete" + { id } envelope (wraps bare number)', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as { timers: { delete: (id: number) => Promise<void> } }

    await exposed.timers.delete(42)

    // bare number 42 must be wrapped into { id: 42 } for IdArgsSchema
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('timers.delete', { id: 42 })
  })

  it('timers.setDescription invokes ipcRenderer with "timers.setDescription" + { id, description }', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as { timers: { setDescription: (id: number, description: string) => Promise<void> } }

    await exposed.timers.setDescription(7, 'updated')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'timers.setDescription',
      { id: 7, description: 'updated' },
    )
  })

  it('timers.setProject invokes ipcRenderer with "timers.setProject" + { id, projectId }', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as { timers: { setProject: (id: number, projectId: number | null) => Promise<void> } }

    await exposed.timers.setProject(7, null)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'timers.setProject',
      { id: 7, projectId: null },
    )
  })

  it('timers.setOffset invokes ipcRenderer with "timers.setOffset" + { id, offsetSeconds }', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as { timers: { setOffset: (id: number, offsetSeconds: number | null) => Promise<void> } }

    await exposed.timers.setOffset(7, 300)

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'timers.setOffset',
      { id: 7, offsetSeconds: 300 },
    )
  })

  it('timers.setNotes invokes ipcRenderer with "timers.setNotes" + { id, notes }', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    ;(ipcRenderer.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as { timers: { setNotes: (id: number, notes: string) => Promise<void> } }

    await exposed.timers.setNotes(7, 'my notes')

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'timers.setNotes',
      { id: 7, notes: 'my notes' },
    )
  })

  // ---------------------------------------------------------------------------
  // Phase 4: tick.subscribe/unsubscribe contract (D-07/D-08/RESEARCH § Pitfall 1)
  //
  // The subscribe call MUST:
  //   1. Call ipcRenderer.on('tick:update', listener) with a captured listener fn
  //   2. Return a cleanup function
  //   3. The cleanup function MUST call ipcRenderer.removeListener('tick:update',
  //      THE SAME listener reference) — not a newly-created function.
  //
  // T-04-08: using a new lambda in removeListener fails to unsubscribe because
  // ipcRenderer.removeListener matches by reference equality, not by shape.
  // ---------------------------------------------------------------------------

  it('tick.subscribe registers ipcRenderer.on("tick:update") and returns cleanup that calls removeListener with same reference', async () => {
    const { contextBridge, ipcRenderer } = await import('electron')
    await import('./index')
    const exposed = (contextBridge.exposeInMainWorld as ReturnType<typeof vi.fn>)
      .mock.calls[0]![1] as {
        tick: { subscribe: (cb: (payload: unknown) => void) => () => void }
      }

    const cb = vi.fn()
    const unsubscribe = exposed.tick.subscribe(cb)

    // Step 1: ipcRenderer.on was called with the 'tick:update' channel
    expect(ipcRenderer.on).toHaveBeenCalledWith('tick:update', expect.any(Function))

    // Step 2: the returned value is a function (the cleanup)
    expect(typeof unsubscribe).toBe('function')

    // Step 3: call the cleanup and assert removeListener is called
    unsubscribe()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('tick:update', expect.any(Function))

    // Step 4: SAME listener reference — the function passed to removeListener
    // must be the same reference that was passed to ipcRenderer.on.
    // Extract both captured listener arguments and compare by reference.
    const listenerPassedToOn = (ipcRenderer.on as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    const listenerPassedToRemove = (ipcRenderer.removeListener as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect(listenerPassedToOn).toBe(listenerPassedToRemove)
  })
})
