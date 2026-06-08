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
  UpdateNameArgsSchema,
  DeleteProjectArgsSchema,
  CountTimerRefsArgsSchema,
  OpenManagerArgsSchema,
} from '@shared/contracts/projects'
import { openProjectsManagerWindow } from '@main/windows/projectsManagerWindow'

/** `projects.list()` — return all projects ordered by id ascending. */
export const handleList = handler(ListArgsSchema, async (_args) =>
  projectsRepo.list(),
)

/**
 * `projects.create({ name, number })` — insert a new project row and return the
 * freshly-inserted `Project`. Zod gate: name is min(1)/max(255), number is
 * max(255) or null. Rejects duplicate names (ValidationError), symmetrically
 * with updateName.
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
 * `projects.updateName({ id, name })` — rename a project. Rejects duplicate
 * names (ValidationError) and missing ids (NotFoundError).
 */
export const handleUpdateName = handler(
  UpdateNameArgsSchema,
  async ({ id, name }) => {
    projectsRepo.updateName(id, name)
  },
)

/**
 * `projects.delete({ id })` — delete a project. Referencing timers have their
 * project_id set to NULL via FK ON DELETE SET NULL. Throws NotFoundError on 0
 * changes.
 */
export const handleDelete = handler(
  DeleteProjectArgsSchema,
  async ({ id }) => {
    projectsRepo.remove(id)
  },
)

/**
 * `projects.countTimerRefs({ id })` — return how many timers reference a
 * project. Returns 0 for unreferenced or unknown ids.
 */
export const handleCountTimerRefs = handler(
  CountTimerRefsArgsSchema,
  async ({ id }) => projectsRepo.countTimerRefs(id),
)

/**
 * `projects.openManager()` — open/focus the projects manager OS window. No DB
 * work; delegates to the window module (mirrors `editor.open`).
 */
export const handleOpenManager = handler(OpenManagerArgsSchema, async () => {
  openProjectsManagerWindow()
})

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
  ipc.handle('projects.updateName', (_evt, args) => handleUpdateName(args))
  ipc.handle('projects.delete', (_evt, args) => handleDelete(args))
  ipc.handle('projects.countTimerRefs', (_evt, args) => handleCountTimerRefs(args))
  ipc.handle('projects.openManager', (_evt, args) => handleOpenManager(args))
}
