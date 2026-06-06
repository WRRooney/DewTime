// Zod schemas for the `timeEntries.*` IPC namespace.
// The TimerService FSM enforces the single-active-timer invariant when these schemas pass.
import { z } from 'zod'

/** `timeEntries.start(timerId)`. */
export const StartArgsSchema = z.object({
  timerId: z.number().int().positive(),
})
export type StartArgs = z.infer<typeof StartArgsSchema>

/** `timeEntries.stop(timerId)`. */
export const StopArgsSchema = z.object({
  timerId: z.number().int().positive(),
})
export type StopArgs = z.infer<typeof StopArgsSchema>

/** `timeEntries.stopActive()` — no arguments. */
export const StopActiveArgsSchema = z.object({}).optional()
export type StopActiveArgs = z.infer<typeof StopActiveArgsSchema>

/** `timeEntries.listByTimer(timerId)`. */
export const ListByTimerArgsSchema = z.object({
  timerId: z.number().int().positive(),
})
export type ListByTimerArgs = z.infer<typeof ListByTimerArgsSchema>

/** `timeEntries.getRunning()` — no arguments. */
export const GetRunningArgsSchema = z.object({}).optional()
export type GetRunningArgs = z.infer<typeof GetRunningArgsSchema>

/**
 * `timeEntries.checkResume()` — no arguments. Returns the boot-time cached
 * `ResumeResultDto` (or `null`). The `.optional()` wrapper lets the preload
 * pass `undefined` and still parse cleanly.
 */
export const CheckResumeArgsSchema = z.object({}).optional()
export type CheckResumeArgs = z.infer<typeof CheckResumeArgsSchema>

/**
 * `timeEntries.setStart(entryId, ts)`.
 * The `start < end` ordering guard lives in the repo; setStart has no
 * running-entry restriction. Zod gate is structural-only: positive integers
 * reject negative or zero timestamps, but cannot know the stored start value.
 */
export const SetStartArgsSchema = z.object({
  entryId: z.number().int().positive(),
  ts: z.number().int().positive(), // EpochSeconds; positive rejects zero/negative timestamps
})
export type SetStartArgs = z.infer<typeof SetStartArgsSchema>

/**
 * `timeEntries.setEnd(entryId, ts)`.
 * Repo enforces `start < end` and rejects when the entry is still running
 * (end_timestamp IS NULL). Zod gate is structural only.
 */
export const SetEndArgsSchema = z.object({
  entryId: z.number().int().positive(),
  ts: z.number().int().positive(), // EpochSeconds; repo checks ts > start_timestamp
})
export type SetEndArgs = z.infer<typeof SetEndArgsSchema>
