// src/main/ipc/projects.ts
// IPC handlers for the `projects.*` namespace. Three handlers for CRUD
// operations on the projects table. The renderer reaches these via
// `window.api.projects.{list, create, updateNumber}` — the preload bridge
// in `src/preload/index.ts` calls `ipcRenderer.invoke` with the literal
// dotted channel strings registered below.
//
// D-28 SERVICE-BYPASS EXCEPTION (documented intentional bypass):
//   All three handlers delegate directly to projectsRepo.* — pure CRUD,
//   no FSM semantics. Same exception that Phase 3 `settings.ts` documents
//   (D-28) and that timers.ts applies to its 6 non-delete handlers.
//
//   Static gate: `grep -c "D-28\|service-bypass" src/main/ipc/projects.ts` ≥ 1
//
// ZOD AT THE BOUNDARY (D-16 carry-forward):
//   Every handler runs via the shared `handler()` factory from `./system`.
//   On parse failure the factory throws `ValidationError` whose `.message`
//   is `[VALIDATION] ...` — the prefix preload's `reviveError` matches
//   against to rebuild the typed subclass on the renderer side (D-14).
//
// CHANNEL NAMES (D-16 + T-01-03):
//   `ipcMain.handle('projects.list', ...)` must match `invokeWrapped('projects.list', ...)`
//   in `src/preload/index.ts` character-for-character. Mismatch → "No
//   handler registered for X" at invoke time (T-01-03 channel whitelist
//   via registration, not a runtime check).
//
// Refs:
//   - 05-01-PLAN.md Task 1 <action>
//   - 05-CONTEXT.md D-28 (service-bypass exception for pure CRUD handlers)
//   - src/shared/contracts/projects.ts (Zod schemas)
//   - src/main/db/repositories/projects.ts (the repo this delegates to)
//   - src/main/ipc/timers.ts (structural analog — D-28 service-bypass pattern)
//   - threat model T-5-02 (CreateArgsSchema.name min(1)/max(255) gate)
//   - threat model T-5-04 (updateNumber NotFoundError on 0 changes)
//   - threat model T-5-05 (channel literals enumerated identically in ipc + preload)

import { ipcMain } from 'electron'
import * as projectsRepo from '@main/db/repositories/projects'
import { handler } from './system'
import {
  ListArgsSchema,
  CreateArgsSchema,
  UpdateNumberArgsSchema,
} from '@shared/contracts/projects'

/**
 * `projects.list()` — return all projects ordered by id ascending.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `projectsRepo.list()`. Pure read;
 * no FSM semantics; no transaction needed.
 */
export const handleList = handler(ListArgsSchema, async (_args) =>
  projectsRepo.list(),
)

/**
 * `projects.create({ name, number })` — insert a new project row and return
 * the freshly-inserted `Project`. Zod gate: name is min(1)/max(255), number
 * is max(255) or null (T-5-02 mitigation).
 *
 * D-28 SERVICE-BYPASS: delegates directly to `projectsRepo.create(name, number)`.
 * Pure insert; no FSM semantics.
 */
export const handleCreate = handler(
  CreateArgsSchema,
  async ({ name, number }) => projectsRepo.create(name, number),
)

/**
 * `projects.updateNumber({ id, number })` — update only the project_number
 * column for the given project id.
 *
 * D-28 SERVICE-BYPASS: delegates directly to `projectsRepo.updateNumber(id, number)`.
 * Pure update; no FSM semantics. Throws NotFoundError on 0 changes (T-5-04).
 */
export const handleUpdateNumber = handler(
  UpdateNumberArgsSchema,
  async ({ id, number }) => {
    projectsRepo.updateNumber(id, number)
  },
)

/**
 * Register the `projects.*` IPC channels with `ipcMain`. Called from
 * `registerAllHandlers()` in `./index.ts` AFTER `initDb()` + `runMigrations()`.
 *
 * Channel names are the literal dotted strings — match exactly the strings
 * passed to `invokeWrapped(...)` in `src/preload/index.ts`. Any other channel
 * name is unregistered: ipcMain throws "No handler registered for <channel>"
 * on invoke (T-01-03 — channel whitelist via registration, no runtime check).
 *
 * The `_evt` parameter (Electron's IpcMainInvokeEvent) is intentionally
 * unused — handler bodies must not depend on which renderer made the call.
 *
 * @param ipc — injectable for tests; defaults to the real `ipcMain`.
 */
export function registerProjectsHandlers(
  ipc: typeof ipcMain = ipcMain,
): void {
  ipc.handle('projects.list', (_evt, args) => handleList(args))
  ipc.handle('projects.create', (_evt, args) => handleCreate(args))
  ipc.handle('projects.updateNumber', (_evt, args) => handleUpdateNumber(args))
}
