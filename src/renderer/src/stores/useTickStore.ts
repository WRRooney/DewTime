// src/renderer/src/stores/useTickStore.ts
// Zustand v5 store for the live tick payload pushed from main each second.
//
// Shape (D-09 / D-13):
//   { tick: { timerId: number; elapsedSeconds: number } | null; setTick(v); clearTick() }
//
// Consumer: ONLY DurationCell reads tick via primitive selector `useTickStore(s => s.tick)`.
// Subscribe path: <TickBridge /> (plan 04-06) calls window.api.tick.subscribe(setTick)
// in a useEffect and clears on unmount — keeping tick state lifecycle tied to the
// component tree rather than to module load.
//
// NO middleware (no devtools, no persist) per D-13.
//
// Refs:
//   - 04-CONTEXT.md D-09 (tick store shape + consumer contract)
//   - 04-CONTEXT.md D-13 (Zustand for transient UI state; no middleware)
//   - 04-RESEARCH.md § Pattern 3 (canonical Zustand store template)

import { create } from 'zustand'
import type { TickEventPayload } from '@shared/ipc'

// Re-export TickEventPayload for consumer convenience (consumers import the type
// from here rather than from @shared/ipc directly — reduces import churn if the
// shared type ever moves).
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
