// @vitest-environment jsdom
// src/renderer/src/components/DailyTotal.test.tsx
// Computation test for DailyTotal's all-timers base + live-tick total formula.
//
// totalSeconds is COMPLETED-only (SQL excludes the open running entry), so base
// sums EVERY timer and the running entry's live time is added once via the tick.
//
// Tests the critical invariants:
//   1. Running + tick: total = sum(ALL timers' totalSeconds) + tick.elapsedSeconds
//      (the running timer's completed totalSeconds IS in base; the live tick is
//      disjoint from it — no double-count)
//   2. Running but no matching tick: total = sum(ALL timers' totalSeconds)
//      (open entry contributes 0 until its first tick)
//   3. Running timer with prior completed entries: those completed seconds stay
//      in the total while running (regression — previously dropped)
//   4. Zero timers: renders "00:00:00"
//   5. isLoading: renders "—:—:—" muted placeholder
//
// Refs:
//   - 06-04-PLAN.md Task 2 <behavior>
//   - 06-RESEARCH.md § Pattern 5, § E5, Pitfall 3
//   - 06-UI-SPEC.md § Daily and weekly total readouts

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { renderWithProviders } from '@renderer/test-utils/render-with-providers'
import { makeMockApi } from '@renderer/test-utils/mock-api'
import { useTickStore } from '@/stores/useTickStore'
import { formatDuration } from '@/utils/format-duration'
import type { Timer } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'

// DailyTotal is imported after the test file is written (TDD RED: import will fail
// gracefully once the component exists)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DailyTotal: (props: { fromEpoch: number; toEpoch: number }) => JSX.Element

beforeEach(async () => {
  // Dynamic import so that the test file can be parsed even before the component exists.
  // In GREEN phase this will resolve correctly.
  const mod = await import('./DailyTotal')
  DailyTotal = mod.DailyTotal
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FROM_EPOCH = 1_717_200_000 as EpochSeconds
const TO_EPOCH   = 1_717_286_400 as EpochSeconds

/** A non-running timer with known totalSeconds */
const nonRunningTimer = (id: number, totalSeconds: number): Timer => ({
  id,
  project_id: null,
  description: `Timer ${id}`,
  notes: '',
  created_at: FROM_EPOCH,
  offset: null,
  totalSeconds,
  running: false,
})

/** A running timer with known at-fetch totalSeconds */
const runningTimer = (id: number, totalSeconds: number): Timer => ({
  id,
  project_id: null,
  description: `Running timer ${id}`,
  notes: '',
  created_at: FROM_EPOCH,
  offset: null,
  totalSeconds,
  running: true,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetTickStore(): void {
  useTickStore.setState({ tick: null })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DailyTotal — total computation', () => {
  beforeEach(() => {
    resetTickStore()
  })

  it('running timer WITH matching tick: total = ALL timers base + tick.elapsedSeconds (completed time kept, live disjoint)', async () => {
    const nonRunning1 = nonRunningTimer(1, 3600)  // 1 hour completed
    const nonRunning2 = nonRunningTimer(2, 1800)  // 30 min completed
    const running = runningTimer(3, 500)           // 500s of COMPLETED entries today, now running again
    const tickElapsed = 750                        // live elapsed of the open entry

    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([nonRunning1, nonRunning2, running]),
      },
    })
    useTickStore.setState({ tick: { timerId: running.id, elapsedSeconds: tickElapsed } })

    // base includes running.totalSeconds (its completed time); tick adds the
    // disjoint open-entry elapsed. No double-count because totalSeconds excludes
    // the open entry.
    const expectedTotal =
      nonRunning1.totalSeconds + nonRunning2.totalSeconds + running.totalSeconds + tickElapsed

    renderWithProviders(
      <DailyTotal fromEpoch={FROM_EPOCH} toEpoch={TO_EPOCH} />,
    )

    await waitFor(() => {
      expect(screen.getByText(formatDuration(expectedTotal))).toBeInTheDocument()
    })
  })

  it('running timer with NO matching tick: total = sum(ALL timers totalSeconds), open entry contributes 0', async () => {
    const nonRunning = nonRunningTimer(1, 1000)
    const running = runningTimer(2, 200)

    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([nonRunning, running]),
      },
    })
    // tick is null — open entry's live time not yet available
    useTickStore.setState({ tick: null })

    const expectedTotal = nonRunning.totalSeconds + running.totalSeconds

    renderWithProviders(
      <DailyTotal fromEpoch={FROM_EPOCH} toEpoch={TO_EPOCH} />,
    )

    await waitFor(() => {
      expect(screen.getByText(formatDuration(expectedTotal))).toBeInTheDocument()
    })
  })

  it('running timer with tick for a DIFFERENT timer: total = sum(ALL timers totalSeconds), no live contribution', async () => {
    const nonRunning = nonRunningTimer(1, 500)
    const running = runningTimer(2, 300)

    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([nonRunning, running]),
      },
    })
    // Tick is for a different timer — should not contribute to the total
    useTickStore.setState({ tick: { timerId: 99, elapsedSeconds: 9999 } })

    const expectedTotal = nonRunning.totalSeconds + running.totalSeconds

    renderWithProviders(
      <DailyTotal fromEpoch={FROM_EPOCH} toEpoch={TO_EPOCH} />,
    )

    await waitFor(() => {
      expect(screen.getByText(formatDuration(expectedTotal))).toBeInTheDocument()
    })
  })

  it('regression: a running timer keeps its prior completed time in the total', async () => {
    // Single timer: 600s completed earlier today, now running again. Before the
    // fix this rendered just the live tick (completed 600 dropped).
    const running = runningTimer(1, 600)
    const tickElapsed = 30

    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([running]),
      },
    })
    useTickStore.setState({ tick: { timerId: running.id, elapsedSeconds: tickElapsed } })

    const expectedTotal = running.totalSeconds + tickElapsed // 630, not 30

    renderWithProviders(
      <DailyTotal fromEpoch={FROM_EPOCH} toEpoch={TO_EPOCH} />,
    )

    await waitFor(() => {
      expect(screen.getByText(formatDuration(expectedTotal))).toBeInTheDocument()
    })
  })

  it('zero timers: renders 00:00:00', async () => {
    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([]),
      },
    })

    renderWithProviders(
      <DailyTotal fromEpoch={FROM_EPOCH} toEpoch={TO_EPOCH} />,
    )

    await waitFor(() => {
      expect(screen.getByText('00:00:00')).toBeInTheDocument()
    })
  })

  it('no running timer: total = sum of all timers totalSeconds', async () => {
    const t1 = nonRunningTimer(1, 100)
    const t2 = nonRunningTimer(2, 250)
    const t3 = nonRunningTimer(3, 50)

    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([t1, t2, t3]),
      },
    })

    renderWithProviders(
      <DailyTotal fromEpoch={FROM_EPOCH} toEpoch={TO_EPOCH} />,
    )

    await waitFor(() => {
      expect(screen.getByText(formatDuration(400))).toBeInTheDocument()
    })
  })
})

describe('DailyTotal — loading state', () => {
  it('while isLoading renders the muted placeholder —:—:—', async () => {
    // Never resolves — keeps isLoading=true indefinitely
    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockReturnValue(new Promise(() => {})),
      },
    })

    renderWithProviders(
      <DailyTotal fromEpoch={FROM_EPOCH} toEpoch={TO_EPOCH} />,
    )

    // Should render the loading placeholder immediately while the query is pending
    await waitFor(() => {
      expect(screen.getByText('—:—:—')).toBeInTheDocument()
    })
  })
})
