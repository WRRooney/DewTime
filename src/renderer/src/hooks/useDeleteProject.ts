// The main-side handler deletes the project. SQLite FK ON DELETE SET NULL
// unassigns any timers that referenced the project automatically.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsQueryKey } from './useProjects'

/** Mutation to delete a project (timers are unassigned via FK ON DELETE SET NULL). */
export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: (id: number) => window.api.projects.delete(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}
