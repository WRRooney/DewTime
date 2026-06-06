// IPC handlers for the `editor.*` namespace.
//
//   - editor.open (invoke)         — open/focus the timestamp editor window for
//                                    a timer. Zod-validated.
//   - editor.notify-changed (send) — one-way fire-and-forget from the editor
//                                    window after a successful mutation; main
//                                    broadcasts 'timerz:data-changed' to all
//                                    windows so the table refetches.

import { ipcMain } from 'electron'
import { handler } from './system'
import { OpenEditorArgsSchema } from '@shared/contracts/editor'
import {
  openTimestampEditorWindow,
  broadcastDataChanged,
} from '@main/windows/timestampEditorWindow'

/** Handler body for `editor.open(timerId)` — opens/focuses the editor window. */
export const handleOpenEditor = handler(OpenEditorArgsSchema, async ({ timerId }) => {
  openTimestampEditorWindow(timerId)
})

/**
 * Register the `editor.*` channels. `editor.open` is a request/response invoke;
 * `editor.notify-changed` is a one-way notification the editor window fires
 * after a successful mutation so the main window can refetch (cross-window
 * cache sync — each window is its own renderer process).
 */
export function registerEditorHandlers(ipc: typeof ipcMain = ipcMain): void {
  ipc.handle('editor.open', (_evt, args) => handleOpenEditor(args))
  ipc.on('editor.notify-changed', () => broadcastDataChanged())
}
