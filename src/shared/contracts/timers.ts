// src/shared/contracts/timers.ts
// Zod schemas for the `timers.*` IPC namespace. Schemas ship in Phase 1 so
// the contract shape is locked; the handlers that consume them land in
// Phase 2 (TimerService FSM + dispatch). Every schema is `z.object({...})`
// (not a bare validator) so the dispatcher can call `.safeParse(args)`
// uniformly.
//
// Refs:
//   - CONTEXT.md D-15 (Zod at boundary; no .transform/.refine in Phase 1)
//   - src/shared/ipc.ts TimersApi (the type these schemas validate against)
import { z } from 'zod'

/** Epoch-seconds bounds: 1_700_000_000 (post-Nov-2023) ≤ x < 2_000_000_000 (year 2033 guard). */
const EpochSecondsValue = z.number().int().min(1_700_000_000).max(1_999_999_999)

/** `timers.list(dateRange?)` — optional date range with both endpoints. */
export const ListArgsSchema = z.object({
  dateRange: z
    .object({
      fromEpoch: EpochSecondsValue,
      toEpoch: EpochSecondsValue,
    })
    .optional(),
})
export type ListArgs = z.infer<typeof ListArgsSchema>

/** `timers.create({ projectId, description })`. */
export const CreateArgsSchema = z.object({
  projectId: z.number().int().positive().nullable(),
  description: z.string().min(0).max(1000),
})
export type CreateArgs = z.infer<typeof CreateArgsSchema>

/** Generic `{ id }` envelope shared by delete-style handlers. */
export const IdArgsSchema = z.object({
  id: z.number().int().positive(),
})
export type IdArgs = z.infer<typeof IdArgsSchema>

/** `timers.setDescription(id, description)`. */
export const SetDescriptionArgsSchema = z.object({
  id: z.number().int().positive(),
  description: z.string().min(0).max(1000),
})
export type SetDescriptionArgs = z.infer<typeof SetDescriptionArgsSchema>

/** `timers.setProject(id, projectId)`. */
export const SetProjectArgsSchema = z.object({
  id: z.number().int().positive(),
  projectId: z.number().int().positive().nullable(),
})
export type SetProjectArgs = z.infer<typeof SetProjectArgsSchema>

/** `timers.setOffset(id, offsetSeconds)` — offset can be negative or null per v1. */
export const SetOffsetArgsSchema = z.object({
  id: z.number().int().positive(),
  offsetSeconds: z.number().int().nullable(),
})
export type SetOffsetArgs = z.infer<typeof SetOffsetArgsSchema>

/** `timers.setNotes(id, notes)`. */
export const SetNotesArgsSchema = z.object({
  id: z.number().int().positive(),
  notes: z.string().min(0).max(10_000),
})
export type SetNotesArgs = z.infer<typeof SetNotesArgsSchema>
