import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'
import { entriesNamespaceKey } from './useEntriesForTimer'

/**
 * Mutation to delete a time entry. Refreshes the timers cache (so the
 * duration total updates) and the dialog's entry list on success. Deleting
 * the running entry also stops the timer (heartbeat + tick stopped server-side).
 */
export function useDeleteEntry() {
  const qc = useQueryClient()
  return useMutation<void, Error, { entryId: number }>({
    mutationFn: ({ entryId }) => window.api.timeEntries.deleteEntry(entryId),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: timersQueryKey }),
        qc.invalidateQueries({ queryKey: entriesNamespaceKey }),
      ])
    },
  })
}
