// The tick stream stops naturally because TimerService.stop() clears the
// tickService interval in main. The renderer invalidates the query so the
// table re-renders with updated totalSeconds and running=false.
// Both timers and entries caches are invalidated so an open TimestampEditor
// popup sees the filled end_timestamp immediately after a Stop.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TimeEntry } from '@shared/ipc'
import { timersQueryKey } from './useTimers'
import { entriesNamespaceKey } from './useEntriesForTimer'

/** Mutation to stop a running timer. Invalidates both the timers and entries caches on success. */
export function useStopTimer() {
  const qc = useQueryClient()
  return useMutation<TimeEntry | null, Error, number>({
    mutationFn: (timerId: number) => window.api.timeEntries.stop(timerId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: timersQueryKey }),
        qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
      ])
    },
  })
}
