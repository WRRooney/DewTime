// src/renderer/src/hooks/useStopTimer.ts
// TanStack Query v5 mutation for stopping a running timer (D-12 / D-26).
//
// Delegates to window.api.timeEntries.stop(timerId). On success the tick
// stream will stop naturally (main's tickService interval is cleared when
// TimerService.stop() runs). The renderer invalidates the query so the
// table re-renders with the updated totalSeconds and running=false.
//
// Refs:
//   - 04-CONTEXT.md D-12 (mutation invalidation pattern)
//   - 04-CONTEXT.md D-26 (start/stop button; no optimistic update)
//   - 04-RESEARCH.md § Pattern 2 (canonical useMutation template)

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
