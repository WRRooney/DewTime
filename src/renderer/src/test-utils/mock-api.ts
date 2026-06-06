// src/renderer/src/test-utils/mock-api.ts
// Typed window.api builder for renderer vitest specs.
//
// Contract (D-33 + 04-PATTERNS.md § mock-api.ts):
//   - `makeMockApi(overrides?)` returns a full `ElectronApi` object where every
//     method defaults to `vi.fn().mockRejectedValue(new Error('mock-api: unmocked
//     call to {namespace.method}'))` so unmocked calls fail loudly with a useful
//     identifier.
//   - Tests supply per-namespace overrides in `beforeEach`:
//       window.api = makeMockApi({ timers: { list: vi.fn().mockResolvedValue([...]) } })
//   - Per-namespace overrides are shallow-merged on top of the defaults — only
//     the provided method keys are replaced, the rest remain rejected-promise stubs.
//   - Do NOT import from 'electron' here — the renderer never imports from electron
//     and mocking it directly would break context isolation semantics (D-33).
//
// Namespaces mirrored (all 6 on ElectronApi):
//   timers (7 methods), projects (3 methods), timeEntries (8 methods — +setStart/setEnd Phase 5),
//   settings (3 methods), system (3 methods), tick (1 method — subscribe returns unsubscribe fn)
//
// Refs:
//   - src/shared/ipc.ts (ElectronApi + per-namespace interfaces)
//   - 04-RESEARCH.md § D-33, 04-PATTERNS.md § mock-api.ts

import { vi } from 'vitest'
import type { ElectronApi } from '@shared/ipc'

// ---------------------------------------------------------------------------
// DeepPartial type helper — allows callers to override any subset of the API
// shape without having to supply every method on every namespace.
// ---------------------------------------------------------------------------
// Functions are objects, so guard them FIRST — otherwise DeepPartial recurses
// into a method's own keys (apply/call/bind…) and collapses the call signature
// to `{}`, which then fails to assign back to the namespace API types.
type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Returns a full `ElectronApi` mock with every method defaulting to a
 * rejected promise. Pass `overrides` to replace specific methods per-test.
 *
 * Usage in beforeEach:
 * ```ts
 * window.api = makeMockApi({
 *   timers: { list: vi.fn().mockResolvedValue([]) },
 * })
 * ```
 */
export function makeMockApi(overrides?: DeepPartial<ElectronApi>): ElectronApi {
  const stub = (name: string) =>
    vi.fn().mockRejectedValue(new Error(`mock-api: unmocked call to ${name}`))

  const defaults: ElectronApi = {
    timers: {
      list: stub('timers.list') as ElectronApi['timers']['list'],
      create: stub('timers.create') as ElectronApi['timers']['create'],
      delete: stub('timers.delete') as ElectronApi['timers']['delete'],
      setDescription: stub('timers.setDescription') as ElectronApi['timers']['setDescription'],
      setProject: stub('timers.setProject') as ElectronApi['timers']['setProject'],
      setOffset: stub('timers.setOffset') as ElectronApi['timers']['setOffset'],
      setNotes: stub('timers.setNotes') as ElectronApi['timers']['setNotes'],
    },
    projects: {
      list: stub('projects.list') as ElectronApi['projects']['list'],
      create: stub('projects.create') as ElectronApi['projects']['create'],
      updateNumber: stub('projects.updateNumber') as ElectronApi['projects']['updateNumber'],
    },
    timeEntries: {
      start: stub('timeEntries.start') as ElectronApi['timeEntries']['start'],
      stop: stub('timeEntries.stop') as ElectronApi['timeEntries']['stop'],
      stopActive: stub('timeEntries.stopActive') as ElectronApi['timeEntries']['stopActive'],
      listByTimer: stub('timeEntries.listByTimer') as ElectronApi['timeEntries']['listByTimer'],
      getRunning: stub('timeEntries.getRunning') as ElectronApi['timeEntries']['getRunning'],
      checkResume: stub('timeEntries.checkResume') as ElectronApi['timeEntries']['checkResume'],
      setStart: stub('timeEntries.setStart') as ElectronApi['timeEntries']['setStart'],
      setEnd: stub('timeEntries.setEnd') as ElectronApi['timeEntries']['setEnd'],
      deleteEntry: stub('timeEntries.deleteEntry') as ElectronApi['timeEntries']['deleteEntry'],
    },
    settings: {
      get: stub('settings.get') as ElectronApi['settings']['get'],
      set: stub('settings.set') as ElectronApi['settings']['set'],
      list: stub('settings.list') as ElectronApi['settings']['list'],
    },
    system: {
      echo: stub('system.echo') as ElectronApi['system']['echo'],
      dbSmoke: stub('system.dbSmoke') as ElectronApi['system']['dbSmoke'],
      closeWindow: stub('system.closeWindow') as ElectronApi['system']['closeWindow'],
      // Default to a resolving no-op so copy-button clicks in cell tests don't reject.
      copyToClipboard: vi.fn().mockResolvedValue(undefined) as ElectronApi['system']['copyToClipboard'],
    },
    tick: {
      // Default stub: subscribe returns a no-op unsubscribe so tests that don't
      // exercise the tick channel don't throw. Override in tick-specific tests.
      subscribe: vi.fn(() => vi.fn()) as ElectronApi['tick']['subscribe'],
    },
    editor: {
      open: stub('editor.open') as ElectronApi['editor']['open'],
      notifyChanged: vi.fn() as ElectronApi['editor']['notifyChanged'],
      // onDataChanged returns a no-op unsubscribe like tick.subscribe.
      onDataChanged: vi.fn(() => vi.fn()) as ElectronApi['editor']['onDataChanged'],
    },
  }

  if (!overrides) return defaults

  return {
    timers: { ...defaults.timers, ...overrides.timers },
    projects: { ...defaults.projects, ...overrides.projects },
    timeEntries: { ...defaults.timeEntries, ...overrides.timeEntries },
    settings: { ...defaults.settings, ...overrides.settings },
    system: { ...defaults.system, ...overrides.system },
    tick: { ...defaults.tick, ...overrides.tick },
    editor: { ...defaults.editor, ...overrides.editor },
  }
}
