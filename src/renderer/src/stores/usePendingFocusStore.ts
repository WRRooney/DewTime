// Auto-focus flow for newly created timer rows:
//   1. useCreateTimer.onSuccess sets pendingFocusId = newTimer.id
//   2. DescriptionCell mount effect reads pendingFocusId; if it matches
//      the cell's timer.id it calls setIsEditing(true) + input.focus()
//   3. clear() is called INSIDE the cell's mount effect — not in onSuccess —
//      so React commits the new DOM before the focus call fires. Clearing
//      too early silently swallows the focus marker if the row hasn't mounted yet.

import { create } from 'zustand'

interface PendingFocusState {
  /**
   * The id of the timer whose DescriptionCell should auto-focus on its next
   * mount. Set by useCreateTimer.onSuccess; cleared by the cell after calling
   * focus().
   */
  pendingFocusId: number | null
  /** Mark the timer with `id` as needing auto-focus on its next mount. */
  set: (id: number) => void
  /** Clear the pending focus marker (called inside the cell's mount effect). */
  clear: () => void
}

export const usePendingFocusStore = create<PendingFocusState>((set) => ({
  pendingFocusId: null,
  set: (id) => set({ pendingFocusId: id }),
  clear: () => set({ pendingFocusId: null }),
}))
