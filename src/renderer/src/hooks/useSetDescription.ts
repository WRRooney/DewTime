import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to update a timer's description. Invalidates the timers cache on success. */
export function useSetDescription() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; description: string }>({
    mutationFn: ({ id, description }) => window.api.timers.setDescription(id, description),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
