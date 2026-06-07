// IPC handler for the `updates.*` namespace.
//
// This is an ACTION channel — not a persisted setting. `updates.check` triggers
// an on-demand update check and returns a status snapshot. The native approval
// dialog and download/restart lifecycle are driven entirely by updater.ts in main.
//
//   - updates.check (invoke) — call checkForUpdatesManual(); returns UpdateCheckResult.
//     Works regardless of settings.auto_update (D-04).

import { ipcMain } from 'electron'
import { handler } from './system'
import { CheckUpdatesArgsSchema } from '@shared/contracts/updates'
import { checkForUpdatesManual } from '@main/services/updater'

/** Handler body for `updates.check()` — delegates to the updater service. */
export const handleCheckUpdates = handler(CheckUpdatesArgsSchema, async () =>
  checkForUpdatesManual(),
)

/**
 * Register the `updates.*` channels with `ipcMain`.
 *
 * @param ipc injectable for tests; defaults to the real `ipcMain`.
 */
export function registerUpdatesHandlers(ipc: typeof ipcMain = ipcMain): void {
  ipc.handle('updates.check', (_evt, args) => handleCheckUpdates(args))
}
