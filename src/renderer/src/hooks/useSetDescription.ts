// src/renderer/src/hooks/useSetDescription.ts
// TanStack Query v5 mutation for updating a timer's description (D-12 / D-25).
//
// Called by DescriptionCell on Enter or blur commit. The cell trims whitespace
// before calling mutate — the hook passes the already-trimmed string through.
//
// Args: { id: number; description: string }
//
// Refs:
//   - 04-CONTEXT.md D-12 (mutation invalidation pattern)
//   - 04-CONTEXT.md D-25 (description edit UX — Enter/blur commit; Escape revert)
//   - 04-RESEARCH.md § Pattern 2 (canonical useMutation template)

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to update a timer's description. Invalidates the timers cache on success. */
export function useSetDescription() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; description: string }>({
    mutationFn: ({ id, description }) => window.api.timers.setDescription(id, description),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
