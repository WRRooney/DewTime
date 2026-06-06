// The TimerService FSM in main stops any currently-running timer before
// starting a new one, so the renderer just invalidates and re-fetches.
// No optimistic update — local SQLite round-trip is < 5 ms, so the
// added complexity yields no user-perceivable benefit.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TimeEntry } from '@shared/ipc'
import { timersQueryKey } from './useTimers'

/** Mutation to start a timer. Invalidates the timers cache on success. */
export function useStartTimer() {
  const qc = useQueryClient()
  return useMutation<TimeEntry, Error, number>({
    mutationFn: (timerId: number) => window.api.timeEntries.start(timerId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
