
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
