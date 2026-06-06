// IPC handlers for the `settings.*` namespace. Three handlers (get, set, list)
// delegate directly to the settings repository — no service layer, by design,
// since settings has no FSM semantics.
//
// `SetArgsSchema` is a `z.discriminatedUnion('key', [...])` — Zod picks the
// branch by the literal `key` value and validates the sibling `value` against
// that branch's schema in a single safeParse(). Unknown keys and bad values
// both reject at the IPC boundary with one error.
//
// `settings.list` maps to the repo's `getAll()` function (channel ↔ function
// name asymmetry is intentional).

import { ipcMain, BrowserWindow } from 'electron'
import * as settingsRepo from '@main/db/repositories/settings'
import { handler } from './system'
import {
  GetArgsSchema,
  SetArgsSchema,
  ListArgsSchema,
} from '@shared/contracts/settings'
import type { SettingKey, SettingValue } from '@shared/ipc'

/**
 * `settings.get(key)` — return the parsed JSON value for the given setting key.
 * The Zod schema rejects unknown keys before the handler body runs.
 * Throws NotFoundError if the row is absent (shouldn't happen for seeded keys).
 */
export const handleGet = handler(GetArgsSchema, async ({ key }) => {
  return settingsRepo.get(key) as SettingValue<SettingKey>
})

/**
 * `settings.set(key, value)` — JSON-encode `value` and upsert the settings row.
 * The discriminated-union schema validates `value` against the branch for `key`.
 * The `as SettingValue<typeof args.key>` cast bridges the discriminated union's
 * `(key, value)` tuple to the per-K conditional type after Zod validation.
 *
 * Side effect: when key === 'settings.always_on_top', applies the value live
 * to all non-destroyed windows via setAlwaysOnTop so the change takes effect
 * without requiring an app restart.
 */
export const handleSet = handler(SetArgsSchema, async (args) => {
  settingsRepo.set(
    args.key,
    args.value as SettingValue<typeof args.key>,
  )

  // Live-apply always_on_top to all running windows — no restart required.
  if (args.key === 'settings.always_on_top') {
    const value = args.value as boolean
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        // On macOS pass 'floating' when enabling so the window floats above
        // other always-on-top windows. On other platforms omit the second arg
        // (Electron throws when 'floating' is passed on non-darwin).
        if (process.platform === 'darwin' && value) {
          win.setAlwaysOnTop(value, 'floating')
        } else {
          win.setAlwaysOnTop(value)
        }
      }
    }
  }
})

/**
 * `settings.list()` — return every settings row as a `Record<SettingKey,
 * unknown>` with JSON-parsed values. Single IPC round-trip for the settings UI.
 */
export const handleList = handler(ListArgsSchema, async () => {
  return settingsRepo.getAll() as Record<SettingKey, unknown>
})

/**
 * Register the `settings.*` IPC channels with `ipcMain`.
 *
 * The `_evt` parameter is intentionally unused — handler bodies must not
 * depend on which renderer made the call.
 *
 * @param ipc injectable for tests; defaults to the real `ipcMain`.
 */
export function registerSettingsHandlers(
  ipc: typeof ipcMain = ipcMain,
): void {
  ipc.handle('settings.get', (_evt, args) => handleGet(args))
  ipc.handle('settings.set', (_evt, args) => handleSet(args))
  ipc.handle('settings.list', (_evt, args) => handleList(args))
}
