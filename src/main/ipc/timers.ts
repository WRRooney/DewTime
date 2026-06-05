// src/main/ipc/timers.ts
// IPC handlers for the `timers.*` namespace. Seven handlers for CRUD operations
// on the timers table. The renderer reaches these via `window.api.timers.{list,
// create, delete, setDescription, setProject, setOffset, setNotes}` — the
// preload bridge in `src/preload/index.ts` calls `ipcRenderer.invoke` with the
// literal dotted channel strings registered below.
//
// D-28 SERVICE-BYPASS EXCEPTION (documented intentional bypass):
//   Phase 2's TIME-07 / threat-model T-02-03 mandates that every IPC handler
//   route state-changing work through a `services/*` module so the canonical
//   FSM transaction (`db.transaction(fn)`) wraps the write. This namespace is
//   a pure CRUD layer over the `timers` table — there is no FSM semantics for
//   list/create/setDescription/setProject/setOffset/setNotes. The same
//   service-bypass exception that Phase 3 `settings.ts` documents (D-28) applies
//   here for those 6 handlers.
//
//   The ONE exception within this file is `handleDelete`. Deleting a timer when
//   it is currently running would leave the in-memory running-entry cache and the
//   1-second tick interval referencing a row that no longer exists in the DB.
//   D-17 mandates: `timers.delete` delegates to `timerService.deleteTimer(id)`
//   which wraps `stopActive() + timersRepo.deleteTimer(id)` in `db.transaction`
//   so the FSM cache + tick interval stay consistent. This is the LONE handler
//   in this file that reaches into `@main/services`.
//
//   Static gate: `grep -c "D-28\|service-bypass" src/main/ipc/timers.ts` ≥ 1
//   (asserted in the plan's verification block to prevent documentation drift).
//   A companion gate: `grep -cE "from '@main/services'|from '\\.\\./services'"
//   src/main/ipc/timers.ts` MUST return ≤ 2 (only `timerService` for
//   `handleDelete`; no heartbeat or tick imports).
//
// ZOD AT THE BOUNDARY (D-15 carry-forward + D-16):
//   Every handler runs `<Schema>.safeParse(args)` via the shared `handler()`
//   factory from `./system`. On parse failure the factory throws `ValidationError`
//   whose `.message` is `[VALIDATION] ...` — the prefix preload's `reviveError`
//   matches against to rebuild the typed subclass on the renderer side (D-14).
//   T-04-02 mitigation: SetDescriptionArgsSchema.max(1000) and
//   SetNotesArgsSchema.max(10_000) cap payloads at the boundary; rejected
//   before any DB write reaches the repository.
//
// CHANNEL NAMES (D-16 + T-01-03):
//   Dotted strings — `ipcMain.handle('timers.list', ...)` must match the
//   `invokeWrapped('timers.list', ...)` literal in `src/preload/index.ts`
//   character-for-character. Mismatch → "No handler registered for X" at
//   invoke time (T-01-03 channel whitelist via registration, not a runtime
//   check). Every channel literal appears at least twice in this file: once
//   in the handler factory call and once in `registerTimersHandlers`.
//
// Refs:
//   - 04-05-PLAN.md Task 1 <action>
//   - 04-CONTEXT.md D-16 (7 timers.* channels), D-17 (handleDelete → service),
//     D-18 (create returns fresh row), D-21 (dateRange ignored in Phase 4)
//   - 04-CONTEXT.md D-28 (service-bypass exception for pure CRUD handlers)
//   - 04-RESEARCH.md § Pattern 6 (lines 783-848 — canonical template)
//   - src/main/ipc/timeEntries.ts (handler factory shape — Phase 2 analog)
//   - src/main/ipc/settings.ts (service-bypass header doctrine — Phase 3 analog)
//   - src/main/ipc/system.ts (the canonical `handler<I, O>` factory)
//   - threat model T-04-02 (DoS: oversized payload → Zod cap before DB write)
//   - threat model T-04-04 (delete running timer → service-mediated guard)
//   - threat model T-04-Channels (channel whitelist enforced here via enumeration)

import { ipcMain } from 'electron'
import * as timersRepo from '@main/db/repositories/timers'
// D-17 / T-04-04: timerService.deleteTimer is the ONLY service import. It wraps
// stopActive + repo.deleteTimer in db.transaction so deleting a running timer
// doesn't leave the FSM cache + tick interval in an inconsistent state.
import * as timerService from '@main/services/timer'
import { handler } from './system'
import type { EpochSeconds } from '@shared/time'
import {
  ListArgsSchema,
  CreateArgsSchema,
  IdArgsSchema,
  SetDescriptionArgsSchema,
  SetProjectArgsSchema,
  SetOffsetArgsSchema,
  SetNotesArgsSchema,
} from '@shared/contracts/timers'

/**
 * `timers.list(dateRange?)` — return timers ordered by created_at DESC, each
 * with computed `totalSeconds` and `running` fields (D-10 / D-20).
 *
 * Phase 6 wires the WHERE clause via `timersRepo.list(args.dateRange)`.
 * When `dateRange` is provided, only timers with `created_at` in the
 * half-open range [fromEpoch, toEpoch) are returned (DATE-05 / DATE-06).
 * When absent, ALL timers are returned (unfiltered path — Phase 4 parity).
 *
 * `ListArgsSchema` (pre-existing) validates both epoch values as integers
 * bounded 1_700_000_000..1_999_999_999 before the handler runs (T-6-01).
 * SQL injection is impossible — `filteredList` uses `?` bound parameters
 * only (T-6-02).
 *
 * D-28 SERVICE-BYPASS: delegates directly to `timersRepo.list(args.dateRange)`.
 * Pure read; no FSM semantics; no transaction needed.
 */
export const handleList = handler(ListArgsSchema, async (args) =>
  // dateRange is Zod-validated (integer epoch bounds) at this boundary — sanctioned
  // `as EpochSeconds` cast (see @shared/time), mirroring the timeEntries.* setters.
  timersRepo.list(
    args.dateRange as { fromEpoch: EpochSeconds; toEpoch: EpochSeconds } | undefined,
  ),
)

/**
 * `timers.create({ projectId, description })` — insert a new timer row and
 * return the freshly-inserted `Timer` (post-insert `byId` read — D-18). Phase 4
 * always calls with `{ projectId: null, description: '' }` — project assignment
 * is Phase 5.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `timersRepo.create(args)`. Pure
 * insert; no FSM semantics.
 */
export const handleCreate = handler(CreateArgsSchema, async (args) =>
  timersRepo.create(args),
)

/**
 * `timers.delete(id)` — delete the timer and all its time entries (ON DELETE
 * CASCADE — 001_initial.sql). If the deleted timer is currently running, the
 * running entry must be stopped FIRST so the FSM cache + tick interval are
 * consistent after the DELETE.
 *
 * D-17 / T-04-04: delegates to `timerService.deleteTimer(id)` which wraps
 * `stopActive() + timersRepo.deleteTimer(id)` in `db.transaction(fn)` — the
 * LONE handler in this file that uses a service module. All other handlers
 * call `timersRepo.*` directly (D-28 exception).
 *
 * Args are `{ id }` (IdArgsSchema envelope). The preload bridge wraps the
 * bare `delete(id: number)` API call into `{ id }` before passing to this
 * handler so Zod can validate the shape (channel-name-literal contract T-01-03).
 */
export const handleDelete = handler(IdArgsSchema, async ({ id }) =>
  timerService.deleteTimer(id),
)

/**
 * `timers.setDescription(id, description)` — update the description column.
 * Throws `NotFoundError` (prefix `[NOT_FOUND]`) if no timer with `id` exists.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `timersRepo.setDescription`.
 * T-04-02: `SetDescriptionArgsSchema.max(1000)` caps at the Zod boundary.
 */
export const handleSetDescription = handler(
  SetDescriptionArgsSchema,
  async ({ id, description }) => timersRepo.setDescription(id, description),
)

/**
 * `timers.setProject(id, projectId)` — update the project_id FK. Pass `null`
 * to disassociate. Throws `NotFoundError` if no timer with `id` exists.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `timersRepo.setProject`.
 */
export const handleSetProject = handler(
  SetProjectArgsSchema,
  async ({ id, projectId }) => timersRepo.setProject(id, projectId),
)

/**
 * `timers.setOffset(id, offsetSeconds)` — update the persistent duration offset
 * column (seconds). Pass `null` to clear (semantically 0 s). Negative offsets
 * are allowed (v1 parity). Throws `NotFoundError` if no timer with `id` exists.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `timersRepo.setOffset`.
 */
export const handleSetOffset = handler(
  SetOffsetArgsSchema,
  async ({ id, offsetSeconds }) => timersRepo.setOffset(id, offsetSeconds),
)

/**
 * `timers.setNotes(id, notes)` — update the free-form notes column.
 * Throws `NotFoundError` if no timer with `id` exists.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `timersRepo.setNotes`.
 * T-04-02: `SetNotesArgsSchema.max(10_000)` caps at the Zod boundary.
 */
export const handleSetNotes = handler(
  SetNotesArgsSchema,
  async ({ id, notes }) => timersRepo.setNotes(id, notes),
)

/**
 * Register the `timers.*` IPC channels with `ipcMain`. Called from
 * `registerAllHandlers()` in `./index.ts` AFTER `initDb()` + `runMigrations()`
 * have completed (the timers table must exist before any call lands).
 *
 * Channel names are the literal dotted strings — they must match the strings
 * passed to `invokeWrapped(...)` in `src/preload/index.ts` character-for-
 * character (T-01-03 channel whitelist via registration; Electron throws
 * "No handler registered for X" on a typo).
 *
 * The `_evt` parameter (Electron's IpcMainInvokeEvent) is intentionally
 * unused — handler bodies must not depend on which renderer made the call
 * (single-window assumption inherited from Phase 1).
 *
 * @param ipc — injectable for tests; defaults to the real `ipcMain`.
 */
export function registerTimersHandlers(
  ipc: typeof ipcMain = ipcMain,
): void {
  ipc.handle('timers.list',           (_evt, args) => handleList(args))
  ipc.handle('timers.create',         (_evt, args) => handleCreate(args))
  ipc.handle('timers.delete',         (_evt, args) => handleDelete(args))
  ipc.handle('timers.setDescription', (_evt, args) => handleSetDescription(args))
  ipc.handle('timers.setProject',     (_evt, args) => handleSetProject(args))
  ipc.handle('timers.setOffset',      (_evt, args) => handleSetOffset(args))
  ipc.handle('timers.setNotes',       (_evt, args) => handleSetNotes(args))
}
