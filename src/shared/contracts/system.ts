// Zod schemas for the `system.*` IPC namespace.
// The IPC handler dispatcher calls `Schema.safeParse(args)` on entry and
// throws ValidationError on failure.
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
 * Schema for `system.closeWindow()`. No arguments.
 * Uses `close()` (not `app.quit()`) so the existing `'close'` window-event
 * lifecycle fires (geometry flush, etc.).
 */
export const CloseWindowArgsSchema = z.object({}).optional()
export type CloseWindowArgs = z.infer<typeof CloseWindowArgsSchema>

/**
 * Schema for `system.copyToClipboard(text)`. Writes `text` to the OS clipboard
 * via Electron's `clipboard` module — `navigator.clipboard` is unavailable in
 * the packaged `file://` context, so copy must flow through main. Empty string
 * is allowed (clears the field harmlessly); capped at 10,000 chars.
 */
export const CopyToClipboardArgsSchema = z.object({
  text: z.string().max(10_000),
})
export type CopyToClipboardArgs = z.infer<typeof CopyToClipboardArgsSchema>
