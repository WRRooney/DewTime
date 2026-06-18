// IPC handlers for the `timeEntries.*` namespace. All state-changing write
// handlers delegate to `@main/services/timer.ts` for FSM safety. Service-bypass
// exceptions (pure reads or pure timestamp writes):
//   1. `listByTimer` — pure read, no FSM semantics.
//   2. `setStart` / `setEnd` — pure timestamp writes, no FSM transition. The
//      running-entry invariant is protected by setEnd's null-end guard in the
//      repository.
// `deleteEntry` now delegates to timerService.deleteEntry (FSM-safe: stops
// heartbeat/tick when the running entry is deleted).
//
// `handleCheckResume` delegates to `getCachedResumeResult()`, NOT `checkResume()`.
// The cache is populated at boot; the defensive re-run path only fires on
// boot-order violations.

import { ipcMain } from 'electron'
import * as timerService from '@main/services/timer'
// listByTimer: pure read — repo called directly. All write methods go through
// timerService. The `listByTimerRepo` alias keeps the intent visible at call sites.
// setStart/setEnd: pure timestamp writes, no FSM transition — repo called directly.
// listInRange/createEntry/setTimestamps: Phase 9 gantt methods — pure repo calls.
// createEntry is a direct repo call (endTs always non-null, no FSM needed — D-21).
import {
  listByTimer as listByTimerRepo,
  listInRange as listInRangeRepo,
  createEntry as createEntryRepo,
  setTimestamps as setTimestampsRepo,
  setStart as setStartRepo,
  setEnd as setEndRepo,
} from '@main/db/repositories/timeEntries'
import { handler } from './system'
import type { EpochSeconds } from '@shared/time'
import {
  StartArgsSchema,
  StopArgsSchema,
  StopActiveArgsSchema,
  GetRunningArgsSchema,
  ListByTimerArgsSchema,
  CheckResumeArgsSchema,
  SetStartArgsSchema,
  SetEndArgsSchema,
  DeleteEntryArgsSchema,
  ListInRangeArgsSchema,
  CreateEntryArgsSchema,
  SetTimestampsArgsSchema,
} from '@shared/contracts/timeEntries'

/**
 * `timeEntries.start(timerId)` — start a new running entry. Delegates to
 * `timerService.start` which wraps stop-then-start in a `db.transaction(fn)`
 * for the single-active-timer invariant.
 */
export const handleStart = handler(
  StartArgsSchema,
  async ({ timerId }) => timerService.start(timerId),
)

/**
 * `timeEntries.stop(timerId)` — stop the running entry IF it belongs to
 * `timerId`. Wrong-timer calls are a no-op (returns `null`). Delegates to
 * `timerService.stop` for the FSM-conforming path.
 */
export const handleStop = handler(
  StopArgsSchema,
  async ({ timerId }) => timerService.stop(timerId),
)

/**
 * `timeEntries.stopActive()` — stop whatever's currently running.
 * Idempotent at the service layer (returns `null` when nothing is running).
 */
export const handleStopActive = handler(
  StopActiveArgsSchema,
  async () => timerService.stopActive(),
)

/**
 * `timeEntries.getRunning()` — read the currently-running entry, or `null`.
 * Thin pass-through to the service's accessor.
 */
export const handleGetRunning = handler(
  GetRunningArgsSchema,
  async () => timerService.getRunningEntry(),
)

/**
 * `timeEntries.listByTimer(timerId)` — pure read; the only handler in this
 * file that calls the repository directly (no FSM semantics, no transaction
 * needed). Visible via the `listByTimerRepo` import alias.
 */
export const handleListByTimer = handler(
  ListByTimerArgsSchema,
  async ({ timerId }) => listByTimerRepo(timerId),
)

/**
 * `timeEntries.checkResume()` — returns the boot-time cached `ResumeResult`,
 * or `null` if no running entry survived restart. On cache miss, defensively
 * re-runs the check and logs at error (boot-order violation).
 */
export const handleCheckResume = handler(
  CheckResumeArgsSchema,
  async () => timerService.getCachedResumeResult(),
)

/**
 * `timeEntries.setStart(entryId, ts)` — pure timestamp write, no FSM
 * transition. Start is always editable regardless of running state; only
 * the NotFound guard and the start < end ordering guard apply.
 */
export const handleSetStart = handler(
  SetStartArgsSchema,
  // ts is Zod-validated (positive int) at this boundary — sanctioned `as EpochSeconds` cast (see @shared/time).
  async ({ entryId, ts }) => setStartRepo(entryId, ts as EpochSeconds),
)

/**
 * `timeEntries.setEnd(entryId, ts)` — pure timestamp write, no FSM transition.
 * The repo enforces start < end and rejects running entries (end_timestamp IS NULL).
 */
export const handleSetEnd = handler(
  SetEndArgsSchema,
  // ts is Zod-validated (positive int) at this boundary — sanctioned `as EpochSeconds` cast (see @shared/time).
  async ({ entryId, ts }) => setEndRepo(entryId, ts as EpochSeconds),
)

/**
 * `timeEntries.deleteEntry(entryId)` — delete a time entry. When the deleted
 * entry was the running entry, the timer's heartbeat and tick are stopped
 * (FSM-safe via timerService.deleteEntry). Missing ids throw NotFoundError.
 */
export const handleDeleteEntry = handler(
  DeleteEntryArgsSchema,
  async ({ entryId }) => timerService.deleteEntry(entryId),
)

/**
 * `timeEntries.listInRange(fromEpoch, toEpoch)` — cross-timer range query for
 * the gantt viewport. Pure read; no FSM semantics. Zod gate rejects reversed/
 * zero-span ranges (T-09-04). Direct repo call.
 */
export const handleListInRange = handler(
  ListInRangeArgsSchema,
  // fromEpoch/toEpoch are Zod-validated positive ints — sanctioned EpochSeconds cast.
  async ({ fromEpoch, toEpoch }) =>
    listInRangeRepo(fromEpoch as EpochSeconds, toEpoch as EpochSeconds),
)

/**
 * `timeEntries.createEntry(timerId, startTs, endTs)` — insert a completed entry
 * for gantt double-click creation. Direct repo call — endTs is schema-guaranteed
 * non-null so no FSM involvement (D-21, D-26, D-27).
 */
export const handleCreateEntry = handler(
  CreateEntryArgsSchema,
  async ({ timerId, startTs, endTs }) =>
    createEntryRepo(timerId, startTs as EpochSeconds, endTs as EpochSeconds),
)

/**
 * `timeEntries.setTimestamps(entryId, startTs, endTs)` — atomic body-move for
 * gantt drag-to-move. Direct repo call — repo guards running entries and ordering
 * (T-09-01, T-09-06, D-17).
 */
export const handleSetTimestamps = handler(
  SetTimestampsArgsSchema,
  async ({ entryId, startTs, endTs }) =>
    setTimestampsRepo(entryId, startTs as EpochSeconds, endTs as EpochSeconds),
)

/**
 * Register the `timeEntries.*` IPC channels with `ipcMain`.
 *
 * The `_evt` parameter is intentionally unused — handler bodies must not
 * depend on which renderer made the call.
 *
 * @param ipc injectable for tests; defaults to the real `ipcMain`.
 */
export function registerTimeEntriesHandlers(
  ipc: typeof ipcMain = ipcMain,
): void {
  ipc.handle('timeEntries.start', (_evt, args) => handleStart(args))
  ipc.handle('timeEntries.stop', (_evt, args) => handleStop(args))
  ipc.handle('timeEntries.stopActive', (_evt, args) => handleStopActive(args))
  ipc.handle('timeEntries.getRunning', (_evt, args) => handleGetRunning(args))
  ipc.handle('timeEntries.listByTimer', (_evt, args) => handleListByTimer(args))
  ipc.handle('timeEntries.checkResume', (_evt, args) => handleCheckResume(args))
  ipc.handle('timeEntries.setStart', (_evt, args) => handleSetStart(args))
  ipc.handle('timeEntries.setEnd', (_evt, args) => handleSetEnd(args))
  ipc.handle('timeEntries.deleteEntry', (_evt, args) => handleDeleteEntry(args))
  ipc.handle('timeEntries.listInRange', (_evt, args) => handleListInRange(args))
  ipc.handle('timeEntries.createEntry', (_evt, args) => handleCreateEntry(args))
  ipc.handle('timeEntries.setTimestamps', (_evt, args) => handleSetTimestamps(args))
}
