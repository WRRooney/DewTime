// The TimerService FSM in main stops any currently-running timer before
// starting a new one, so the renderer just invalidates and re-fetches.
// No optimistic update — local SQLite round-trip is < 5 ms, so the
// added complexity yields no user-perceivable benefit.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TimeEntry } from '@shared/ipc'
import { timersQueryKey } from './useTimers'
import { entriesNamespaceKey } from './useEntriesForTimer'

/** Mutation to start a timer. Invalidates timers, entry lists, AND the gantt viewport
 * (so a timer started from the gantt lane immediately shows its running bar — D-21
 * / Pitfall 1 from 09-RESEARCH.md). */
export function useStartTimer() {
  const qc = useQueryClient()
  return useMutation<TimeEntry, Error, number>({
    mutationFn: (timerId: number) => window.api.timeEntries.start(timerId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: timersQueryKey }),
        qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
        qc.invalidateQueries({ queryKey: ['timeEntries', 'gantt'] }), // gantt key (D-21)
      ])
    },
  })
}
