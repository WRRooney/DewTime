// src/renderer/src/hooks/useProjects.ts
// TanStack Query v5 hook for the projects list (D-15).
//
// Wraps window.api.projects.list() in a useQuery with a shared queryKey so all
// mutation hooks can invalidate the same cache entry on success.
//
// `staleTime: 30_000` (ms) — projects change rarely; 30 s is safe.
// Mutations (useCreateProject, useUpdateProjectNumber) invalidate this key.
//
// Refs:
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state)
//   - src/renderer/src/hooks/useTimers.ts (pattern source)

import { useQuery } from '@tanstack/react-query'
import type { Project } from '@shared/ipc'

/** Shared query key for projects queries and mutation invalidations. */
export const projectsQueryKey = ['projects'] as const

/**
 * Fetches the full projects list via `window.api.projects.list()`.
 * staleTime: 30_000 — projects change rarely; 30 s is safe.
 * Mutations (useCreateProject, useUpdateProjectNumber) invalidate this key.
 */
export function useProjects() {
  return useQuery<Project[]>({
    queryKey: projectsQueryKey,
    queryFn: () => window.api.projects.list(),
    staleTime: 30_000,
  })
}
