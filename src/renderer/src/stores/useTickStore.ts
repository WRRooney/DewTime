// Zustand store for the live tick payload pushed from main each second.
// Only DurationCell reads tick via primitive selector `useTickStore(s => s.tick)`.
// <TickBridge /> calls window.api.tick.subscribe(setTick) in a useEffect and
// clears on unmount — keeping tick lifecycle tied to the component tree, not module load.

import { create } from 'zustand'
import type { TickEventPayload } from '@shared/ipc'

// Re-exported for consumer convenience — reduces import churn if the shared type ever moves.
export type { TickEventPayload }

interface TickState {
  /** Current tick payload from the `tick:update` channel, or null when idle. */
  tick: TickEventPayload | null
  /** Called by TickBridge on every `tick:update` event. */
  setTick: (t: TickEventPayload) => void
  /** Called by TickBridge on unmount — resets tick to null so stale state doesn't linger. */
  clearTick: () => void
}

export const useTickStore = create<TickState>((set) => ({
  tick: null,
  setTick: (t) => set({ tick: t }),
  clearTick: () => set({ tick: null }),
}))
