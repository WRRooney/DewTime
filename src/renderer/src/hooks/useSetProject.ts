
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to assign a project to a timer. Invalidates the timers cache on success. */
export function useSetProject() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; projectId: number | null }>({
    mutationFn: ({ id, projectId }) => window.api.timers.setProject(id, projectId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
