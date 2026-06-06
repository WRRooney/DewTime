// Zod schemas for the `projects.*` IPC namespace.
import { z } from 'zod'

/** `projects.list()` — no arguments. */
export const ListArgsSchema = z.object({}).optional()
export type ListArgs = z.infer<typeof ListArgsSchema>

/**
 * `projects.create(name, number)`.
 * v1 `project_name` is NOT NULL but allowed empty in the model; the IPC
 * boundary tightens this to `min(1)` to surface the bad-input case loudly.
 * `project_number` is nullable per v1 schema (timerz/db/models.py).
 */
export const CreateArgsSchema = z.object({
  name: z.string().min(1).max(255),
  number: z.string().max(255).nullable(),
})
export type CreateArgs = z.infer<typeof CreateArgsSchema>

/** `projects.updateNumber(id, number)`. */
export const UpdateNumberArgsSchema = z.object({
  id: z.number().int().positive(),
  number: z.string().max(255).nullable(),
})
export type UpdateNumberArgs = z.infer<typeof UpdateNumberArgsSchema>
