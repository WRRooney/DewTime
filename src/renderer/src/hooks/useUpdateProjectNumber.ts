// src/renderer/src/hooks/useUpdateProjectNumber.ts
// TanStack Query v5 mutation for updating a project's number (D-15 / PROJ-03).
//
// Called by ProjectNumberCell on Enter or blur commit.
//
// Args: { id: number; number: string | null }
//
// Refs:
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state)
//   - src/renderer/src/hooks/useSetDescription.ts (mutation pattern source)

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
