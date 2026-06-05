// src/renderer/src/hooks/useSetNotes.ts
// TanStack Query v5 mutation for setting a timer's notes (D-15 / FIELD-05).
//
// Called by TimestampEditorDialog on blur of the notes textarea. Invalidates ['timers']
// so any notes-dependent UI refreshes after save.
//
// Args: { id: number; notes: string | null }
//   - The API method timers.setNotes takes a non-null string — null is coerced to ''.
//
// Refs:
//   - 05-CONTEXT.md D-15 (TanStack Query for all new server-state)
//   - src/renderer/src/hooks/useSetDescription.ts (mutation pattern source)

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { timersQueryKey } from './useTimers'

/** Mutation to set a timer's notes. Coerces null → '' for the API. Invalidates timers cache. */
export function useSetNotes() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: number; notes: string | null }>({
    mutationFn: ({ id, notes }) => window.api.timers.setNotes(id, notes ?? ''),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: timersQueryKey })
    },
  })
}
