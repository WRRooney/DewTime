// src/shared/contracts/timeEntries.ts
// Zod schemas for the `timeEntries.*` IPC namespace. Handlers land in Phase 2
// (the TimerService FSM enforces the single-active-timer invariant when these
// schemas pass).
//
// Refs:
//   - CONTEXT.md D-15
//   - src/shared/ipc.ts TimeEntriesApi
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
 * `ResumeResultDto` (or `null`). The schema mirrors `StopActiveArgsSchema` /
 * `GetRunningArgsSchema` — no payload, the `.optional()` wrapper lets the
 * preload pass `undefined` and still parse cleanly. Plan 02-05 wires the
 * matching handler in `src/main/ipc/timeEntries.ts` to
 * `timerService.getCachedResumeResult()` (02-CONTEXT.md D-15, D-16).
 */
export const CheckResumeArgsSchema = z.object({}).optional()
export type CheckResumeArgs = z.infer<typeof CheckResumeArgsSchema>

/**
 * `timeEntries.setStart(entryId, ts)` — D-09.
 * The `start < end` ordering guard and running-entry guard live in the repo
 * (setStart has no running-entry restriction per D-08/Open-Question-2).
 * Zod gate is structural-only: positive integers enforce DATA-04 (no negative
 * or zero timestamps), but cannot know the stored start value.
 */
export const SetStartArgsSchema = z.object({
  entryId: z.number().int().positive(),
  ts: z.number().int().positive(), // EpochSeconds; positive enforces DATA-04
})
export type SetStartArgs = z.infer<typeof SetStartArgsSchema>

/**
 * `timeEntries.setEnd(entryId, ts)` — D-09.
 * Repo-level guard (start < end) enforced in setEnd(); Zod gate is structural
 * only. The running-entry guard (D-08) is also enforced in the repo (setEnd
 * rejects when current end_timestamp IS NULL). T-5-01/T-5-06 mitigations.
 */
export const SetEndArgsSchema = z.object({
  entryId: z.number().int().positive(),
  ts: z.number().int().positive(), // EpochSeconds; repo checks ts > start_timestamp
})
export type SetEndArgs = z.infer<typeof SetEndArgsSchema>
