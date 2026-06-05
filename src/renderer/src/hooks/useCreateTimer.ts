// src/renderer/src/hooks/useCreateTimer.ts
// TanStack Query v5 mutation for creating a new timer (D-12 / D-18 / D-23).
//
// On success:
//   1. Invalidates the ['timers'] cache so the table refetches the new row.
//   2. Sets usePendingFocusStore.pendingFocusId = newTimer.id so the new row's
//      DescriptionCell auto-focuses its input on mount (D-23).
//
// Args: { projectId: null; description: string }
//   - Phase 4 always calls with { projectId: null, description: '' }
//   - projectId assignment is Phase 5 (D-18)
//
// IMPORTANT: pendingFocusId is set INSIDE onSuccess (not in mutate caller) so
// the ID is available before the cache invalidation refetch resolves. The cell's
// mount effect reads it and calls clear() after focus() — see usePendingFocusStore.
//
// Refs:
//   - 04-CONTEXT.md D-12 (mutation invalidation pattern)
//   - 04-CONTEXT.md D-18 (create args + Phase 5 deferral)
//   - 04-CONTEXT.md D-23 (auto-focus via pendingFocusId set in onSuccess)
//   - 04-RESEARCH.md § Pattern 2 (canonical useMutation template)

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Timer } from '@shared/ipc'
import { timersQueryKey } from './useTimers'
import { usePendingFocusStore } from '@/stores/usePendingFocusStore'

/** Mutation to create a new timer. On success, sets the auto-focus marker (D-23). */
export function useCreateTimer() {
  const qc = useQueryClient()
  return useMutation<Timer, Error, { projectId: number | null; description: string }>({
    mutationFn: (args) => window.api.timers.create(args),
    onSuccess: async (newTimer) => {
      // Set pending focus BEFORE invalidating so the store is ready when the
      // refetch resolves and React reconciles the new row.
      usePendingFocusStore.getState().set(newTimer.id)
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
