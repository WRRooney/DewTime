
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to set a timer's duration offset. Invalidates the timers cache on success. */
export function useSetOffset() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; offsetSeconds: number | null }>({
    mutationFn: ({ id, offsetSeconds }) => window.api.timers.setOffset(id, offsetSeconds),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
