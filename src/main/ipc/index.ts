// src/main/ipc/index.ts
// IPC handler aggregator. Phase 1 registers `system.*`; Phase 2 adds
// `timeEntries.*`; Phase 3 (plan 03-03) adds `settings.*`. Later phases
// will add `timers.*` and `projects.*`.
//
// Called from `src/main/index.ts` AFTER `initDb()` + `runMigrations()` have
// completed (RESEARCH.md §2 lines ~485-503 — handlers indirectly call getDb()
// via the repositories, which crash if initDb() has not yet run).
//
// Refs:
//   - 01-04-PLAN.md Task 1 <action>
//   - 02-05-PLAN.md Task 3 (Phase 2 timeEntries.* wiring)
//   - 03-03-PLAN.md Task 2 (Phase 3 settings.* wiring)
//   - CONTEXT.md D-12 (namespaced API — one registerXyzHandlers per namespace)
//   - 03-CONTEXT.md D-20 (registerSettingsHandlers added alongside system + timeEntries)

import { registerSystemHandlers } from './system'
import { registerTimeEntriesHandlers } from './timeEntries'
import { registerSettingsHandlers } from './settings'
// Phase 4 (Plan 04-05 / D-16): 7 timers.* channels (list, create, delete,
// setDescription, setProject, setOffset, setNotes) — all Zod-validated via
// the handler<I,O> factory. handleDelete delegates to timerService.deleteTimer
// (D-17); the other 6 call timersRepo directly (D-28 service-bypass exception).
import { registerTimersHandlers } from './timers'
// Phase 5 (Plan 05-01 / D-28): 3 projects.* channels (list, create, updateNumber)
// — all Zod-validated via handler<I,O> factory. All call projectsRepo directly
// (D-28 service-bypass exception — pure CRUD, no FSM semantics).
import { registerProjectsHandlers } from './projects'
// Phase 5 UAT follow-up: editor.* channels (open separate editor window +
// cross-window 'timerz:data-changed' broadcast).
import { registerEditorHandlers } from './editor'

/**
 * Register every IPC handler across every namespace. Phase 1 implemented
 * `system.*`; Phase 2 (Plan 02-05) added `timeEntries.*`; Phase 3 (Plan
 * 03-03) adds `settings.*`; Phase 4 (Plan 04-05) adds `timers.*`; Phase 5
 * (Plan 05-01) adds `projects.*`.
 *
 * Idempotent at the application level (the main entry calls this exactly
 * once), but Electron's `ipcMain.handle` throws on duplicate registration —
 * do NOT call this twice from the same process.
 *
 * Refs:
 *   - 01-04-PLAN.md Task 1 (Phase 1 system.* wiring)
 *   - 02-05-PLAN.md Task 3 (Phase 2 timeEntries.* wiring)
 *   - 03-03-PLAN.md Task 2 (Phase 3 settings.* wiring)
 *   - 04-05-PLAN.md Task 2 (Phase 4 timers.* wiring — D-16)
 *   - 02-CONTEXT.md D-12 (one registerXyzHandlers per namespace)
 *   - 03-CONTEXT.md D-20 (settings handlers registered here)
 *   - 04-CONTEXT.md D-16 (timers.* handlers registered here)
 */
export function registerAllHandlers(): void {
  registerSystemHandlers()
  registerTimeEntriesHandlers()
  registerSettingsHandlers()
  // Phase 4 (D-16): wire the 7 timers.* channels.
  // handleDelete is the lone service-mediated handler (D-17 / T-04-04);
  // the other 6 call timersRepo directly (D-28 service-bypass exception).
  registerTimersHandlers()
  // Phase 5 (D-28): wire the 3 projects.* channels.
  // All three call projectsRepo directly (D-28 service-bypass exception — pure CRUD).
  registerProjectsHandlers()
  // Phase 5 UAT follow-up: editor.open (separate window) + editor.notify-changed broadcast.
  registerEditorHandlers()
}
