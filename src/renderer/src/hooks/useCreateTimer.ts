import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Timer } from '@shared/ipc'
import { timersQueryKey } from './useTimers'
import { usePendingFocusStore } from '@/stores/usePendingFocusStore'

/** Mutation to create a new timer. Sets the auto-focus marker before invalidating so
 * DescriptionCell focuses when the new row mounts. */
export function useCreateTimer() {
  const qc = useQueryClient()
  return useMutation<Timer, Error, { projectId: number | null; description: string }>({
    mutationFn: (args) => window.api.timers.create(args),
    onSuccess: async (newTimer) => {
      // Set pending focus before invalidating so the store is ready when
      // React reconciles the new row from the refetch.
      usePendingFocusStore.getState().set(newTimer.id)
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
