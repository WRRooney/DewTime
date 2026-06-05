// src/renderer/src/hooks/useDeleteTimer.ts
// TanStack Query v5 mutation for deleting a timer (D-12 / D-17).
//
// Delegates to window.api.timers.delete(id). The main-side handler wraps
// stopActive() + repo delete() in a transaction so the tick stream and
// in-memory cache are cleaned up before the row is removed (D-17 guard).
// SQLite cascades the delete to time_entries via FK ON DELETE CASCADE (D-17).
//
// The ConfirmDialog (plan 04-07) calls this mutation after the user confirms.
// On success the dialog closes via useConfirmDeleteStore.close() in the
// component — the hook itself does not touch the confirm store.
//
// Refs:
//   - 04-CONTEXT.md D-12 (mutation invalidation pattern)
//   - 04-CONTEXT.md D-17 (delete cascades; handler guards against running timer)
//   - 04-RESEARCH.md § Pattern 2 (canonical useMutation template)

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to delete a timer (and its time_entries via FK cascade). */
export function useDeleteTimer() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (id: number) => window.api.timers.delete(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
