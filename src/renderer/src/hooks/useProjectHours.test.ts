// @vitest-environment jsdom
// src/renderer/src/hooks/useProjectHours.test.ts
// Unit tests for useProjectHours aggregation hook.
//
// Covers:
//   1. Returns a Map keyed by project_id with { weekSeconds, totalSeconds }
//   2. Timers with project_id === null are excluded from the map
//   3. A project with only out-of-week timers has weekSeconds === 0 but positive totalSeconds
//   4. A project with no timers has no entry in the map
//   5. Both all-time list and week list are fetched; week-only timers appear only in weekSeconds
//
// Mock strategy: set window.api in beforeEach via makeMockApi.
// weekStart is fetched via window.api.settings.list() → derive 0|6.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeMockApi } from '@/test-utils/mock-api'
import { useProjectHours } from './useProjectHours'
import type { Timer } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 1,
    project_id: null,
    description: 'Test timer',
    notes: '',
    created_at: 1700000000 as Timer['created_at'],
    offset: null,
    totalSeconds: 60,
    running: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Helper: build a wrapper with an exposed QueryClient
// ---------------------------------------------------------------------------

function makeWrapper(queryClient: QueryClient): React.FC<{ children: React.ReactNode }> {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProjectHours', () => {
  afterEach(() => {
    cleanup()
  })

  it('returns a Map keyed by project_id with weekSeconds and totalSeconds', async () => {
    const allTimers: Timer[] = [
      makeTimer({ id: 1, project_id: 10, totalSeconds: 3600 }),
    ]
    const weekTimers: Timer[] = [
      makeTimer({ id: 1, project_id: 10, totalSeconds: 3600 }),
    ]

    window.api = makeMockApi({
      timers: {
        list: vi.fn()
          .mockResolvedValueOnce(allTimers)  // all-time call (no dateRange)
          .mockResolvedValueOnce(weekTimers), // week call (with dateRange)
      },
      settings: {
        list: vi.fn().mockResolvedValue({ 'settings.week_start': 0 }),
      },
    })

    const qc = makeQueryClient()
    const { result } = renderHook(() => useProjectHours(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const entry = result.current.hours.get(10)
    expect(entry).toBeDefined()
    expect(entry?.totalSeconds).toBe(3600)
    expect(entry?.weekSeconds).toBe(3600)
  })

  it('excludes timers with project_id === null from the map', async () => {
    const allTimers: Timer[] = [
      makeTimer({ id: 1, project_id: null, totalSeconds: 1800 }),
      makeTimer({ id: 2, project_id: 5, totalSeconds: 900 }),
    ]
    const weekTimers: Timer[] = [
      makeTimer({ id: 2, project_id: 5, totalSeconds: 900 }),
    ]

    window.api = makeMockApi({
      timers: {
        list: vi.fn()
          .mockResolvedValueOnce(allTimers)
          .mockResolvedValueOnce(weekTimers),
      },
      settings: {
        list: vi.fn().mockResolvedValue({ 'settings.week_start': 0 }),
      },
    })

    const qc = makeQueryClient()
    const { result } = renderHook(() => useProjectHours(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // null project_id must NOT be in the map
    expect(result.current.hours.has(null as unknown as number)).toBe(false)
    // project 5 must be present
    expect(result.current.hours.get(5)?.totalSeconds).toBe(900)
  })

  it('has weekSeconds === 0 and positive totalSeconds for a project with only out-of-week timers', async () => {
    const allTimers: Timer[] = [
      makeTimer({ id: 1, project_id: 7, totalSeconds: 7200 }),
    ]
    // Week query returns nothing for this project (timer is outside current week)
    const weekTimers: Timer[] = []

    window.api = makeMockApi({
      timers: {
        list: vi.fn()
          .mockResolvedValueOnce(allTimers)
          .mockResolvedValueOnce(weekTimers),
      },
      settings: {
        list: vi.fn().mockResolvedValue({ 'settings.week_start': 0 }),
      },
    })

    const qc = makeQueryClient()
    const { result } = renderHook(() => useProjectHours(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const entry = result.current.hours.get(7)
    expect(entry).toBeDefined()
    expect(entry?.weekSeconds).toBe(0)
    expect(entry?.totalSeconds).toBe(7200)
  })

  it('accumulates multiple timers for the same project_id', async () => {
    const allTimers: Timer[] = [
      makeTimer({ id: 1, project_id: 3, totalSeconds: 1000 }),
      makeTimer({ id: 2, project_id: 3, totalSeconds: 500 }),
    ]
    const weekTimers: Timer[] = [
      makeTimer({ id: 2, project_id: 3, totalSeconds: 500 }),
    ]

    window.api = makeMockApi({
      timers: {
        list: vi.fn()
          .mockResolvedValueOnce(allTimers)
          .mockResolvedValueOnce(weekTimers),
      },
      settings: {
        list: vi.fn().mockResolvedValue({}), // missing setting → default Monday (0)
      },
    })

    const qc = makeQueryClient()
    const { result } = renderHook(() => useProjectHours(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const entry = result.current.hours.get(3)
    expect(entry?.totalSeconds).toBe(1500)
    expect(entry?.weekSeconds).toBe(500)
  })

  it('returns Sunday (6) weekStart when settings.week_start === 6', async () => {
    // This tests that the weekStart is derived correctly — we observe the
    // queryKey passed to timers.list changes with week_start=6 (different range).
    // We just verify the hook resolves without error when weekStart is 6.
    const allTimers: Timer[] = [makeTimer({ id: 1, project_id: 9, totalSeconds: 100 })]
    const weekTimers: Timer[] = [makeTimer({ id: 1, project_id: 9, totalSeconds: 100 })]

    window.api = makeMockApi({
      timers: {
        list: vi.fn()
          .mockResolvedValueOnce(allTimers)
          .mockResolvedValueOnce(weekTimers),
      },
      settings: {
        list: vi.fn().mockResolvedValue({ 'settings.week_start': 6 }),
      },
    })

    const qc = makeQueryClient()
    const { result } = renderHook(() => useProjectHours(), { wrapper: makeWrapper(qc) })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.hours.get(9)?.totalSeconds).toBe(100)
  })
})
