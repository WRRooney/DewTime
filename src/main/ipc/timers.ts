// IPC handlers for the `timers.*` namespace. Seven handlers for CRUD on the
// timers table. Six call timersRepo directly (pure CRUD, no FSM semantics).
//
// The lone exception is `handleDelete`: deleting a running timer would leave
// the in-memory running-entry cache and tick interval referencing a deleted row.
// `timers.delete` delegates to `timerService.deleteTimer(id)` which wraps
// `stopActive() + timersRepo.deleteTimer(id)` in `db.transaction`.
//
// Payload limits: SetDescriptionArgsSchema.max(1000) and
// SetNotesArgsSchema.max(10_000) cap payloads at the Zod boundary before any
// DB write.

import { ipcMain } from 'electron'
import * as timersRepo from '@main/db/repositories/timers'
// timerService.deleteTimer is the only service import — it wraps stopActive +
// repo.deleteTimer in db.transaction to keep the FSM cache consistent.
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
 * with computed `totalSeconds` and `running` fields.
 *
 * When `dateRange` is provided, only timers with `created_at` in the
 * half-open range [fromEpoch, toEpoch) are returned. Both epoch values are
 * Zod-validated as bounded integers before the handler runs.
 */
export const handleList = handler(ListArgsSchema, async (args) =>
  // dateRange is Zod-validated at this boundary — `as EpochSeconds` cast is sanctioned.
  timersRepo.list(
    args.dateRange as { fromEpoch: EpochSeconds; toEpoch: EpochSeconds } | undefined,
  ),
)

/**
 * `timers.create({ projectId, description })` — insert a new timer and return
 * the freshly-inserted `Timer` (post-insert `byId` read).
 */
export const handleCreate = handler(CreateArgsSchema, async (args) =>
  timersRepo.create(args),
)

/**
 * `timers.delete(id)` — delete the timer and all its time entries (ON DELETE
 * CASCADE). If the timer is currently running, it must be stopped first so the
 * FSM cache and tick interval stay consistent. Delegates to
 * `timerService.deleteTimer(id)` — the only handler in this file that uses a
 * service module.
 */
export const handleDelete = handler(IdArgsSchema, async ({ id }) =>
  timerService.deleteTimer(id),
)

/**
 * `timers.setDescription(id, description)` — update the description column.
 * Throws `NotFoundError` if no timer with `id` exists. Payload capped at 1000
 * chars by the Zod schema.
 */
export const handleSetDescription = handler(
  SetDescriptionArgsSchema,
  async ({ id, description }) => timersRepo.setDescription(id, description),
)

/**
 * `timers.setProject(id, projectId)` — update the project_id FK. Pass `null`
 * to disassociate. Throws `NotFoundError` if no timer with `id` exists.
 */
export const handleSetProject = handler(
  SetProjectArgsSchema,
  async ({ id, projectId }) => timersRepo.setProject(id, projectId),
)

/**
 * `timers.setOffset(id, offsetSeconds)` — update the persistent duration offset
 * column (seconds). Pass `null` to clear (semantically 0 s). Negative offsets
 * are allowed. Throws `NotFoundError` if no timer with `id` exists.
 */
export const handleSetOffset = handler(
  SetOffsetArgsSchema,
  async ({ id, offsetSeconds }) => timersRepo.setOffset(id, offsetSeconds),
)

/**
 * `timers.setNotes(id, notes)` — update the free-form notes column.
 * Throws `NotFoundError` if no timer with `id` exists. Payload capped at
 * 10 000 chars by the Zod schema.
 */
export const handleSetNotes = handler(
  SetNotesArgsSchema,
  async ({ id, notes }) => timersRepo.setNotes(id, notes),
)

/**
 * Register the `timers.*` IPC channels with `ipcMain`.
 *
 * The `_evt` parameter is intentionally unused — handler bodies must not
 * depend on which renderer made the call.
 *
 * @param ipc injectable for tests; defaults to the real `ipcMain`.
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
