// src/renderer/src/hooks/useSetEntryTimestamps.ts
// Two TanStack Query v5 mutations for editing a time entry's start/end timestamps (D-09).
//
// Both invalidate ['timers'] so DurationCell's totalSeconds refreshes after a timestamp edit.
//
// Args:
//   useSetEntryStart: { entryId: number; ts: number }
//   useSetEntryEnd:   { entryId: number; ts: number }
//
// The `ts` arg is typed as `number` at the call site (datetimeLocalToEpoch returns
// EpochSeconds | null; callers check for null then pass the value). The hook casts
// to EpochSeconds for the IPC boundary — DATA-04 ensures ts is always an integer.
//
// Refs:
//   - 05-CONTEXT.md D-09 (timestamp edit — start always editable; end blocked if running)
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state)
//   - src/renderer/src/hooks/useSetDescription.ts (mutation pattern source)

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EpochSeconds } from '@shared/time'
import { timersQueryKey } from './useTimers'
import { entriesNamespaceKey } from './useEntriesForTimer'

/**
 * Invalidate both the timers cache (DurationCell totalSeconds) and the dialog's own
 * entries list so the popup's datetime inputs reflect the persisted value (WR-01).
 */
async function invalidateAfterTimestampEdit(qc: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: timersQueryKey }),
    qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
  ])
}

/** Mutation to update a time entry's start_timestamp. Refreshes timers + dialog entries on success. */
export function useSetEntryStart() {
  const qc = useQueryClient()
  return useMutation<void, Error, { entryId: number; ts: number }>({
    mutationFn: ({ entryId, ts }) => window.api.timeEntries.setStart(entryId, ts as EpochSeconds),
    onSuccess: () => invalidateAfterTimestampEdit(qc),
  })
}

/** Mutation to update a stopped time entry's end_timestamp. Refreshes timers + dialog entries on success. */
export function useSetEntryEnd() {
  const qc = useQueryClient()
  return useMutation<void, Error, { entryId: number; ts: number }>({
    mutationFn: ({ entryId, ts }) => window.api.timeEntries.setEnd(entryId, ts as EpochSeconds),
    onSuccess: () => invalidateAfterTimestampEdit(qc),
  })
}
