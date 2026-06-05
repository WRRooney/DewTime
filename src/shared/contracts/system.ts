// src/shared/contracts/system.ts
// Zod schemas for the `system.*` IPC namespace. Phase 1 wires these to the
// real handlers (plan 04). The IPC handler dispatcher calls
// `Schema.safeParse(args)` on entry and throws ValidationError on failure
// (per RESEARCH.md §4 lines ~900-927).
//
// Refs:
//   - CONTEXT.md D-15 (Zod at the IPC boundary; .parse is the only validation)
//   - RESEARCH.md §4 lines ~684-751 (the SystemApi interface this validates)
import { z } from 'zod'

/**
 * Schema for `system.echo(message)`.
 * Cap message at 10,000 chars to keep an attacker who has somehow bypassed
 * contextIsolation from spamming arbitrarily large strings through the bridge.
 */
export const EchoArgsSchema = z.object({
  message: z.string().min(1).max(10_000),
})
export type EchoArgs = z.infer<typeof EchoArgsSchema>

/**
 * Schema for `system.dbSmoke()`. No arguments — the optional wrapper lets
 * callers pass `undefined` and still parse cleanly.
 */
export const DbSmokeArgsSchema = z.object({}).optional()
export type DbSmokeArgs = z.infer<typeof DbSmokeArgsSchema>

/**
 * Schema for `system.closeWindow()`. No arguments — same `.optional()`
 * convenience as DbSmokeArgsSchema. Plan 03-04 wires the handler to
 * `BrowserWindow.getFocusedWindow()?.close()`.
 *
 * 03-CONTEXT D-07 picked `closeWindow` over directly exposing `app.quit()`
 * to the renderer — `close()` lets the existing `'close'` window-event
 * lifecycle fire (geometry flush from plan 03-02, etc.). Exposing
 * `app.quit()` would be too sharp.
 *
 * Refs: 03-CONTEXT D-07, 03-RESEARCH § Pattern 5, 03-01-PLAN Task 2.
 */
export const CloseWindowArgsSchema = z.object({}).optional()
export type CloseWindowArgs = z.infer<typeof CloseWindowArgsSchema>

/**
 * Schema for `system.copyToClipboard(text)`. Writes `text` to the OS clipboard
 * via Electron's `clipboard` module (renderer `navigator.clipboard` is
 * unavailable in the packaged `file://` non-secure context — copy MUST flow
 * through main). Empty string is allowed (clears the copied field harmlessly);
 * capped at 10,000 chars like EchoArgs to bound a bypassed-isolation attacker.
 */
export const CopyToClipboardArgsSchema = z.object({
  text: z.string().max(10_000),
})
export type CopyToClipboardArgs = z.infer<typeof CopyToClipboardArgsSchema>
