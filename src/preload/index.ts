// src/preload/index.ts
// Preload script — exposes a typed `window.api` to the renderer via Electron's
// `contextBridge`. Runs in an isolated context with NO node integration and
// the v8 sandbox enabled (D-12 + DATA-02 + T-01-01).
//
// EXPLICIT METHOD ENUMERATION over Proxy stubs:
//   RESEARCH.md §4 line 821 flags Proxy-based bridge stubs as risky on
//   Electron 38 (contextBridge clones proxies in ways that drop traps in
//   edge cases). We enumerate every method on every namespace by name; the
//   verbosity tax is the price for predictable behaviour under sandbox+
//   contextIsolation. Phase 1 only WIRES `system.*`; the other namespaces
//   ship placeholder rejections so a renderer accidentally calling
//   `window.api.timers.list()` in dev mode gets a clear error rather than
//   `undefined is not a function`.
//
// ERROR REVIVAL:
//   Every ipcRenderer.invoke is wrapped in `invokeWrapped` which catches
//   rejections and runs `reviveError` (src/shared/errors.ts). [VALIDATION]
//   / [NOT_FOUND] / [INVARIANT] prefixed errors thrown from main handlers
//   rebuild as their typed subclass on the renderer side — so React code
//   can use `try { … } catch (e) { if (e instanceof ValidationError) … }`
//   normally (per D-14 refinement).
//
// SANDBOX CONSTRAINTS (RESEARCH.md §5 lines ~969-979):
//   Under sandbox: true, preload may only `require('electron')` (a subset:
//   contextBridge + ipcRenderer), `events`, `timers`, `url`. We import
//   `@shared/errors` (the bundled `reviveError`) — that's fine because
//   electron-vite bundles `@shared/errors` INTO the preload bundle; there
//   is no runtime `require` of an arbitrary node module.
//
// Refs:
//   - 01-04-PLAN.md Task 2 <action>
//   - CONTEXT.md D-12 (window.api namespace shape)
//   - CONTEXT.md D-14 (preload rebuilds Error subclasses on the renderer)
//   - DATA-02 (contextIsolation + nodeIntegration:false + sandbox:true posture)
//   - threat model T-01-02 (no ipcRenderer leak via contextBridge)

import { contextBridge, ipcRenderer } from 'electron'
import type {
  ElectronApi,
  Project,
  TimeEntry,
  Timer,
  TickEventPayload,
  ResumeResultDto,
  SettingKey,
  SettingValue,
} from '@shared/ipc'
import { reviveError } from '@shared/errors'

/**
 * Single chokepoint for all renderer→main IPC. Catches rejected promises and
 * runs reviveError on the rejection reason before re-throwing — so the
 * renderer's `catch` sees a real ValidationError / NotFoundError /
 * InvariantError instance (per CONTEXT.md D-14 refinement).
 *
 * Generic `T` parameter is the expected resolved-value type; callers cast
 * the ElectronApi method signature drives the constraint at the call site.
 */
async function invokeWrapped<T>(
  channel: string,
  ...args: unknown[]
): Promise<T> {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T
  } catch (e) {
    throw reviveError(e)
  }
}

/**
 * Phase-1-not-implemented placeholder factory. Returns a function that
 * immediately rejects with a clear "not implemented" message. We do NOT
 * return `undefined` (that would be a `is not a function` TypeError at the
 * call site, less useful in dev mode); we do NOT silently no-op (that
 * could mask real bugs).
 *
 * Phase 2+ replaces these with real `invokeWrapped(channel, args)` calls
 * once the matching ipcMain.handle registrations exist.
 */
function notImpl(method: string): (...args: unknown[]) => Promise<never> {
  return () => Promise.reject(new Error(`${method} not implemented in Phase 1`))
}

// Explicit method enumeration. Every method on the ElectronApi interface
// must appear here. The `as ElectronApi` cast at the bottom is the
// compile-time guard that catches missing methods.
//
// NAMING: every channel string here MUST match the literal channel passed
// to `ipcMain.handle(...)` in src/main/ipc/*.ts. Mismatch → "No handler
// registered for <channel>" at invoke time.
const api: ElectronApi = {
  system: {
    // Match src/shared/contracts/system.ts: EchoArgsSchema expects `{ message }`.
    echo: (message: string) => invokeWrapped('system.echo', { message }),
    // DbSmokeArgsSchema is `z.object({}).optional()`; pass {} for clarity.
    dbSmoke: () => invokeWrapped('system.dbSmoke', {}),
    // 03-CONTEXT D-07 — close-button IPC bridge. Plan 03-04 registers the
    // ipcMain.handle('system.closeWindow', handleCloseWindow) endpoint;
    // CloseWindowArgsSchema is z.object({}).optional() so {} parses cleanly.
    closeWindow: () => invokeWrapped<void>('system.closeWindow', {}),
    // Clipboard copy via main (renderer navigator.clipboard is unavailable in
    // the packaged file:// context). CopyToClipboardArgsSchema expects { text }.
    copyToClipboard: (text: string) =>
      invokeWrapped<void>('system.copyToClipboard', { text }),
  },
  // The remaining namespaces are declared so the renderer's type system
  // sees the full surface, but their methods reject — Phase 2+ wires them.
  // Each `as unknown as ElectronApi['xxx']['yyy']` cast is the price of
  // returning a polymorphic-rejection function for a method whose declared
  // signature returns a specific shape (e.g., `Promise<Timer[]>`); the
  // promise is rejected before that shape is ever observed.
  // Phase 4 (Plan 04-05 / D-16) — wired. Channel strings MUST match the
  // `ipcMain.handle('timers.*', ...)` registrations in
  // `src/main/ipc/timers.ts` character-for-character — Electron throws
  // "No handler registered for X" on a typo (T-01-03 channel whitelist).
  // Args objects MUST match the matching Zod schema in
  // `src/shared/contracts/timers.ts` (D-16 / D-28 service-bypass exception).
  //
  // NOTE: `delete(id: number)` takes a BARE number per the TimersApi interface,
  // but the IPC boundary requires an object envelope for Zod validation with
  // IdArgsSchema ({ id: number }). The bridge wraps the bare number into { id }.
  // (T-01-03 + D-16 channel-name-literal contract.)
  timers: {
    list: (dateRange?: { fromEpoch: number; toEpoch: number }) =>
      invokeWrapped<Timer[]>('timers.list', { dateRange }),
    create: (args: { projectId: number | null; description: string }) =>
      invokeWrapped<Timer>('timers.create', args),
    // wrap bare number into { id } to satisfy IdArgsSchema at the Zod gate
    delete: (id: number) =>
      invokeWrapped<void>('timers.delete', { id }),
    setDescription: (id: number, description: string) =>
      invokeWrapped<void>('timers.setDescription', { id, description }),
    setProject: (id: number, projectId: number | null) =>
      invokeWrapped<void>('timers.setProject', { id, projectId }),
    setOffset: (id: number, offsetSeconds: number | null) =>
      invokeWrapped<void>('timers.setOffset', { id, offsetSeconds }),
    setNotes: (id: number, notes: string) =>
      invokeWrapped<void>('timers.setNotes', { id, notes }),
  },
  // Phase 5 (Plan 05-01 / D-28): real projects.* bridges replacing notImpl stubs.
  // Channel literals MUST match `ipcMain.handle('projects.*', ...)` in
  // `src/main/ipc/projects.ts` character-for-character (T-5-05 / T-01-03).
  // Args objects match CreateArgsSchema / UpdateNumberArgsSchema from
  // `src/shared/contracts/projects.ts` (D-16 + T-5-02 Zod boundary).
  projects: {
    list: () =>
      invokeWrapped<Project[]>('projects.list', {}),
    create: (name: string, number: string | null) =>
      invokeWrapped<Project>('projects.create', { name, number }),
    updateNumber: (id: number, number: string | null) =>
      invokeWrapped<void>('projects.updateNumber', { id, number }),
  },
  // Phase 2 (Plan 02-05) — wired. Channel strings MUST match the
  // `ipcMain.handle('timeEntries.*', ...)` registrations in
  // `src/main/ipc/timeEntries.ts` character-for-character — Electron throws
  // "No handler registered for X" on a typo (T-01-03 channel whitelist).
  // Args objects MUST match the matching Zod schema in
  // `src/shared/contracts/timeEntries.ts` (D-15).
  // Phase 5 (Plan 05-02 / D-09): +setStart/setEnd timestamp edit bridges.
  timeEntries: {
    start: (timerId: number) =>
      invokeWrapped<TimeEntry>('timeEntries.start', { timerId }),
    stop: (timerId: number) =>
      invokeWrapped<TimeEntry | null>('timeEntries.stop', { timerId }),
    stopActive: () =>
      invokeWrapped<TimeEntry | null>('timeEntries.stopActive', {}),
    listByTimer: (timerId: number) =>
      invokeWrapped<TimeEntry[]>('timeEntries.listByTimer', { timerId }),
    getRunning: () =>
      invokeWrapped<TimeEntry | null>('timeEntries.getRunning', {}),
    // Boot-time crash-resume classification (D-16) — first call returns the
    // cache populated by runMain()'s `timerService.checkResume()`; subsequent
    // calls re-query via `getCachedResumeResult()` (D-15).
    checkResume: () =>
      invokeWrapped<ResumeResultDto | null>('timeEntries.checkResume', {}),
    // Phase 5 D-09: timestamp edit bridges (T-5-01/T-5-06/T-5-08/T-5-09).
    // Channel literals match `ipcMain.handle('timeEntries.set...', ...)` exactly.
    setStart: (entryId: number, ts: number) =>
      invokeWrapped<void>('timeEntries.setStart', { entryId, ts }),
    setEnd: (entryId: number, ts: number) =>
      invokeWrapped<void>('timeEntries.setEnd', { entryId, ts }),
  },
  // Phase 3 (Plan 03-03) — wired. Channel strings MUST match the
  // `ipcMain.handle('settings.*', ...)` registrations in
  // `src/main/ipc/settings.ts` character-for-character (T-01-03 channel
  // whitelist). Args objects MUST match the matching Zod schema in
  // `src/shared/contracts/settings.ts` — `GetArgsSchema` for get,
  // `SetArgsSchema` (discriminatedUnion('key', [...])) for set, and
  // `ListArgsSchema` (z.object({}).optional()) for list (D-21 + D-15).
  settings: {
    get: <K extends SettingKey>(key: K) =>
      invokeWrapped<SettingValue<K>>('settings.get', { key }),
    // The `as unknown` cast bridges the inferred `{ key: K, value: SettingValue<K> }`
    // object literal to the discriminatedUnion's runtime shape — TS cannot
    // infer that the tuple is one of the 6 branches without the cast, but
    // the Zod schema validates the shape at the boundary regardless.
    set: <K extends SettingKey>(key: K, value: SettingValue<K>) =>
      invokeWrapped<void>(
        'settings.set',
        { key, value } as unknown,
      ),
    list: () =>
      invokeWrapped<Record<SettingKey, unknown>>('settings.list', {}),
  },
  // Phase 4 (Plan 04-05 / D-07 / D-08) — one-way push channel from main→renderer.
  //
  // The 'tick:update' channel uses colon convention (D-07) because it is NOT
  // an ipcMain.handle channel — main emits via webContents.send; there is no
  // ipcMain.handle registered. The preload bridge wraps ipcRenderer.on in a
  // subscribe function that RETURNS the unsubscribe cleanup (D-08 / RESEARCH §
  // Pitfall 1 — mandatory shape for React useEffect cleanup).
  //
  // T-04-08 mitigation: the cleanup-returning subscribe prevents listener leaks
  // on HMR or component unmount — the TickBridge component (plan 04-06) calls
  // the returned unsubscribe function in its useEffect cleanup. The preload
  // test asserts that removeListener is called with the SAME listener reference
  // that was passed to ipcRenderer.on (not a newly-created function), confirming
  // the closure captures the listener variable correctly.
  tick: {
    /**
     * Subscribe to `tick:update` events from the main process. Called once per
     * running timer interval tick (1 s cadence, D-06). The callback receives
     * `{ timerId, elapsedSeconds }` — only `DurationCell` reads this so only
     * that one cell re-renders per second (A-13 invariant from 04-CONTEXT).
     *
     * RETURNS the unsubscribe function — idiomatic for React useEffect:
     *   `useEffect(() => window.api.tick.subscribe(cb), [])`
     * Cleanup-returning shape mandated by RESEARCH § Pitfall 1.
     *
     * D-07: channel literal is `'tick:update'` (colon, not dot — one-way event,
     * no ipcMain.handle counterpart). MUST match the `webContents.send('tick:update',
     * ...)` call in `src/main/services/tick.ts` character-for-character.
     */
    subscribe: (cb: (payload: TickEventPayload) => void): (() => void) => {
      // Capture listener reference in closure so the SAME function reference
      // is passed to both ipcRenderer.on and ipcRenderer.removeListener.
      // T-04-08: using a new lambda in removeListener would fail to unsubscribe
      // (ipcRenderer.removeListener matches by reference, not by structural equality).
      const listener = (
        _evt: Electron.IpcRendererEvent,
        payload: TickEventPayload,
      ) => cb(payload)
      ipcRenderer.on('tick:update', listener)
      // Return cleanup — called by TickBridge's useEffect cleanup on unmount.
      return () => {
        ipcRenderer.removeListener('tick:update', listener)
      }
    },
  },
  // Phase 5 UAT follow-up: separate timestamp-editor window.
  //   - open: invoke 'editor.open' (Zod-gated { timerId }); main opens/focuses the window.
  //   - notifyChanged: one-way send from the editor window after a persisted edit.
  //   - onDataChanged: subscribe to the main→window 'timerz:data-changed' broadcast;
  //     returns the unsubscribe cleanup (same reference-stable shape as tick.subscribe).
  editor: {
    open: (timerId: number) => invokeWrapped<void>('editor.open', { timerId }),
    notifyChanged: (): void => ipcRenderer.send('editor.notify-changed'),
    onDataChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('timerz:data-changed', listener)
      return () => {
        ipcRenderer.removeListener('timerz:data-changed', listener)
      }
    },
  },
}

// Literal channel name 'api' — matches the renderer's `window.api` reference
// declared in src/renderer/src/env.d.ts. NEVER expose `ipcRenderer` directly
// or under any alias — that would defeat context isolation (T-01-02).
contextBridge.exposeInMainWorld('api', api)
