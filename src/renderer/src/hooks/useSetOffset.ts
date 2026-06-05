// src/renderer/src/hooks/useSetOffset.ts
// TanStack Query v5 mutation for setting a timer's duration offset (D-15 / FIELD-04).
//
// Called by TimestampEditorDialog on blur of the offset input. Invalidates ['timers']
// so DurationCell totalSeconds refreshes with the new offset.
//
// Args: { id: number; offsetSeconds: number | null }
//
// Refs:
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state)
//   - src/renderer/src/hooks/useSetDescription.ts (mutation pattern source)

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to set a timer's duration offset. Invalidates the timers cache on success. */
export function useSetOffset() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; offsetSeconds: number | null }>({
    mutationFn: ({ id, offsetSeconds }) => window.api.timers.setOffset(id, offsetSeconds),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
