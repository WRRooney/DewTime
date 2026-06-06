// IPC handlers for the `projects.*` namespace. All three handlers delegate
// directly to projectsRepo — pure CRUD, no FSM semantics.
//
// Channel names are dotted strings that must match the strings passed to
// `invokeWrapped(...)` in `src/preload/index.ts` character-for-character.
// Mismatch → "No handler registered for X" at invoke time.

import { ipcMain } from 'electron'
import * as projectsRepo from '@main/db/repositories/projects'
import { handler } from './system'
import {
  ListArgsSchema,
  CreateArgsSchema,
  UpdateNumberArgsSchema,
} from '@shared/contracts/projects'

/** `projects.list()` — return all projects ordered by id ascending. */
export const handleList = handler(ListArgsSchema, async (_args) =>
  projectsRepo.list(),
)

/**
 * `projects.create({ name, number })` — insert a new project row and return the
 * freshly-inserted `Project`. Zod gate: name is min(1)/max(255), number is
 * max(255) or null.
 */
export const handleCreate = handler(
  CreateArgsSchema,
  async ({ name, number }) => projectsRepo.create(name, number),
)

/**
 * `projects.updateNumber({ id, number })` — update only the project_number
 * column. Throws NotFoundError on 0 changes.
 */
export const handleUpdateNumber = handler(
  UpdateNumberArgsSchema,
  async ({ id, number }) => {
    projectsRepo.updateNumber(id, number)
  },
)

/**
 * Register the `projects.*` IPC channels with `ipcMain`.
 *
 * The `_evt` parameter is intentionally unused — handler bodies must not
 * depend on which renderer made the call.
 *
 * @param ipc injectable for tests; defaults to the real `ipcMain`.
 */
export function registerProjectsHandlers(
  ipc: typeof ipcMain = ipcMain,
): void {
  ipc.handle('projects.list', (_evt, args) => handleList(args))
  ipc.handle('projects.create', (_evt, args) => handleCreate(args))
  ipc.handle('projects.updateNumber', (_evt, args) => handleUpdateNumber(args))
}
