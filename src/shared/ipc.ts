// Full IPC surface declared as TypeScript types. Row types mirror the v1 SQLite
// schema column-for-column so better-sqlite3 plain objects deserialise directly.

import type { EpochSeconds } from './time'
import type { UpdateCheckResult } from './contracts/updates'

// Re-export for renderer use (single source of truth in contracts/updates.ts).
export type { UpdateCheckResult }

// ---------------------------------------------------------------------------
// Row types — column names match the SQLite schema exactly so better-sqlite3
// plain objects deserialise directly into these shapes.
// ---------------------------------------------------------------------------

/** Mirrors v1 `projects` table: id PK + project_number (nullable) + project_name. */
export interface Project {
  id: number
  project_number: string | null
  project_name: string
}

/**
 * Mirrors v1 `timers` table. `created_at` is epoch seconds.
 * `offset` is a persistent duration offset in seconds (`null` = 0).
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
   * this timer plus `offset`. Populated by `timers.list()` SQL LEFT JOIN. Never stored.
   */
  totalSeconds: number
  /**
   * `true` iff this timer has a `time_entries` row with `end_timestamp IS NULL`
   * (currently running). Populated by `timers.list()` LEFT JOIN.
   * Allows `StartStopCell` to derive isRunning without subscribing to
   * `useTickStore` — only `DurationCell` touches the tick channel.
   */
  running: boolean
}

/**
 * Mirrors v1 `time_entries` table. A row with `end_timestamp = null` is a
 * RUNNING entry; the TimerService FSM enforces at most one such row per database.
 */
export interface TimeEntry {
  id: number
  timer_id: number
  start_timestamp: EpochSeconds
  end_timestamp: EpochSeconds | null
}

/**
 * Renderer-facing mirror of the main process's `ResumeResult` (from
 * `src/main/services/timer.ts`). Mirrored here so the renderer can name the
 * type without importing from `@main`. `null` when no running entry exists
 * at boot — the most common case.
 *
 * - `entry`         — the still-running TimeEntry detected at boot.
 * - `isCleanResume` — `true` when the last heartbeat is fresh (< 300 s old);
 *                     `false` when stale (≥ 300 s) → crash-suspect.
 * - `suspectedEnd`  — for crash-suspect, the heartbeat's `last_beat`, or the
 *                     entry's `start_timestamp` when no heartbeat row exists.
 *                     `null` on clean resume.
 */
export interface ResumeResultDto {
  entry: TimeEntry
  isCleanResume: boolean
  suspectedEnd: EpochSeconds | null
}

// ---------------------------------------------------------------------------
// Settings keys + per-key value types
// Keys mirror the v1 SettingsService DEFAULTS — dots replace slashes (SQLite
// column constraint convenience). Window geometry is stored as a single
// composite JSON key `settings.window_geometry`.
// ---------------------------------------------------------------------------

/**
 * Composite window geometry value. Stored as a single JSON-encoded row.
 * `x`/`y` are nullable — null encodes "center on first launch" (Electron
 * centers when position is omitted). `width`/`height` are always positive
 * integers; default seed is 800x600.
 */
export interface WindowGeometry {
  x: number | null
  y: number | null
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Tick channel — one-way main→renderer push
// Channel name: 'tick:update' (colon convention for one-way events — not
// under `timers.*` because there is no ipcMain.handle; main emits via
// webContents.send and preload wraps ipcRenderer.on in the TickApi bridge).
// ---------------------------------------------------------------------------

/**
 * Payload emitted on `'tick:update'` every second while a timer is running.
 * `timerId` identifies which timer is ticking; `elapsedSeconds` is
 * `Math.max(0, nowSeconds() - entry.start_timestamp)` from `services/tick.ts`.
 */
export interface TickEventPayload {
  timerId: number
  elapsedSeconds: number
}

/**
 * Preload-side bridge for the one-way `'tick:update'` channel.
 * `subscribe` wraps `ipcRenderer.on`; the returned function is the unsubscribe
 * cleanup — idiomatic for `useEffect(() => api.tick.subscribe(cb), [])`.
 */
export interface TickApi {
  /** Subscribe to tick:update events. Returns the unsubscribe cleanup function. */
  subscribe(cb: (payload: TickEventPayload) => void): () => void
}

/**
 * Preload bridge for the timestamp-editor window.
 *   - open: ask main to open/focus the editor window for a timer.
 *   - notifyChanged: fire-and-forget from editor → main after a persisted edit.
 *   - onDataChanged: main → window broadcast; returns the unsubscribe cleanup.
 */
export interface EditorApi {
  open(timerId: number): Promise<void>
  notifyChanged(): void
  onDataChanged(cb: () => void): () => void
}

/** All known settings keys. The settings repository rejects writes with unknown keys. */
export type SettingKey =
  | 'settings.week_start'
  | 'settings.dark_mode'
  | 'settings.auto_pause'
  | 'settings.widget_mode'
  | 'settings.auto_launch'
  | 'settings.always_on_top'
  | 'settings.auto_update'
  | 'settings.window_geometry' // composite JSON key; value type WindowGeometry above
  | 'settings.active_tab' // Phase 9 — 'timers' | 'gantt' | 'projects' (D-04)
  | 'settings.gutter_width_pct' // Phase 9 — number in [0, 1] (D-16)

/**
 * Per-key value type. The conditional type here is the renderer-facing source
 * of truth; `SetArgsSchema` in `contracts/settings.ts` is the runtime gate.
 */
export type SettingValue<K extends SettingKey> = K extends 'settings.week_start'
  ? number
  : K extends
        | 'settings.dark_mode'
        | 'settings.auto_pause'
        | 'settings.auto_launch'
        | 'settings.always_on_top'
        | 'settings.auto_update'
    ? boolean
    : K extends 'settings.widget_mode'
      ? 'floating' | 'windowed' | 'tray'
      : K extends 'settings.window_geometry'
        ? WindowGeometry
        : K extends 'settings.active_tab'
          ? 'timers' | 'gantt' | 'projects'
          : K extends 'settings.gutter_width_pct'
            ? number
            : never

// ---------------------------------------------------------------------------
// Per-namespace API interfaces
// ---------------------------------------------------------------------------

export interface ProjectsApi {
  list(): Promise<Project[]>
  create(name: string, number: string | null): Promise<Project>
  updateNumber(id: number, number: string | null): Promise<void>
  updateName(id: number, name: string): Promise<void>
  delete(id: number): Promise<void>
  countTimerRefs(id: number): Promise<number>
  /** Open the projects manager OS window. */
  openManager(): Promise<void>
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
 * `timeEntries.*` IPC namespace. Every state-changing method delegates to
 * `TimerService` so the single-active-timer invariant is enforced end-to-end.
 *
 * `checkResume()` returns the boot-time cached `ResumeResultDto` (populated
 * by `timerService.checkResume()` in `runMain()`). `null` when no running
 * entry existed at boot — the common case.
 */
export interface TimeEntriesApi {
  start(timerId: number): Promise<TimeEntry>
  stop(timerId: number): Promise<TimeEntry | null>
  /** Stops whatever is currently running (no-arg convenience for the active-timer FSM). */
  stopActive(): Promise<TimeEntry | null>
  listByTimer(timerId: number): Promise<TimeEntry[]>
  getRunning(): Promise<TimeEntry | null>
  /**
   * Returns the boot-time crash-resume classification. Cached on first call
   * by `services/timer.checkResume()` in `runMain()`. `null` when no running
   * entry existed at boot.
   */
  checkResume(): Promise<ResumeResultDto | null>
  /**
   * Update a stopped entry's start_timestamp. Throws NotFoundError when
   * entryId does not exist. Start is always editable — no running-entry restriction.
   */
  setStart(entryId: number, ts: EpochSeconds): Promise<void>
  /**
   * Update a stopped entry's end_timestamp. Repo enforces running-entry guard
   * and `end > start` ordering. Throws ValidationError when entry is running
   * or end <= start. Throws NotFoundError when entryId does not exist.
   */
  setEnd(entryId: number, ts: EpochSeconds): Promise<void>
  /**
   * Delete a stopped time entry. Throws ValidationError when the entry is still
   * running, NotFoundError when entryId does not exist.
   */
  deleteEntry(entryId: number): Promise<void>
  /**
   * Return all entries overlapping the epoch range [fromEpoch, toEpoch). Includes
   * running entries whose start is before toEpoch. Results ordered by timer_id ASC,
   * start_timestamp ASC. Zod gate rejects reversed/zero-span ranges (T-09-04).
   */
  listInRange(fromEpoch: EpochSeconds, toEpoch: EpochSeconds): Promise<TimeEntry[]>
  /**
   * Insert a completed (non-running) time entry. endTs is non-nullable — gantt
   * double-click creation never creates a running entry (D-21, D-26, D-27).
   * Zod gate enforces startTs < endTs (T-09-01).
   */
  createEntry(
    timerId: number,
    startTs: EpochSeconds,
    endTs: EpochSeconds,
  ): Promise<TimeEntry>
  /**
   * Atomically update both timestamps for a stopped entry (drag body-move).
   * Repo guards: running entry → ValidationError, startTs >= endTs → ValidationError,
   * missing id → NotFoundError (T-09-01, T-09-06, D-17).
   */
  setTimestamps(
    entryId: number,
    startTs: EpochSeconds,
    endTs: EpochSeconds,
  ): Promise<void>
}

export interface SettingsApi {
  get<K extends SettingKey>(key: K): Promise<SettingValue<K>>
  set<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void>
  // IPC channel is `settings.list`; main-side repo keeps `getAll` name
  // and the handler maps `settings.list` → `repo.getAll()`.
  list(): Promise<Record<SettingKey, unknown>>
}

export interface SystemApi {
  echo(message: string): Promise<string>
  dbSmoke(): Promise<{ rowCount: number; canRead: boolean }>
  // close button → window.api.system.closeWindow() → BrowserWindow.getFocusedWindow()?.close()
  closeWindow(): Promise<void>
  // renderer navigator.clipboard is unavailable in the packaged file:// context
  copyToClipboard(text: string): Promise<void>
  // Returns the running app version string (sources from app.getVersion() in main).
  getVersion(): Promise<string>
  // Opens the GitHub releases page in the default browser. URL is hardcoded in main.
  openReleases(): Promise<void>
}

/**
 * `updates.*` IPC namespace — action/event channel, not a persisted setting.
 * `check()` triggers an on-demand update check (works regardless of auto_update).
 * The native approval dialog is driven entirely by main on the 'available' path.
 */
export interface UpdatesApi {
  check(): Promise<UpdateCheckResult>
}

// ---------------------------------------------------------------------------
// Aggregate — exposed on `window.api` via contextBridge (preload)
// ---------------------------------------------------------------------------

export interface ElectronApi {
  timers: TimersApi
  projects: ProjectsApi
  timeEntries: TimeEntriesApi
  settings: SettingsApi
  system: SystemApi
  /** One-way push channel from main → renderer. Preload bridge wraps
   *  `ipcRenderer.on('tick:update', ...)` and returns a cleanup fn. */
  tick: TickApi
  /** Timestamp-editor window controls. */
  editor: EditorApi
  /** Update action channel — manual check + native approval dialog in main. */
  updates: UpdatesApi
}
