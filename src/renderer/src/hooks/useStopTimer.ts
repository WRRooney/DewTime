// The tick stream stops naturally because TimerService.stop() clears the
// tickService interval in main. The renderer invalidates the query so the
// table re-renders with updated totalSeconds and running=false.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TimeEntry } from '@shared/ipc'
import { timersQueryKey } from './useTimers'

/** Mutation to stop a running timer. Invalidates the timers cache on success. */
export function useStopTimer() {
  const qc = useQueryClient()
  return useMutation<TimeEntry | null, Error, number>({
    mutationFn: (timerId: number) => window.api.timeEntries.stop(timerId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
