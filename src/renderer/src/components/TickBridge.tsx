// src/renderer/src/components/TickBridge.tsx
// Mount-once side-effect component that bridges the main-process tick:update
// IPC channel to the renderer-side Zustand tick store.
//
// Mounted ONCE inside <App> (plan 04-07). Subscribes on mount; unsubscribes
// on unmount (App teardown or HMR). Returns null — purely a side-effect component.
//
// Subscribe flow (D-09):
//   1. Select primitive setTick + clearTick selectors (avoid object selectors —
//      RESEARCH § Pitfall 2; Zustand returns stable refs for setters so the
//      useEffect dep array is stable across re-renders).
//   2. useEffect: call window.api.tick.subscribe(setTick); store the returned
//      unsubscribe function in the closure.
//   3. Cleanup: call unsubscribe() to remove the ipcRenderer listener, then
//      clearTick() so stale tick data doesn't persist across HMR cycles or
//      test teardowns (T-04-StoreLeak mitigation).
//
// CRITICAL: The cleanup function is non-negotiable (RESEARCH § Pitfall 1 —
// closure-stale ipcRenderer.on accumulates listeners across HMR reloads and
// leaks across test cases when the component unmounts).
//
// Refs:
//   - 04-CONTEXT.md D-09 (TickBridge shape + subscriber contract)
//   - 04-RESEARCH.md § Pattern 4 lines 680-701 (canonical TickBridge template)
//   - 04-RESEARCH.md § Pitfall 1 lines 1054-1066 (cleanup non-negotiable)
//   - 04-RESEARCH.md § Pitfall 2 (primitive selectors to avoid re-render loops)
//   - Threat model T-04-08 (ipcRenderer listener leak mitigation)
//   - Threat model T-04-StoreLeak (Zustand state leak across test cases)

import { useEffect } from 'react'
import { useTickStore } from '@/stores/useTickStore'

/**
 * Mounted ONCE inside <App>. Subscribes to the main process's `tick:update`
 * channel on mount; unsubscribes and clears the tick store on unmount.
 *
 * Returns null — pure side-effect component; renders nothing.
 */
export function TickBridge(): null {
  const setTick = useTickStore((s) => s.setTick)
  const clearTick = useTickStore((s) => s.clearTick)

  useEffect(() => {
    const unsubscribe = window.api.tick.subscribe(setTick)
    return () => {
      unsubscribe()
      clearTick()
    }
  }, [setTick, clearTick])

  return null
}
