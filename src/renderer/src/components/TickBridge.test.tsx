// @vitest-environment jsdom
// src/renderer/src/components/TickBridge.test.tsx
// Tests for the TickBridge subscribe/unsubscribe contract (D-32).
//
// Contract under test:
//   1. Mount → window.api.tick.subscribe called once with setTick as the callback
//   2. Unmount → the unsubscribe fn returned by subscribe is called;
//                useTickStore.getState().tick is null after unmount
//
// Test fixture pattern:
//   - Sets window.api directly (not via makeMockApi) because mock-api needs a
//     separate update to include the `tick` namespace — this test establishes
//     the precedent for plan 04-07's cell tests (D-32).
//   - useTickStore state is reset in beforeEach via useTickStore.setState so
//     state never leaks across cases (T-04-StoreLeak mitigation).
//
// Refs:
//   - 04-CONTEXT.md D-09 (TickBridge subscriber contract)
//   - 04-CONTEXT.md D-32 (Phase 4 renderer test coverage — subscribe/unsubscribe here)
//   - 04-RESEARCH.md § Pattern 4 (canonical TickBridge template)
//   - 04-RESEARCH.md § Pitfall 1 (cleanup non-negotiable — this test enforces it)
//   - Threat model T-04-StoreLeak (beforeEach reset precedent)

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { TickBridge } from './TickBridge'
import { useTickStore } from '@/stores/useTickStore'
import type { ElectronApi, TickEventPayload } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a minimal window.api stub with a controlled tick.subscribe implementation. */
function makeTickApi(unsubscribeFn: ReturnType<typeof vi.fn>) {
  return {
    subscribe: vi.fn((_cb: (payload: TickEventPayload) => void) => unsubscribeFn),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TickBridge', () => {
  beforeEach(() => {
    // Reset Zustand tick store state between test cases (T-04-StoreLeak).
    useTickStore.setState({ tick: null })
  })

  it('calls window.api.tick.subscribe once on mount', () => {
    const unsubscribe = vi.fn()
    const tickApi = makeTickApi(unsubscribe)

    // Install a partial window.api with just the tick namespace exercised here.
    // Cast via unknown since we only need the tick slice for this test.
    window.api = { tick: tickApi } as unknown as ElectronApi

    renderWithProviders(<TickBridge />)

    expect(tickApi.subscribe).toHaveBeenCalledTimes(1)
    // The subscribe callback should be the setTick function (a function).
    expect(tickApi.subscribe).toHaveBeenCalledWith(expect.any(Function))
  })

  it('calls unsubscribe + clears tick store on unmount', () => {
    const unsubscribe = vi.fn()
    const tickApi = makeTickApi(unsubscribe)

    window.api = { tick: tickApi } as unknown as ElectronApi

    // Seed the tick store with non-null state to verify clearTick fires.
    useTickStore.setState({ tick: { timerId: 1, elapsedSeconds: 42 } })

    const { unmount } = renderWithProviders(<TickBridge />)

    // Verify subscribe was called so the unsubscribe is wired.
    expect(tickApi.subscribe).toHaveBeenCalledTimes(1)

    unmount()

    // Cleanup contract: unsubscribe fn from subscribe() must be called.
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    // clearTick() must have been called — tick store is null after unmount.
    expect(useTickStore.getState().tick).toBeNull()
  })
})
