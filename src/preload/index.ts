// Preload script — exposes a typed `window.api` to the renderer via Electron's
// `contextBridge`. Runs in an isolated context with no node integration and the
// v8 sandbox enabled.
//
// EXPLICIT METHOD ENUMERATION over Proxy stubs: contextBridge clones proxies in
// ways that drop traps under sandbox+contextIsolation. We enumerate every method
// on every namespace by name; the verbosity is the price for predictable behaviour.
//
// ERROR REVIVAL: every ipcRenderer.invoke is wrapped in `invokeWrapped` which
// catches rejections and runs `reviveError`. [VALIDATION] / [NOT_FOUND] /
// [INVARIANT] prefixed errors thrown from main handlers rebuild as their typed
// subclass on the renderer side — so React code can use
// `try { … } catch (e) { if (e instanceof ValidationError) … }` normally.
//
// SANDBOX CONSTRAINTS: under sandbox:true, preload may only require a subset of
// electron (contextBridge + ipcRenderer). `@shared/errors` is bundled INTO the
// preload bundle by electron-vite — no runtime `require` of an arbitrary module.

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
 * InvariantError instance.
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
 * Not-implemented placeholder factory. Returns a function that immediately
 * rejects with a clear "not implemented" message rather than `undefined` (which
 * would produce an unhelpful `is not a function` TypeError at the call site).
 */
function notImpl(method: string): (...args: unknown[]) => Promise<never> {
  return () => Promise.reject(new Error(`${method} not implemented`))
}

// Explicit method enumeration. Every method on the ElectronApi interface must
// appear here. Channel strings MUST match the literal channel passed to
// `ipcMain.handle(...)` — a mismatch throws "No handler registered for X".
const api: ElectronApi = {
  system: {
    echo: (message: string) => invokeWrapped('system.echo', { message }),
    dbSmoke: () => invokeWrapped('system.dbSmoke', {}),
    // Close-button IPC bridge. CloseWindowArgsSchema is z.object({}).optional().
    closeWindow: () => invokeWrapped<void>('system.closeWindow', {}),
    // Clipboard copy via main — renderer navigator.clipboard is unavailable in
    // the packaged file:// context.
    copyToClipboard: (text: string) =>
      invokeWrapped<void>('system.copyToClipboard', { text }),
  },
  // NOTE: `delete(id: number)` takes a BARE number per the TimersApi interface,
  // but the IPC boundary requires an object envelope for Zod validation.
  // The bridge wraps the bare number into { id }.
  timers: {
    list: (dateRange?: { fromEpoch: number; toEpoch: number }) =>
      invokeWrapped<Timer[]>('timers.list', { dateRange }),
    create: (args: { projectId: number | null; description: string }) =>
      invokeWrapped<Timer>('timers.create', args),
    // wrap bare number into { id } to satisfy IdArgsSchema
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
  projects: {
    list: () =>
      invokeWrapped<Project[]>('projects.list', {}),
    create: (name: string, number: string | null) =>
      invokeWrapped<Project>('projects.create', { name, number }),
    updateNumber: (id: number, number: string | null) =>
      invokeWrapped<void>('projects.updateNumber', { id, number }),
  },
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
    // First call returns the cache populated by runMain()'s `timerService.checkResume()`.
    checkResume: () =>
      invokeWrapped<ResumeResultDto | null>('timeEntries.checkResume', {}),
    setStart: (entryId: number, ts: number) =>
      invokeWrapped<void>('timeEntries.setStart', { entryId, ts }),
    setEnd: (entryId: number, ts: number) =>
      invokeWrapped<void>('timeEntries.setEnd', { entryId, ts }),
    deleteEntry: (entryId: number) =>
      invokeWrapped<void>('timeEntries.deleteEntry', { entryId }),
  },
  settings: {
    get: <K extends SettingKey>(key: K) =>
      invokeWrapped<SettingValue<K>>('settings.get', { key }),
    // `as unknown` cast: TS cannot infer the inferred object literal is one of
    // the discriminatedUnion branches without it; Zod validates at the boundary.
    set: <K extends SettingKey>(key: K, value: SettingValue<K>) =>
      invokeWrapped<void>(
        'settings.set',
        { key, value } as unknown,
      ),
    list: () =>
      invokeWrapped<Record<SettingKey, unknown>>('settings.list', {}),
  },
  // One-way push channel from main→renderer. 'tick:update' uses colon convention
  // because it is NOT an ipcMain.handle channel — main emits via webContents.send.
  // The subscribe function RETURNS the unsubscribe cleanup for React useEffect.
  tick: {
    /**
     * Subscribe to `tick:update` events from the main process (1 s cadence).
     * Callback receives `{ timerId, elapsedSeconds }` — only `DurationCell`
     * reads this so only that one cell re-renders per second.
     *
     * RETURNS the unsubscribe function — idiomatic for React useEffect:
     *   `useEffect(() => window.api.tick.subscribe(cb), [])`
     *
     * Channel literal `'tick:update'` MUST match the `webContents.send('tick:update', ...)`
     * call in `src/main/services/tick.ts` character-for-character.
     */
    subscribe: (cb: (payload: TickEventPayload) => void): (() => void) => {
      // Capture listener in closure so the SAME reference is passed to both
      // ipcRenderer.on and removeListener — removeListener matches by reference.
      const listener = (
        _evt: Electron.IpcRendererEvent,
        payload: TickEventPayload,
      ) => cb(payload)
      ipcRenderer.on('tick:update', listener)
      return () => {
        ipcRenderer.removeListener('tick:update', listener)
      }
    },
  },
  // Separate timestamp-editor window bridge. onDataChanged subscribes to the
  // main→window 'timerz:data-changed' broadcast; returns the unsubscribe cleanup.
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

// Channel name 'api' matches the renderer's `window.api` reference. NEVER
// expose `ipcRenderer` directly — that would defeat context isolation.
contextBridge.exposeInMainWorld('api', api)
