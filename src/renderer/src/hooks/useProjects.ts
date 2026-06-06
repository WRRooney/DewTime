import { useQuery } from '@tanstack/react-query'
import type { Project } from '@shared/ipc'

/** Shared query key for projects queries and mutation invalidations. */
export const projectsQueryKey = ['projects'] as const

/** Fetches the projects list. staleTime 30 s — projects change rarely. */
export function useProjects() {
  return useQuery<Project[]>({
    queryKey: projectsQueryKey,
    queryFn: () => window.api.projects.list(),
    staleTime: 30_000,
  })
}
