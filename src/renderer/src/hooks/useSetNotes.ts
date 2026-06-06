
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to set a timer's notes. Coerces null → '' for the API. Invalidates timers cache. */
export function useSetNotes() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; notes: string | null }>({
    mutationFn: ({ id, notes }) => window.api.timers.setNotes(id, notes ?? ''),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
