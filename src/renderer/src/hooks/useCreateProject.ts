import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@shared/ipc'
import { projectsQueryKey } from './useProjects'

/** Mutation to create a new project. Invalidates the projects cache on success so a
 * subsequent setProject call sees the new project in useProjects(). */
export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation<Project, Error, { name: string; number: string | null }>({
    mutationFn: ({ name, number }) => window.api.projects.create(name, number),
    onSuccess: async () => {
      // Invalidate ['projects'] before returning — callers chain setProject after
      // this resolves, so the new project must be visible in useProjects() first.
      await qc.invalidateQueries({ queryKey: projectsQueryKey })
      // ['timers'] is invalidated by the subsequent useSetProject mutation.
    },
  })
}
