// Mutation to create a completed time entry with caller-supplied timestamps.
// Used by gantt double-click entry creation (D-21). Never creates running entries
// (end_timestamp is required; use timeEntries.start() for running entries instead).
//
// Invalidates all three key namespaces on success so timers, entry lists, AND the
// gantt viewport all refresh (D-21 / Pitfall 1 from 09-RESEARCH.md).

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TimeEntry } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'
import { timersQueryKey } from './useTimers'
import { entriesNamespaceKey } from './useEntriesForTimer'

/** Mutation to insert a completed (non-running) time entry with explicit timestamps. */
export function useCreateEntry() {
  const qc = useQueryClient()
  return useMutation<TimeEntry, Error, { timerId: number; startTs: number; endTs: number }>({
    mutationFn: ({ timerId, startTs, endTs }) =>
      window.api.timeEntries.createEntry(
        timerId,
        startTs as EpochSeconds,
        endTs as EpochSeconds,
      ),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: timersQueryKey }),
        qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
        qc.invalidateQueries({ queryKey: ['timeEntries', 'gantt'] }), // gantt key (D-21)
      ])
    },
  })
}
