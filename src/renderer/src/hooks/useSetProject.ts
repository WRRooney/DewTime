// src/renderer/src/hooks/useSetProject.ts
// TanStack Query v5 mutation for assigning a project to a timer (D-15 / PROJ-04).
//
// Called by ProjectCell after creating or selecting a project. Invalidates ['timers']
// so the timer table row reflects the new project assignment.
//
// Args: { id: number; projectId: number | null }
//
// Refs:
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state)
//   - src/renderer/src/hooks/useSetDescription.ts (mutation pattern source)

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
