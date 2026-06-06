import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'
import { entriesNamespaceKey } from './useEntriesForTimer'

/**
 * Mutation to delete a stopped time entry. Refreshes the timers cache (so the
 * duration total updates) and the dialog's entry list on success. The main side
 * rejects deleting a running entry.
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
