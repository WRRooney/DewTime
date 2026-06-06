
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsQueryKey } from './useProjects'

/** Mutation to update a project's number. Invalidates the projects cache on success. */
export function useUpdateProjectNumber() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; number: string | null }>({
    mutationFn: ({ id, number }) => window.api.projects.updateNumber(id, number),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: projectsQueryKey })
    },
  })
}
