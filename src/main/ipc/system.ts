// src/main/ipc/system.ts
// System IPC handlers — system.echo + system.dbSmoke. Phase 1 wires only this
// namespace. Channel names are dotted strings (D-13): 'system.echo',
// 'system.dbSmoke'. Anything else is not registered → ipcMain.handle throws
// "No handler registered for ..." on the renderer side (T-01-03 — channel
// whitelist via registration, not a runtime check).
//
// Refs:
//   - 01-04-PLAN.md Task 1 <action>
//   - CONTEXT.md D-12 (namespaced typed API; window.api.system.*)
//   - CONTEXT.md D-13 (dotted channel names; one ipcMain.handle per method)
//   - CONTEXT.md D-15 (Zod at the IPC boundary; .parse → ValidationError)
//   - RESEARCH.md §4 lines ~753-787 (canonical handler shape)
//   - RESEARCH.md §4 lines ~900-928 (handler factory with Zod safeParse)
//   - threat model T-01-04 (SQL injection — parameterised queries only)

import type { z } from 'zod'
import { ipcMain, BrowserWindow, clipboard } from 'electron'
import { getDb } from '@main/db/database'
import { ValidationError } from '@shared/errors'
import { nowSeconds } from '@shared/time'
import {
  EchoArgsSchema,
  DbSmokeArgsSchema,
  CloseWindowArgsSchema,
  CopyToClipboardArgsSchema,
} from '@shared/contracts/system'

/**
 * Handler factory — wraps a typed handler body in a Zod-validating shell.
 *
 * On entry, calls `schema.safeParse(args)`. On parse failure, throws a
 * `ValidationError` whose `.message` is the concatenated Zod issues — this
 * survives Electron's IPC structured-clone (prefix-encoded; the preload
 * bridge's `reviveError` reconstructs the subclass on the renderer side per
 * D-14 refinement in src/shared/errors.ts).
 *
 * On parse success, delegates to `fn` with the strongly-typed parsed value.
 *
 * @param schema the Zod schema validating the unknown args from the IPC bus
 * @param fn the handler body, called with the parsed input
 * @returns an async function suitable for `ipcMain.handle` (after wrapping
 *          the IPC event arg in a `(_evt, args) => handler(args)` shim)
 */
export function handler<I, O>(
  schema: z.ZodSchema<I>,
  fn: (input: I) => Promise<O> | O,
): (args: unknown) => Promise<O> {
  return async (args: unknown): Promise<O> => {
    const parsed = schema.safeParse(args)
    if (!parsed.success) {
      // Concatenate Zod issues into a single human-readable message. Each
      // issue is `path.to.field: message` — useful for renderer-side debugging.
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
 * - `canRead` is `true` if the SELECT after INSERT returned the row (proves
 *   write-and-read durability within the connection).
 * - `rowCount` is the COUNT(*) after DELETE — zero on a clean DB (proves
 *   the cleanup landed and gives the smoke an easy "is this DB empty" signal).
 *
 * All SQL uses `?` placeholders — T-01-04 mitigation. The probe value embeds
 * `nowSeconds()` for log-trace uniqueness, but never via template-string SQL.
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
 * BrowserWindow (Phase 3 / 03-CONTEXT D-07).
 *
 * Delegates to `BrowserWindow.getFocusedWindow()?.close()`. The `close()` call
 * fires the window's `'close'` event, which plan 03-02's
 * `windowGeometry.attachListeners(win)` wires to `flushPendingWrite()` — so
 * the user's last drag persists even when they exit via this path.
 *
 * AP-15 (03-RESEARCH): NEVER use the `app`-level quit shortcut here — it skips
 * the per-window 'close' event lifecycle and would lose any pending geometry
 * write. The renderer's close button MUST flow through this delegate, not a
 * direct quit.
 *
 * No-ops gracefully when no window is focused (e.g., during shutdown or in
 * edge-case test environments) — the `?.` chain swallows the `null`.
 */
export const handleCloseWindow = handler(CloseWindowArgsSchema, async () => {
  const win = BrowserWindow.getFocusedWindow()
  if (!win) return
  win.close()
})

/**
 * Handler body for `system.copyToClipboard(text)` — writes `text` to the OS
 * clipboard via Electron's main-process `clipboard` module. The renderer can
 * NOT use `navigator.clipboard` reliably: in the packaged build the page loads
 * over `file://`, a non-secure context where the async Clipboard API is
 * unavailable. Routing through main keeps copy working in dev AND packaged.
 */
export const handleCopyToClipboard = handler(CopyToClipboardArgsSchema, async ({ text }) => {
  clipboard.writeText(text)
})

/**
 * Register the `system.*` IPC channels with `ipcMain`. Called from
 * `registerAllHandlers()` in `./index.ts` after `initDb()` + `runMigrations()`.
 *
 * Channel names are the literal dotted strings — match exactly the strings
 * the preload bridge passes to `ipcRenderer.invoke` (src/preload/index.ts).
 * Any other channel name is unregistered: ipcMain throws "No handler
 * registered for <channel>" on invoke (T-01-03 — defense-in-depth channel
 * whitelist via registration, no runtime check needed).
 *
 * The `_evt` parameter (Electron's IpcMainInvokeEvent) is intentionally
 * unused — handler bodies must not depend on which renderer made the call
 * (per CONTEXT.md "single-window" assumption for Phase 1).
 *
 * @param ipc — injectable for tests; defaults to the real `ipcMain`.
 */
export function registerSystemHandlers(ipc: typeof ipcMain = ipcMain): void {
  ipc.handle('system.echo', (_evt, args) => handleEcho(args))
  ipc.handle('system.dbSmoke', (_evt, args) => handleDbSmoke(args))
  // Phase 3 (D-07): 'system.closeWindow' — renderer's close button delegates
  // here so the window's 'close' event still fires for plan 03-02's geometry
  // flush. NEVER swap this for the app-level quit shortcut (AP-15).
  ipc.handle('system.closeWindow', (_evt, args) => handleCloseWindow(args))
  // Clipboard copy for the row copy-buttons (project #, description, decimal hours).
  ipc.handle('system.copyToClipboard', (_evt, args) => handleCopyToClipboard(args))
}
