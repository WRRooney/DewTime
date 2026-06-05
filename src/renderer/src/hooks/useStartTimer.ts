// src/renderer/src/hooks/useStartTimer.ts
// TanStack Query v5 mutation for starting a timer (D-12 / D-26).
//
// Delegates to window.api.timeEntries.start(timerId) — the TimerService FSM
// in main stops any currently-running timer before starting the new one
// (Phase 2 D-19 / TIME-03 invariant). The renderer just invalidates and
// lets the refetch reflect the new state.
//
// No optimistic update (D-26 explicitly defers this — local SQLite round-trip
// is < 5 ms so optimistic UI adds complexity without user-perceivable benefit).
//
// Refs:
//   - 04-CONTEXT.md D-12 (mutation invalidation pattern)
//   - 04-CONTEXT.md D-26 (start/stop button; no optimistic update)
//   - 04-RESEARCH.md § Pattern 2 (canonical useMutation template)

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
