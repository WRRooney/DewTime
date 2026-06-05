// @vitest-environment jsdom
// src/renderer/src/stores/useSelectedDateStore.test.ts
// Unit tests for useSelectedDateStore and useCalendarPickerStore (A-22, D-13).
//
// Covers:
//   - prev() shifts the stored date back by exactly 1 calendar day
//   - next() shifts the stored date forward by exactly 1 calendar day
//   - today() sets the date to new Date() evaluated AT invocation time (A-22)
//   - setDate(d) stores the exact date provided
//   - prev()/next() do not mutate the prior Date object (immutability)
//   - useCalendarPickerStore: isOpen defaults false; open() sets true; close() sets false
//
// Refs:
//   - 06-CONTEXT.md D-13 (no middleware)
//   - 06-CONTEXT.md A-22 (today() must call new Date() at invocation)
//   - 06-02-PLAN.md Task 1

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useSelectedDateStore } from './useSelectedDateStore'
import { useCalendarPickerStore } from './useCalendarPickerStore'

// Fixed seed date: Wednesday 2025-01-15 12:00:00 local
const SEED_DATE = new Date(2025, 0, 15, 12, 0, 0)

describe('useSelectedDateStore', () => {
  beforeEach(() => {
    // Reset to a known date before each test
    useSelectedDateStore.setState({ date: new Date(SEED_DATE) })
  })

  it('has an initial date (Date instance)', () => {
    const { date } = useSelectedDateStore.getState()
    expect(date).toBeInstanceOf(Date)
  })

  it('setDate(d) stores the provided date', () => {
    const target = new Date(2025, 5, 1, 8, 0, 0)
    useSelectedDateStore.getState().setDate(target)
    const { date } = useSelectedDateStore.getState()
    expect(date).toBe(target)
  })

  it('prev() shifts the date back by exactly 1 calendar day', () => {
    useSelectedDateStore.getState().prev()
    const { date } = useSelectedDateStore.getState()
    // 2025-01-15 → 2025-01-14
    expect(date.getFullYear()).toBe(2025)
    expect(date.getMonth()).toBe(0)   // January
    expect(date.getDate()).toBe(14)
  })

  it('next() shifts the date forward by exactly 1 calendar day', () => {
    useSelectedDateStore.getState().next()
    const { date } = useSelectedDateStore.getState()
    // 2025-01-15 → 2025-01-16
    expect(date.getFullYear()).toBe(2025)
    expect(date.getMonth()).toBe(0)   // January
    expect(date.getDate()).toBe(16)
  })

  it('prev() does not mutate the original Date object', () => {
    const before = useSelectedDateStore.getState().date
    const beforeDay = before.getDate()
    useSelectedDateStore.getState().prev()
    // Original date object is unchanged
    expect(before.getDate()).toBe(beforeDay)
    // New stored date is different object
    expect(useSelectedDateStore.getState().date).not.toBe(before)
  })

  it('next() does not mutate the original Date object', () => {
    const before = useSelectedDateStore.getState().date
    const beforeDay = before.getDate()
    useSelectedDateStore.getState().next()
    expect(before.getDate()).toBe(beforeDay)
    expect(useSelectedDateStore.getState().date).not.toBe(before)
  })

  it('today() reflects new Date() evaluated at invocation time (A-22)', () => {
    vi.useFakeTimers()
    try {
      // Set store to past date
      useSelectedDateStore.setState({ date: new Date(2020, 0, 1) })

      // Advance fake clock to a specific moment
      const advancedDate = new Date(2026, 5, 3, 9, 30, 0)
      vi.setSystemTime(advancedDate)

      // Call today() — must capture new Date() at this moment
      useSelectedDateStore.getState().today()
      const { date } = useSelectedDateStore.getState()

      // The stored date should match the advanced fake clock
      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth()).toBe(5)   // June
      expect(date.getDate()).toBe(3)
      // Verify it is NOT the prior cached date from store creation
      expect(date.getFullYear()).not.toBe(2020)
    } finally {
      vi.useRealTimers()
    }
  })

  it('prev() handles month boundary correctly (Jan 1 → Dec 31)', () => {
    useSelectedDateStore.setState({ date: new Date(2025, 0, 1, 12, 0, 0) })
    useSelectedDateStore.getState().prev()
    const { date } = useSelectedDateStore.getState()
    expect(date.getFullYear()).toBe(2024)
    expect(date.getMonth()).toBe(11)  // December
    expect(date.getDate()).toBe(31)
  })

  it('next() handles month boundary correctly (Dec 31 → Jan 1)', () => {
    useSelectedDateStore.setState({ date: new Date(2024, 11, 31, 12, 0, 0) })
    useSelectedDateStore.getState().next()
    const { date } = useSelectedDateStore.getState()
    expect(date.getFullYear()).toBe(2025)
    expect(date.getMonth()).toBe(0)   // January
    expect(date.getDate()).toBe(1)
  })
})

describe('useCalendarPickerStore', () => {
  beforeEach(() => {
    useCalendarPickerStore.setState({ isOpen: false })
  })

  it('isOpen defaults to false', () => {
    const { isOpen } = useCalendarPickerStore.getState()
    expect(isOpen).toBe(false)
  })

  it('open() sets isOpen to true', () => {
    useCalendarPickerStore.getState().open()
    expect(useCalendarPickerStore.getState().isOpen).toBe(true)
  })

  it('close() sets isOpen to false', () => {
    useCalendarPickerStore.setState({ isOpen: true })
    useCalendarPickerStore.getState().close()
    expect(useCalendarPickerStore.getState().isOpen).toBe(false)
  })

  it('open() then close() restores isOpen to false', () => {
    useCalendarPickerStore.getState().open()
    useCalendarPickerStore.getState().close()
    expect(useCalendarPickerStore.getState().isOpen).toBe(false)
  })
})
