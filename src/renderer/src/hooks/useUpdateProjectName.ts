import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsQueryKey } from './useProjects'

/** Mutation to update a project's name. Invalidates the projects cache on success. */
export function useUpdateProjectName() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; name: string }>({
    mutationFn: ({ id, name }) => window.api.projects.updateName(id, name),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}
