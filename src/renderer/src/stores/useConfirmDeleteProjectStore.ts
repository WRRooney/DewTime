import { create } from 'zustand'

interface ConfirmDeleteProjectState {
  /**
   * Non-null while the confirmation dialog is open. `id` is the project to
   * delete; `name` is shown in the dialog body; `timerCount` drives the
   * count-aware copy ("N timers will be unassigned").
   */
  pendingDelete: { id: number; name: string; timerCount: number } | null
  /** Open the dialog for the project with the given id, name, and timer count. */
  open: (id: number, name: string, timerCount: number) => void
  /** Close the dialog and clear the pending state. */
  close: () => void
}

export const useConfirmDeleteProjectStore = create<ConfirmDeleteProjectState>((set) => ({
  pendingDelete: null,
  open: (id, name, timerCount) => set({ pendingDelete: { id, name, timerCount } }),
  close: () => set({ pendingDelete: null }),
}))
