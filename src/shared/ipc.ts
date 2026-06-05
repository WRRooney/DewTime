// src/shared/ipc.ts
// The FULL v1 IPC surface declared as TypeScript types. Phase 1 IMPLEMENTS
// only the `system.*` handlers (see plan 04). Later phases just add handlers
// against these interfaces — they never need to revisit the contract shape.
//
// Refs:
//   - CONTEXT.md D-12 (namespaced typed API)
//   - CONTEXT.md D-13 (dotted channel names: namespace.method)
//   - CONTEXT.md D-14 + src/shared/errors.ts (handlers throw subclasses; preload revives)
//   - RESEARCH.md §4 lines ~684-751 (literal interface declarations)
//   - timerz/db/models.py (v1 column names — row types mirror exactly)
//   - timerz/services/settings_service.py (v1 SettingsService DEFAULTS — SettingKey union)

import type { EpochSeconds } from './time'

// ---------------------------------------------------------------------------
// Row types — mirror v1 schema (timerz/db/models.py)
// Column names match exactly so JSON.stringify of a SQLite row deserialises
// straight into these shapes (better-sqlite3 returns plain objects).
// ---------------------------------------------------------------------------

/** Mirrors v1 `projects` table: id PK + project_number (nullable) + project_name. */
export interface Project {
  id: number
  project_number: string | null
  project_name: string
}

/**
 * Mirrors v1 `timers` table. `created_at` is epoch seconds (v1 stored
 * `int(time.time())` — DATA-04). `offset` is a persistent duration offset
 * in seconds (`null` = 0); survives app restart.
 *
 * Phase 4 additions (purely additive — D-37: no existing handler signature
 * changes; better-sqlite3 returns all columns regardless of interface order):
 */
export interface Timer {
  id: number
  project_id: number | null
  description: string
  notes: string
  created_at: EpochSeconds
  offset: number | null
  /**
   * Computed read-only total elapsed seconds across all completed entries for
   * this timer plus `offset`. Populated by the `timers.list()` SQL LEFT JOIN
   * in plan 04-03. Never stored. D-10 / D-20 / D-37.
   */
  totalSeconds: number
  /**
   * `true` iff this timer has a `time_entries` row with `end_timestamp IS NULL`
   * (i.e. a currently-running entry). Populated by plan 04-03's LEFT JOIN.
   * Allows `StartStopCell` to derive isRunning without subscribing to
   * `useTickStore` — keeps A-13 invariant absolute (only DurationCell touches
   * tick). UI-SPEC § StartStopCell Option B (D-26).
   */
  running: boolean
}

/**
 * Mirrors v1 `time_entries` table. A row with `end_timestamp = null` is a
 * RUNNING entry; the single-active-timer invariant (Phase 2's TimerService
 * FSM) enforces at most one such row per database.
 */
export interface TimeEntry {
  id: number
  timer_id: number
  start_timestamp: EpochSeconds
  end_timestamp: EpochSeconds | null
}

/**
 * Renderer-facing analog of the main process's `ResumeResult` (defined inside
 * `src/main/services/timer.ts` — Plan 02-02). The same shape is mirrored here
 * so the renderer can name the type without importing from `@main` (which is
 * not in the renderer's path-alias graph). `null` when no running entry exists
 * at boot — the most common case.
 *
 * - `entry`            — the still-running TimeEntry detected at boot.
 * - `isCleanResume`    — `true` when the last heartbeat is fresh (< 300 s old);
 *                        `false` when stale (≥ 300 s) → crash-suspect.
 * - `suspectedEnd`     — for crash-suspect, the heartbeat's `last_beat`, or
 *                        the entry's `start_timestamp` when no heartbeat row
 *                        exists yet (per 02-CONTEXT.md D-13). `null` on clean
 *                        resume.
 *
 * Refs:
 *   - 02-CONTEXT.md D-11 (ResumeResult shape) + D-16 (named DTO on the bus)
 *   - 02-05-PLAN.md Task 1 (renderer-side mirror of services/timer.ts's
 *     `ResumeResult` so React code can `import type { ResumeResultDto } from
 *     '@shared/ipc'`)
 */
export interface ResumeResultDto {
  entry: TimeEntry
  isCleanResume: boolean
  suspectedEnd: EpochSeconds | null
}

// ---------------------------------------------------------------------------
// Settings keys + per-key value types
// Keys mirror the v1 SettingsService DEFAULTS dict (timerz/services/settings_service.py
// lines 12-18) — except dots replace slashes (SQLite column constraint convenience).
// Window geometry lives under a SINGLE composite JSON key
// `settings.window_geometry` (03-CONTEXT D-09) — the Phase 1 legacy
// four-scalar window.x|y|width|height stubs are gone (they were declared in
// 001_initial.sql's comment but never seeded; plan 03-01 deleted them from
// the contract before any code consumed them).
// ---------------------------------------------------------------------------

/**
 * Composite window geometry value (03-CONTEXT D-09). Stored as a single
 * JSON-encoded row under the `settings.window_geometry` key. `x`/`y` are
 * nullable to encode the "center on first launch" sentinel — main reads the
 * row at boot (D-11) and, when both are null, omits the position so Electron
 * centers the window. `width`/`height` are always positive integers; the
 * default seed in 002_window_geometry.sql is 800x600.
 */
export interface WindowGeometry {
  x: number | null
  y: number | null
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Tick channel — one-way main→renderer push (D-06..D-09)
// Channel name literal: 'tick:update' (colon convention for one-way events,
// D-07). NOT under the `timers.*` dotted namespace because there is no
// ipcMain.handle — main emits via webContents.send; preload wraps
// ipcRenderer.on in the TickApi subscribe bridge (D-08).
// ---------------------------------------------------------------------------

/**
 * Payload emitted on the `'tick:update'` channel every second while a timer
 * is running. D-07: `timerId` identifies which timer is ticking;
 * `elapsedSeconds` is `Math.max(0, nowSeconds() - entry.start_timestamp)` as
 * computed by `src/main/services/tick.ts` (plan 04-04).
 */
export interface TickEventPayload {
  timerId: number
  elapsedSeconds: number
}

/**
 * Preload-side bridge for the one-way `'tick:update'` channel (D-07 / D-08).
 * `subscribe` wraps `ipcRenderer.on`; the returned function is the unsubscribe
 * cleanup — idiomatic for `useEffect(() => api.tick.subscribe(cb), [])`.
 * Cleanup-returning shape mandated by RESEARCH § Pitfall 1.
 */
export interface TickApi {
  /**
   * Subscribe to tick:update events. RETURNS the unsubscribe function
   * (idiomatic for `useEffect(() => api.tick.subscribe(cb), [])`).
   * Cleanup-returning shape mandated by RESEARCH § Pitfall 1.
   */
  subscribe(cb: (payload: TickEventPayload) => void): () => void
}

/**
 * Preload bridge for the separate timestamp-editor window (Phase 5 UAT follow-up).
 *   - open: ask main to open/focus the editor window for a timer.
 *   - notifyChanged: editor window → main, fire-and-forget, after a persisted edit.
 *   - onDataChanged: main → window broadcast subscription; RETURNS the unsubscribe
 *     cleanup (same cleanup-returning shape as TickApi.subscribe).
 */
export interface EditorApi {
  open(timerId: number): Promise<void>
  notifyChanged(): void
  onDataChanged(cb: () => void): () => void
}

/** All known settings keys. Settings repository (Phase 4) rejects writes with unknown keys. */
export type SettingKey =
  | 'settings.week_start'
  | 'settings.dark_mode'
  | 'settings.auto_pause'
  | 'settings.widget_mode'
  | 'settings.auto_launch'
  // Phase 3 (D-09) — composite JSON key; value type WindowGeometry above.
  | 'settings.window_geometry'

/**
 * Per-key value type. The handler in `src/main/ipc/settings.ts` (plan 03-03)
 * validates the value shape after Zod's `discriminatedUnion('key', [...])`
 * (03-CONTEXT D-21) has confirmed both `key` membership AND per-K value
 * shape. The conditional type below is the renderer-facing source of truth;
 * `SettingsSetArgsSchema` in `contracts/settings.ts` is the runtime gate.
 */
export type SettingValue<K extends SettingKey> = K extends 'settings.week_start'
  ? number
  : K extends 'settings.dark_mode' | 'settings.auto_pause' | 'settings.auto_launch'
    ? boolean
    : K extends 'settings.widget_mode'
      ? 'floating' | 'windowed' | 'tray'
      : K extends 'settings.window_geometry'
        ? WindowGeometry
        : never

// ---------------------------------------------------------------------------
// Per-namespace API interfaces
// Phase 1 IMPLEMENTS only SystemApi (plan 04). The other four are declared
// here so plans 03 + 04 can reference Timer / Project / TimeEntry shapes
// (repositories return them), and so Phase 2+ handlers only need to add
// `ipcMain.handle` calls — never the type shape.
// ---------------------------------------------------------------------------

export interface ProjectsApi {
  list(): Promise<Project[]>
  create(name: string, number: string | null): Promise<Project>
  updateNumber(id: number, number: string | null): Promise<void>
}

export interface TimersApi {
  list(dateRange?: { fromEpoch: EpochSeconds; toEpoch: EpochSeconds }): Promise<Timer[]>
  create(args: { projectId: number | null; description: string }): Promise<Timer>
  delete(id: number): Promise<void>
  setDescription(id: number, description: string): Promise<void>
  setProject(id: number, projectId: number | null): Promise<void>
  setOffset(id: number, offsetSeconds: number | null): Promise<void>
  setNotes(id: number, notes: string): Promise<void>
}

/**
 * `timeEntries.*` IPC namespace. Phase 2 wires all methods to TimerService
 * (`@main/services/timer`) inside `src/main/ipc/timeEntries.ts`. Every state-
 * changing method MUST delegate to the service so the single-active-timer
 * invariant (TIME-03) survives end-to-end (02-CONTEXT.md D-19 + threat model
 * T-02-03).
 *
 * `checkResume()` returns the boot-time cached `ResumeResultDto` on first
 * call (populated by `runMain()`'s `timerService.checkResume()` per
 * 02-CONTEXT.md D-14); subsequent calls re-query via the
 * `getCachedResumeResult()` accessor (D-15). `null` when no running entry
 * existed at boot — the common case.
 */
export interface TimeEntriesApi {
  start(timerId: number): Promise<TimeEntry>
  stop(timerId: number): Promise<TimeEntry | null>
  /** Stops whatever is currently running (no-arg convenience for the active-timer FSM). */
  stopActive(): Promise<TimeEntry | null>
  listByTimer(timerId: number): Promise<TimeEntry[]>
  getRunning(): Promise<TimeEntry | null>
  /**
   * Returns the boot-time crash-resume classification (D-11..D-15). Cached on
   * first call by `services/timer.checkResume()` in `runMain()`; re-queries
   * the DB on subsequent calls. `null` when no running entry existed at boot.
   */
  checkResume(): Promise<ResumeResultDto | null>
  /**
   * D-09: update a stopped entry's start_timestamp.
   * Throws NotFoundError when entryId does not exist (T-5-08).
   * Start is always editable — no running-entry restriction per D-08/Open-Question-2.
   */
  setStart(entryId: number, ts: EpochSeconds): Promise<void>
  /**
   * D-09: update a stopped entry's end_timestamp.
   * Running-entry guard (D-08) and ordering guard (D-09) enforced in the repo.
   * Throws ValidationError when entry is running or end <= start (T-5-01/T-5-06).
   * Throws NotFoundError when entryId does not exist (T-5-08).
   */
  setEnd(entryId: number, ts: EpochSeconds): Promise<void>
}

export interface SettingsApi {
  get<K extends SettingKey>(key: K): Promise<SettingValue<K>>
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void>
  // Renamed from `getAll()` per 03-CONTEXT D-18 — the IPC channel is
  // `settings.list`, not `settings.getAll`. The main-side repo function
  // intentionally keeps its `getAll` name (D-18 + plan 03-01 Task 2 note);
  // plan 03-03's handler maps `settings.list` → `repo.getAll()`.
  list(): Promise<Record<SettingKey, unknown>>
}

/**
 * Phase 1 IMPLEMENTS `echo` + `dbSmoke` (plan 01-04). Phase 3 plan 03-04
 * wires `closeWindow` to a `BrowserWindow.getFocusedWindow()?.close()` call
 * on the main side — never exposes `app.quit()` to the renderer (D-07,
 * too sharp).
 */
export interface SystemApi {
  echo(message: string): Promise<string>
  dbSmoke(): Promise<{ rowCount: number; canRead: boolean }>
  // 03-CONTEXT D-07 — close button → window.api.system.closeWindow() →
  // BrowserWindow.getFocusedWindow()?.close() in main.
  closeWindow(): Promise<void>
  // Copy text to the OS clipboard via Electron's clipboard module (renderer
  // navigator.clipboard is unavailable in the packaged file:// context).
  copyToClipboard(text: string): Promise<void>
}

// ---------------------------------------------------------------------------
// Aggregate — exposed on `window.api` via contextBridge (preload, plan 04)
// ---------------------------------------------------------------------------

export interface ElectronApi {
  timers: TimersApi
  projects: ProjectsApi
  timeEntries: TimeEntriesApi
  settings: SettingsApi
  system: SystemApi
  /** One-way push channel from main → renderer (D-07 / D-08). Preload bridge
   *  wraps `ipcRenderer.on('tick:update', ...)` and returns a cleanup fn. */
  tick: TickApi
  /** Separate timestamp-editor window controls (Phase 5 UAT follow-up). */
  editor: EditorApi
}
