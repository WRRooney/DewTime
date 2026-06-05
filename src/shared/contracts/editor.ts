// src/shared/contracts/editor.ts
// Zod contract for the `editor.*` IPC namespace (Phase 5 UAT follow-up —
// separate timestamp-editor window). Validates the renderer→main boundary.

import { z } from 'zod'

/** `editor.open(timerId)` — timerId must be a positive integer (DATA-04). */
export const OpenEditorArgsSchema = z.object({
  timerId: z.number().int().positive(),
})
export type OpenEditorArgs = z.infer<typeof OpenEditorArgsSchema>
