import { create } from 'zustand'

interface ConfirmDeleteEntryState {
  /**
   * Non-null while the entry-delete confirmation dialog is open.
   * `id` is the time entry to delete; `label` is the display label shown in the dialog.
   */
  pendingDelete: { id: number; label: string } | null
  /** Open the dialog for the entry with the given id and label. */
  open: (id: number, label: string) => void
  /** Close the dialog and clear the pending state. */
  close: () => void
}

export const useConfirmDeleteEntryStore = create<ConfirmDeleteEntryState>((set) => ({
  pendingDelete: null,
  open: (id, label) => set({ pendingDelete: { id, label } }),
  close: () => set({ pendingDelete: null }),
}))
