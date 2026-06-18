// `ts` is typed as `number` at call sites; the hook casts to EpochSeconds at the IPC boundary.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { EpochSeconds } from '@shared/time'
import { timersQueryKey } from './useTimers'
import { entriesNamespaceKey } from './useEntriesForTimer'

/**
 * Invalidate the timers cache (so DurationCell refreshes), the dialog's entries
 * list (so the popup datetime inputs reflect the persisted value), AND the gantt
 * viewport key (so drag-committed bar moves are reflected immediately — D-17/D-20,
 * closes Pitfall 1 from 09-RESEARCH.md).
 */
async function invalidateAfterTimestampEdit(qc: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: timersQueryKey }),
    qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
    qc.invalidateQueries({ queryKey: ['timeEntries', 'gantt'] }), // gantt key (D-17/D-20)
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
