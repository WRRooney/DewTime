// System IPC handlers and the shared `handler()` factory. Channel names are
// dotted strings: 'system.echo', 'system.dbSmoke', 'system.closeWindow',
// 'system.copyToClipboard'. Unregistered channels → ipcMain throws
// "No handler registered for ..." at invoke time.

import type { z } from 'zod'
import { ipcMain, BrowserWindow, clipboard, app, shell } from 'electron'
import { getDb } from '@main/db/database'
import { ValidationError } from '@shared/errors'
import { nowSeconds } from '@shared/time'
import {
  EchoArgsSchema,
  DbSmokeArgsSchema,
  CloseWindowArgsSchema,
  CopyToClipboardArgsSchema,
  GetVersionArgsSchema,
  OpenReleasesArgsSchema,
} from '@shared/contracts/system'

/** Hardcoded GitHub releases URL — never accept a URL from the renderer. */
const RELEASES_URL = 'https://github.com/WRRooney/DewTime/releases'

/**
 * Handler factory — wraps a typed handler body in a Zod-validating shell.
 *
 * On parse failure, throws `ValidationError` with the concatenated Zod issues.
 * The message is prefix-encoded so the preload bridge's `reviveError` can
 * reconstruct the typed subclass on the renderer side.
 *
 * @param schema the Zod schema validating the unknown args from the IPC bus
 * @param fn the handler body, called with the parsed input
 * @returns an async function suitable for `ipcMain.handle`
 */
export function handler<I, O>(
  schema: z.ZodSchema<I>,
  fn: (input: I) => Promise<O> | O,
): (args: unknown) => Promise<O> {
  return async (args: unknown): Promise<O> => {
    const parsed = schema.safeParse(args)
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
      throw new ValidationError(msg)
    }
    return await fn(parsed.data)
  }
}

/** Handler body for `system.echo(message)` — round-trips the validated string. */
export const handleEcho = handler(EchoArgsSchema, async ({ message }) => message)

/**
 * Handler body for `system.dbSmoke()`. Exercises the full SQLite round-trip:
 * INSERT a probe row → SELECT it back → DELETE it → COUNT remaining rows.
 *
 * Returns `{ rowCount, canRead }`:
 * - `canRead`: true if the SELECT after INSERT returned the row.
 * - `rowCount`: COUNT(*) after DELETE — zero on a clean DB.
 */
export const handleDbSmoke = handler(DbSmokeArgsSchema, async () => {
  const db = getDb()
  const probe = `phase1-smoke-${nowSeconds()}`
  db.prepare('INSERT INTO projects (project_name) VALUES (?)').run(probe)
  const row = db
    .prepare('SELECT id FROM projects WHERE project_name = ?')
    .get(probe)
  const canRead = row != null
  db.prepare('DELETE FROM projects WHERE project_name = ?').run(probe)
  const rowCount = (
    db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }
  ).n
  return { rowCount, canRead }
})

/**
 * Handler body for `system.closeWindow()` — closes the currently-focused
 * BrowserWindow.
 *
 * Delegates to `BrowserWindow.getFocusedWindow()?.close()`. The `close()` call
 * fires the window's `'close'` event, which `windowGeometry.attachListeners`
 * wires to `flushPendingWrite()` — so the user's last drag persists even when
 * they exit via this path.
 *
 * NEVER use the app-level quit shortcut here — it skips the per-window 'close'
 * event lifecycle and would lose any pending geometry write.
 *
 * No-ops when no window is focused — the `?.` chain swallows the null.
 */
export const handleCloseWindow = handler(CloseWindowArgsSchema, async () => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return
  win.close()
})

/**
 * Handler body for `system.copyToClipboard(text)` — writes `text` to the OS
 * clipboard via Electron's main-process `clipboard` module. The renderer
 * cannot use `navigator.clipboard` reliably: in the packaged build the page
 * loads over `file://`, a non-secure context where the async Clipboard API is
 * unavailable. Routing through main keeps copy working in both dev and packaged.
 */
export const handleCopyToClipboard = handler(CopyToClipboardArgsSchema, async ({ text }) => {
  clipboard.writeText(text)
})

/**
 * Handler body for `system.getVersion()` — returns the running app version
 * string sourced from `app.getVersion()` (reads `package.json` version at
 * runtime — never stale).
 */
export const handleGetVersion = handler(GetVersionArgsSchema, async () =>
  app.getVersion(),
)

/**
 * Handler body for `system.openReleases()` — opens the GitHub releases page in
 * the user's default browser. The URL is hardcoded as `RELEASES_URL` so the
 * renderer cannot supply an arbitrary URL (open-redirect mitigation, gate A-03).
 *
 * NEVER pass a renderer-supplied URL here — that would allow an attacker who
 * compromises the renderer to open arbitrary URLs in the browser (open-redirect).
 */
export const handleOpenReleases = handler(OpenReleasesArgsSchema, async () => {
  await shell.openExternal(RELEASES_URL)
})

/**
 * Register the `system.*` IPC channels with `ipcMain`.
 *
 * The `_evt` parameter is intentionally unused — handler bodies must not
 * depend on which renderer made the call.
 *
 * @param ipc injectable for tests; defaults to the real `ipcMain`.
 */
export function registerSystemHandlers(ipc: typeof ipcMain = ipcMain): void {
  ipc.handle('system.echo', (_evt, args) => handleEcho(args))
  ipc.handle('system.dbSmoke', (_evt, args) => handleDbSmoke(args))
  // Renderer close button delegates here so the window 'close' event fires
  // for the geometry flush. NEVER swap for app-level quit (skips 'close').
  ipc.handle('system.closeWindow', (_evt, args) => handleCloseWindow(args))
  ipc.handle('system.copyToClipboard', (_evt, args) => handleCopyToClipboard(args))
  ipc.handle('system.getVersion', (_evt, args) => handleGetVersion(args))
  ipc.handle('system.openReleases', (_evt, args) => handleOpenReleases(args))
}
