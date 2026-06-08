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

/** `projects.updateName(id, name)` — rename a project. Name must be 1–255 chars. */
export const UpdateNameArgsSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255),
})
export type UpdateNameArgs = z.infer<typeof UpdateNameArgsSchema>

/** `projects.delete(id)` — delete a project (referencing timers are unassigned). */
export const DeleteProjectArgsSchema = z.object({
  id: z.number().int().positive(),
})
export type DeleteProjectArgs = z.infer<typeof DeleteProjectArgsSchema>

/** `projects.countTimerRefs(id)` — count how many timers reference a project. */
export const CountTimerRefsArgsSchema = z.object({
  id: z.number().int().positive(),
})
export type CountTimerRefsArgs = z.infer<typeof CountTimerRefsArgsSchema>

/** `projects.openManager()` — open the projects manager window. No arguments. */
export const OpenManagerArgsSchema = z.object({}).optional()
export type OpenManagerArgs = z.infer<typeof OpenManagerArgsSchema>
