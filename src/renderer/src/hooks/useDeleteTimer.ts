// The main-side handler stops the timer if running, then deletes it in a
// transaction. SQLite cascades the delete to time_entries via FK ON DELETE CASCADE.

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
