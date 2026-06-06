// IPC handler aggregator. Called from `src/main/index.ts` AFTER `initDb()` +
// `runMigrations()` — handlers call getDb() via the repositories, which
// crashes if initDb() has not yet run.

import { registerSystemHandlers } from './system'
import { registerTimeEntriesHandlers } from './timeEntries'
import { registerSettingsHandlers } from './settings'
import { registerTimersHandlers } from './timers'
import { registerProjectsHandlers } from './projects'
import { registerEditorHandlers } from './editor'

/**
 * Register every IPC handler across every namespace. Called exactly once by
 * the main entry; Electron's `ipcMain.handle` throws on duplicate registration.
 */
export function registerAllHandlers(): void {
  registerSystemHandlers()
  registerTimeEntriesHandlers()
  registerSettingsHandlers()
  registerTimersHandlers()
  registerProjectsHandlers()
  registerEditorHandlers()
}
