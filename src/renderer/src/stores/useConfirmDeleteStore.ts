// src/renderer/src/stores/useConfirmDeleteStore.ts
// Zustand v5 store for the delete-confirmation modal state (D-13 / D-24).
//
// Opens the shared <ConfirmDialog /> by calling open(id, label) from DeleteCell.
// The dialog closes itself by calling close() after the mutation settles (either
// cancel or confirm path).
//
// NO middleware (no devtools, no persist) per D-13.
//
// Refs:
//   - 04-CONTEXT.md D-13 (Zustand for transient UI state; no middleware)
//   - 04-CONTEXT.md D-24 (ConfirmDialog pattern — opens via Zustand slice)
//   - 04-RESEARCH.md § Pattern 9 (useConfirmDeleteStore template)

import { create } from 'zustand'

interface ConfirmDeleteState {
  /**
   * Non-null while the confirmation dialog is open. `id` is the timer to
   * delete; `label` is the description shown in the dialog body.
   */
  pendingDelete: { id: number; label: string } | null
  /** Open the dialog for the timer with the given id and description label. */
  open: (id: number, label: string) => void
  /** Close the dialog and clear the pending state. */
  close: () => void
}

export const useConfirmDeleteStore = create<ConfirmDeleteState>((set) => ({
  pendingDelete: null,
  open: (id, label) => set({ pendingDelete: { id, label } }),
  close: () => set({ pendingDelete: null }),
}))
