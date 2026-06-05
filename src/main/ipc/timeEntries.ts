// src/main/ipc/timeEntries.ts
// IPC handlers for the `timeEntries.*` namespace. Eight handlers: six delegate
// state-changing work to `@main/services/timer.ts` so the single-active-timer
// invariant (TIME-03) and the FSM transactions stay canonical; two are
// documented service-bypass exceptions (setStart/setEnd — pure timestamp writes,
// no FSM transition). The renderer reaches these via `window.api.timeEntries.{start,
// stop, stopActive, getRunning, listByTimer, checkResume, setStart, setEnd}` —
// the preload bridge in `src/preload/index.ts` calls `ipcRenderer.invoke` with
// the literal dotted channel strings registered below.
//
// TIME-07 / threat T-02-03 ENFORCEMENT:
//   This file does NOT invoke any write method on the time-entries repository
//   module without documented justification. The repo's FSM writes (start/stop/
//   stopActive) MUST be reached through `services/timer.ts`, which wraps them
//   in `db.transaction(fn)` for the FSM invariant. A literal grep of this file
//   for the `<repo>.<write-method>` pattern MUST confirm zero undocumented bypasses.
//
//   The TWO service-bypass exceptions in this file are:
//     1. `listByTimer` — pure read with no FSM semantics (original exception).
//     2. `setStart` / `setEnd` — Phase 5 D-09 D-28 SERVICE-BYPASS EXCEPTION:
//        pure timestamp writes, no FSM transition. The running-entry invariant
//        is protected by setEnd's null-end guard in the repository; these are
//        NOT FSM transitions and therefore do not require service wrapping.
//        Static gate: `grep -c "D-28\|service-bypass" src/main/ipc/timeEntries.ts` ≥ 2
//
//   Each bypass is marked inline with a comment.
//
// ZOD AT THE BOUNDARY (D-15):
//   Every handler runs `<Schema>.safeParse(args)` via the shared `handler()`
//   factory imported from `./system`. On parse failure, the factory throws
//   `ValidationError` with the `[VALIDATION] ` prefix that preload's
//   `reviveError` rebuilds on the renderer side (D-14).
//
// CHANNEL NAMES (D-13):
//   Dotted strings. `ipcMain.handle('timeEntries.start', ...)` must match the
//   `invokeWrapped('timeEntries.start', ...)` literal in the preload bridge
//   character-for-character — Electron throws "No handler registered for X"
//   on a typo (T-01-03 defense-in-depth).
//
// CACHE-FIRST checkResume (D-15):
//   `handleCheckResume` delegates to `timerService.getCachedResumeResult()`
//   — NOT `timerService.checkResume()`. The accessor returns the cache
//   populated by `runMain()`'s boot-time call (Plan 02-04 wiring); on cache
//   miss it falls back to a defensive re-run + log.error. The renderer's
//   first IPC call lands on a populated cache, so the defensive path is for
//   boot-order violations only.
//
// Refs:
//   - 02-05-PLAN.md Task 2 <action>
//   - 02-CONTEXT.md D-13 (dotted channel names), D-15 (Zod boundary),
//     D-16 (checkResume IPC), D-17 (fill remaining timeEntries stubs),
//     D-19 (service composes repos — no direct repo calls from IPC)
//   - 02-RESEARCH.md § Section 9 (IPC handler wiring) + § Code Examples
//     (ipc/timeEntries.ts handler template)
//   - threat model T-02-03 (renderer bypassing service via direct repo call)
//   - src/main/ipc/system.ts (the canonical `handler()` factory, re-used here)

import { ipcMain } from 'electron'
import * as timerService from '@main/services/timer'
// PURE READ — listByTimer has no FSM semantics, so the IPC handler may
// reach the repository directly. All write methods (start/stop/stopActive)
// MUST go through `timerService.*`. The grep gate at the file level enforces
// this; the import naming convention (`listByTimerRepo`) keeps the intent
// visible at call sites.
//
// D-09 D-28 SERVICE-BYPASS EXCEPTION — setStart/setEnd are pure timestamp
// writes with no FSM transition. The running-entry invariant is protected by
// setEnd's null-end guard in the repository. These are not FSM transitions and
// therefore do not require service wrapping. Documented at the file header.
import {
  listByTimer as listByTimerRepo,
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
} from '@shared/contracts/timeEntries'

/**
 * `timeEntries.start(timerId)` — start a new running entry for the given
 * timer. Delegates to `timerService.start` which wraps stop-then-start in a
 * `db.transaction(fn)` for the single-active-timer invariant (TIME-03).
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
 * `timeEntries.listByTimer(timerId)` — pure read; the ONLY handler in this
 * file that bypasses the service to call the repository directly. No FSM
 * semantics → no transaction boundary needed. The intentional bypass is
 * documented inline + visible via the `listByTimerRepo` import alias.
 */
export const handleListByTimer = handler(
  ListByTimerArgsSchema,
  async ({ timerId }) => listByTimerRepo(timerId),
)

/**
 * `timeEntries.checkResume()` — returns the boot-time cached `ResumeResult`,
 * or `null` if no running entry survived restart (D-15). Delegates to
 * `timerService.getCachedResumeResult()` which serves the cache populated
 * by `runMain()`'s boot-time `checkResume()` call; on cache miss it defensively
 * re-runs the check and logs at error (boot-order violation surface).
 */
export const handleCheckResume = handler(
  CheckResumeArgsSchema,
  async () => timerService.getCachedResumeResult(),
)

/**
 * `timeEntries.setStart(entryId, ts)` — Phase 5 D-09 pure timestamp write.
 * No FSM transition. D-09 D-28 SERVICE-BYPASS EXCEPTION: delegates directly
 * to setStartRepo. The running-entry restriction on start is intentionally
 * absent per D-08/Open-Question-2 (start is always editable); only the
 * NotFound guard applies (T-5-08).
 */
export const handleSetStart = handler(
  SetStartArgsSchema,
  // ts is Zod-validated (positive int) at this boundary — sanctioned `as EpochSeconds` cast (see @shared/time).
  async ({ entryId, ts }) => setStartRepo(entryId, ts as EpochSeconds),
)

/**
 * `timeEntries.setEnd(entryId, ts)` — Phase 5 D-09 pure timestamp write.
 * No FSM transition. D-09 D-28 SERVICE-BYPASS EXCEPTION: delegates directly
 * to setEndRepo. The repo enforces start < end (T-5-01) and rejects running
 * entries (T-5-06/D-08). NotFoundError on missing entry (T-5-08).
 */
export const handleSetEnd = handler(
  SetEndArgsSchema,
  // ts is Zod-validated (positive int) at this boundary — sanctioned `as EpochSeconds` cast (see @shared/time).
  async ({ entryId, ts }) => setEndRepo(entryId, ts as EpochSeconds),
)

/**
 * Register the `timeEntries.*` IPC channels with `ipcMain`. Called from
 * `registerAllHandlers()` in `./index.ts` AFTER `initDb()` + `runMigrations()`
 * + the boot-time `powerMonitor.on('resume', ...)` and `checkResume()` calls
 * have run (per Plan 02-04's boot-order wiring).
 *
 * Channel names are the literal dotted strings — match exactly the strings
 * passed to `invokeWrapped(...)` in `src/preload/index.ts`. Any other channel
 * name is unregistered: ipcMain throws "No handler registered for <channel>"
 * on invoke (T-01-03 — channel whitelist via registration, no runtime check).
 *
 * The `_evt` parameter (Electron's IpcMainInvokeEvent) is intentionally
 * unused — handler bodies must not depend on which renderer made the call
 * (per the single-window assumption inherited from Phase 1).
 *
 * @param ipc — injectable for tests; defaults to the real `ipcMain`.
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
  // Phase 5 D-09: timestamp edit channels. Service-bypass exception — pure
  // timestamp writes, no FSM transition (see file header D-28 note).
  ipc.handle('timeEntries.setStart', (_evt, args) => handleSetStart(args))
  ipc.handle('timeEntries.setEnd', (_evt, args) => handleSetEnd(args))
}
