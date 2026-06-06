// Mount-once side-effect component that bridges the main-process tick:update
// IPC channel to the renderer-side Zustand tick store.
//
// Subscribe flow:
//   1. Select primitive setTick + clearTick selectors (avoid object selectors —
//      Zustand returns stable refs for setters so the useEffect dep array is
//      stable across re-renders).
//   2. useEffect: call window.api.tick.subscribe(setTick); store the returned
//      unsubscribe function in the closure.
//   3. Cleanup: call unsubscribe() to remove the ipcRenderer listener, then
//      clearTick() so stale tick data doesn't persist across HMR cycles or
//      test teardowns.
//
// CRITICAL: The cleanup function is non-negotiable — closure-stale
// ipcRenderer.on accumulates listeners across HMR reloads and leaks across
// test cases when the component unmounts.

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
