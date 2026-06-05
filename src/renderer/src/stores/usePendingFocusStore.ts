// src/renderer/src/stores/usePendingFocusStore.ts
// Zustand v5 store for the auto-focus marker used to focus the description
// input on a newly-created timer row (D-23).
//
// Flow:
//   1. useCreateTimer.onSuccess sets pendingFocusId = newTimer.id
//   2. DescriptionCell mount effect reads pendingFocusId; if it matches
//      the cell's timer.id it calls setIsEditing(true) + input.focus()
//   3. After focus(), the cell's mount effect calls clear() — NOT onSuccess —
//      so React commits the new DOM before the focus call fires.
//
// IMPORTANT: clear() must be called INSIDE the cell's mount effect, not in
// useCreateTimer.onSuccess. If cleared too early the new row's DescriptionCell
// may not have mounted yet, silently swallowing the focus marker.
//
// NO middleware (no devtools, no persist) per D-13.
//
// Refs:
//   - 04-CONTEXT.md D-23 (auto-focus via pendingFocusId Zustand slice)
//   - 04-CONTEXT.md D-13 (Zustand for transient UI state; no middleware)
//   - 04-RESEARCH.md § Pitfall 8 (pending-focus cleared in cell mount, not onSuccess)

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
