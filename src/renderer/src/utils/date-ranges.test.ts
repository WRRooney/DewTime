// @vitest-environment jsdom
// src/renderer/src/utils/date-ranges.test.ts
// Unit tests for dayRangeOf() and weekRangeOf() epoch boundary math.
//
// Covers:
//   - dayRangeOf: fromEpoch is local midnight; toEpoch is next local midnight (half-open)
//   - dayRangeOf: from-boundary inclusive; to-boundary exclusive
//   - weekRangeOf (Monday start): Wednesday, Monday-itself, Sunday
//   - weekRangeOf (Sunday start): Wednesday, Sunday-itself
//   - Window length is 7×86400 seconds for weeks (non-DST test dates)
//
// Uses fixed local-time dates (not wall-clock) — no test drift.
// Picks weeks in January 2025 (no DST in most TZs for this region).
//
// Refs:
//   - 06-CONTEXT.md D-06 (local-time half-open range)
//   - 06-CONTEXT.md D-10 (week-start encoding pitfall)
//   - 06-RESEARCH.md § Critical Test Cases, Pitfall 1, Pitfall 2
//   - 06-02-PLAN.md Task 2

import { describe, it, expect } from 'vitest'
import { dayRangeOf, weekRangeOf } from './date-ranges'
import type { EpochSeconds } from '@shared/time'

// Helper: epoch seconds for a local date at a specific time
function localEpoch(year: number, month: number, day: number, h = 0, m = 0, s = 0): EpochSeconds {
  return Math.floor(new Date(year, month, day, h, m, s).getTime() / 1000) as EpochSeconds
}

describe('dayRangeOf', () => {
  it('fromEpoch equals start of day in local time (midnight)', () => {
    // 2025-01-15 at noon — fromEpoch must be 2025-01-15 00:00:00 local
    const date = new Date(2025, 0, 15, 12, 0, 0)
    const { fromEpoch } = dayRangeOf(date)
    const expectedMidnight = localEpoch(2025, 0, 15, 0, 0, 0)
    expect(fromEpoch).toBe(expectedMidnight)
  })

  it('toEpoch equals start of next day (half-open)', () => {
    // 2025-01-15 — toEpoch must be 2025-01-16 00:00:00 local
    const date = new Date(2025, 0, 15, 12, 0, 0)
    const { toEpoch } = dayRangeOf(date)
    const expectedNextMidnight = localEpoch(2025, 0, 16, 0, 0, 0)
    expect(toEpoch).toBe(expectedNextMidnight)
  })

  it('timer at fromEpoch is inclusive (created_at >= fromEpoch)', () => {
    const date = new Date(2025, 0, 15)
    const { fromEpoch } = dayRangeOf(date)
    // A timer created exactly at midnight is IN the range
    const timerCreatedAt = localEpoch(2025, 0, 15, 0, 0, 0)
    expect(timerCreatedAt >= fromEpoch).toBe(true)
  })

  it('timer at toEpoch boundary is exclusive (created_at < toEpoch)', () => {
    const date = new Date(2025, 0, 15)
    const { toEpoch } = dayRangeOf(date)
    // A timer created exactly at next midnight is NOT in the range
    const timerAtBoundary = localEpoch(2025, 0, 16, 0, 0, 0)
    expect(timerAtBoundary >= toEpoch).toBe(true)  // boundary is excluded
    // A timer 1 second before is in range
    const timerJustBefore = localEpoch(2025, 0, 15, 23, 59, 59)
    expect(timerJustBefore < toEpoch).toBe(true)
  })

  it('works when input is already at midnight', () => {
    const date = new Date(2025, 0, 15, 0, 0, 0)
    const { fromEpoch, toEpoch } = dayRangeOf(date)
    expect(fromEpoch).toBe(localEpoch(2025, 0, 15))
    expect(toEpoch).toBe(localEpoch(2025, 0, 16))
  })

  it('does not mutate the input Date', () => {
    const date = new Date(2025, 0, 15, 14, 30, 0)
    const original = date.getTime()
    dayRangeOf(date)
    expect(date.getTime()).toBe(original)
  })
})

describe('weekRangeOf — Monday start (weekStart=0)', () => {
  // Week: Mon 2025-01-13 .. Sun 2025-01-19

  it('Wednesday → week starts previous Monday', () => {
    // 2025-01-15 is a Wednesday
    const date = new Date(2025, 0, 15, 12, 0, 0)
    const { fromEpoch, toEpoch } = weekRangeOf(date, 0)
    // Should start Monday 2025-01-13
    expect(fromEpoch).toBe(localEpoch(2025, 0, 13, 0, 0, 0))
    // Should end Monday 2025-01-20
    expect(toEpoch).toBe(localEpoch(2025, 0, 20, 0, 0, 0))
  })

  it('Monday itself → offsetBack=0, week starts that Monday', () => {
    // 2025-01-13 is a Monday
    const date = new Date(2025, 0, 13, 9, 0, 0)
    const { fromEpoch, toEpoch } = weekRangeOf(date, 0)
    expect(fromEpoch).toBe(localEpoch(2025, 0, 13, 0, 0, 0))
    expect(toEpoch).toBe(localEpoch(2025, 0, 20, 0, 0, 0))
  })

  it('Sunday → week started 6 days ago (last Monday)', () => {
    // 2025-01-19 is a Sunday
    const date = new Date(2025, 0, 19, 18, 0, 0)
    const { fromEpoch, toEpoch } = weekRangeOf(date, 0)
    // Started Monday 2025-01-13
    expect(fromEpoch).toBe(localEpoch(2025, 0, 13, 0, 0, 0))
    expect(toEpoch).toBe(localEpoch(2025, 0, 20, 0, 0, 0))
  })

  it('window is exactly 7 days (7 × 86400 seconds)', () => {
    const date = new Date(2025, 0, 15)
    const { fromEpoch, toEpoch } = weekRangeOf(date, 0)
    expect(toEpoch - fromEpoch).toBe(7 * 86400)
  })
})

describe('weekRangeOf — Sunday start (weekStart=6)', () => {
  // Week: Sun 2025-01-12 .. Sat 2025-01-18

  it('Wednesday → week starts previous Sunday', () => {
    // 2025-01-15 is a Wednesday; previous Sunday is 2025-01-12
    const date = new Date(2025, 0, 15, 12, 0, 0)
    const { fromEpoch, toEpoch } = weekRangeOf(date, 6)
    expect(fromEpoch).toBe(localEpoch(2025, 0, 12, 0, 0, 0))
    expect(toEpoch).toBe(localEpoch(2025, 0, 19, 0, 0, 0))
  })

  it('Sunday itself → offsetBack=0, week starts that Sunday', () => {
    // 2025-01-12 is a Sunday
    const date = new Date(2025, 0, 12, 9, 0, 0)
    const { fromEpoch, toEpoch } = weekRangeOf(date, 6)
    expect(fromEpoch).toBe(localEpoch(2025, 0, 12, 0, 0, 0))
    expect(toEpoch).toBe(localEpoch(2025, 0, 19, 0, 0, 0))
  })

  it('window is exactly 7 days (7 × 86400 seconds)', () => {
    const date = new Date(2025, 0, 15)
    const { fromEpoch, toEpoch } = weekRangeOf(date, 6)
    expect(toEpoch - fromEpoch).toBe(7 * 86400)
  })
})
