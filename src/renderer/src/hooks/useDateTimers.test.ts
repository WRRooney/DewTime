// @vitest-environment jsdom
// src/renderer/src/hooks/useDateTimers.test.ts
// Unit tests for useDayTimers and useWeekTimers (D-08, RESEARCH A2 / Pitfall 4).
//
// Covers:
//   1. useDayTimers(from, to) resolves to the mocked Timer[] returned by
//      window.api.timers.list({ fromEpoch: from, toEpoch: to }) (flat preload form).
//   2. useDayTimers queryFn is called with the FLAT { fromEpoch, toEpoch } form
//      (not the dateRange-wrapped form from PATTERNS.md — see plan interfaces note).
//   3. Prefix-invalidation: after invalidateQueries({ queryKey: ['timers'] }),
//      the date-scoped ['timers', { from, to }] query refetches (RESEARCH A2).
//   4. useWeekTimers mirrors the same key and queryFn shape.
//
// Mock strategy (D-33): set window.api in beforeEach via makeMockApi.
// QueryClient is created inline per test so staleTime:0 can be overridden
// for the invalidation test (staleTime:100 means the refetch does not happen
// synchronously — override to 0 for the invalidation assertion).
//
// Refs:
//   - 06-RESEARCH.md § Pattern 3, Pitfall 4, Assumption A2
//   - 06-03-PLAN.md Task 1 acceptance criteria

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { makeMockApi } from '@/test-utils/mock-api'
import { useDayTimers, useWeekTimers } from './useDateTimers'
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

// Fixed epoch bounds for a known day (2025-01-15 local time, arbitrary)
const FROM_EPOCH = 1736899200
const TO_EPOCH = 1736985600

// ---------------------------------------------------------------------------
// Helper: build a wrapper with an exposed QueryClient
// ---------------------------------------------------------------------------

function makeWrapper(queryClient: QueryClient): React.FC<{ children: React.ReactNode }> {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

// ---------------------------------------------------------------------------
// Tests — useDayTimers
// ---------------------------------------------------------------------------

describe('useDayTimers', () => {
  const sampleTimers: Timer[] = [
    makeTimer({ id: 1, description: 'Day timer A' }),
    makeTimer({ id: 2, description: 'Day timer B' }),
  ]

  afterEach(() => {
    cleanup()
  })

  it('resolves to Timer[] returned by window.api.timers.list', async () => {
    window.api = makeMockApi({
      timers: { list: vi.fn().mockResolvedValue(sampleTimers) },
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })

    const { result } = renderHook(
      () => useDayTimers(FROM_EPOCH, TO_EPOCH),
      { wrapper: makeWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(sampleTimers)
  })

  it('calls window.api.timers.list with the FLAT { fromEpoch, toEpoch } form', async () => {
    const mockList = vi.fn().mockResolvedValue(sampleTimers)
    window.api = makeMockApi({ timers: { list: mockList } })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })

    const { result } = renderHook(
      () => useDayTimers(FROM_EPOCH, TO_EPOCH),
      { wrapper: makeWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.isFetched).toBe(true))

    // The queryFn must call window.api.timers.list with the FLAT form:
    // { fromEpoch, toEpoch } — not { dateRange: { fromEpoch, toEpoch } }.
    expect(mockList).toHaveBeenCalledWith({ fromEpoch: FROM_EPOCH, toEpoch: TO_EPOCH })
  })

  it('uses queryKey [\'timers\', { from, to }] — prefix under [\'timers\']', async () => {
    window.api = makeMockApi({
      timers: { list: vi.fn().mockResolvedValue(sampleTimers) },
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })

    const { result } = renderHook(
      () => useDayTimers(FROM_EPOCH, TO_EPOCH),
      { wrapper: makeWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.isFetched).toBe(true))

    // The date-scoped key ['timers', { from, to }] should exist in cache.
    const cached = queryClient.getQueryCache().findAll({
      queryKey: ['timers', { from: FROM_EPOCH, to: TO_EPOCH }],
    })
    expect(cached.length).toBeGreaterThan(0)
  })

  it('refetches after invalidateQueries({ queryKey: [\'timers\'] }) — prefix-invalidation (A2)', async () => {
    // staleTime:0 so the invalidation triggers an immediate refetch.
    const mockList = vi.fn().mockResolvedValue(sampleTimers)
    window.api = makeMockApi({ timers: { list: mockList } })

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false, staleTime: 0 },
      },
    })

    const { result } = renderHook(
      () => useDayTimers(FROM_EPOCH, TO_EPOCH),
      { wrapper: makeWrapper(queryClient) },
    )

    // Wait for the initial fetch to complete.
    await waitFor(() => expect(result.current.isFetched).toBe(true))

    const callsAfterInitial = mockList.mock.calls.length
    expect(callsAfterInitial).toBeGreaterThanOrEqual(1)

    // Trigger prefix-invalidation: ['timers'] prefix matches ['timers', { from, to }].
    await queryClient.invalidateQueries({ queryKey: ['timers'] })

    // Wait for the refetch triggered by invalidation.
    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(callsAfterInitial))

    // The list fn must have been called again — proving prefix-invalidation works.
    expect(mockList.mock.calls.length).toBeGreaterThan(callsAfterInitial)
  })
})

// ---------------------------------------------------------------------------
// Tests — useWeekTimers
// ---------------------------------------------------------------------------

describe('useWeekTimers', () => {
  const weekTimers: Timer[] = [
    makeTimer({ id: 10, description: 'Week timer X' }),
  ]

  afterEach(() => {
    cleanup()
  })

  it('resolves to Timer[] returned by window.api.timers.list', async () => {
    window.api = makeMockApi({
      timers: { list: vi.fn().mockResolvedValue(weekTimers) },
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })

    const { result } = renderHook(
      () => useWeekTimers(FROM_EPOCH, TO_EPOCH),
      { wrapper: makeWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(weekTimers)
  })

  it('calls window.api.timers.list with the FLAT { fromEpoch, toEpoch } form', async () => {
    const mockList = vi.fn().mockResolvedValue(weekTimers)
    window.api = makeMockApi({ timers: { list: mockList } })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    })

    const { result } = renderHook(
      () => useWeekTimers(FROM_EPOCH, TO_EPOCH),
      { wrapper: makeWrapper(queryClient) },
    )

    await waitFor(() => expect(result.current.isFetched).toBe(true))

    expect(mockList).toHaveBeenCalledWith({ fromEpoch: FROM_EPOCH, toEpoch: TO_EPOCH })
  })
})
