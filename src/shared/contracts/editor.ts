// Zod contract for the `editor.*` IPC namespace (timestamp-editor window).
// Validates the renderer→main boundary.

import { z } from 'zod'

/** `editor.open(timerId)` — timerId must be a positive integer. */
export const OpenEditorArgsSchema = z.object({
  timerId: z.number().int().positive(),
})
export type OpenEditorArgs = z.infer<typeof OpenEditorArgsSchema>
