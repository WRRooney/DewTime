// src/renderer/src/hooks/useCreateProject.ts
// TanStack Query v5 mutation for creating a new project (D-15 / PROJ-01).
//
// On success:
//   1. Invalidates the ['projects'] cache FIRST (RESEARCH Pitfall 6 — the caller
//      chains useSetProject after this onSuccess resolves; the new project must be
//      visible in useProjects() before setProject is called).
//   2. Does NOT invalidate ['timers'] here — the caller's subsequent useSetProject
//      mutation handles that.
//
// Args: { name: string; number: string | null }
//
// Refs:
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state)
//   - 05-RESEARCH.md Pitfall 6 (invalidate ['projects'] first before setProject)
//   - src/renderer/src/hooks/useCreateTimer.ts (invalidation pattern source)

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Project } from '@shared/ipc'
import { projectsQueryKey } from './useProjects'

/** Mutation to create a new project. Invalidates the projects cache on success. */
export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation<Project, Error, { name: string; number: string | null }>({
    mutationFn: ({ name, number }) => window.api.projects.create(name, number),
    onSuccess: async () => {
      // Invalidate ['projects'] FIRST — ProjectCell must find the new project
      // in useProjects() before setProject is called (RESEARCH Pitfall 6).
      await qc.invalidateQueries({ queryKey: projectsQueryKey })
      // ['timers'] invalidated by the subsequent useSetProject mutation — caller
      // chains setProject after this onSuccess resolves.
    },
  })
}
