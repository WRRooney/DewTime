// @vitest-environment jsdom
// src/renderer/src/utils/epoch-datetime.test.ts
// Unit tests for the epoch-datetime conversion functions (DATA-04, A-18, D-10).
//
// Covers:
//   - epochToDatetimeLocal returns YYYY-MM-DDTHH:mm:ss in local wall-clock time
//   - epochToDatetimeLocal preserves seconds (BUG FIX: previously truncated to HH:mm)
//   - datetimeLocalToEpoch returns null on '' (empty string)
//   - datetimeLocalToEpoch returns null on invalid/garbage input
//   - Round-trip: datetimeLocalToEpoch(epochToDatetimeLocal(ts)) preserves seconds
//   - datetimeLocalToEpoch result is an integer (no ms leakage — DATA-04)
//   - datetimeLocalToEpoch still parses legacy 16-char HH:mm values (backward compat)
//
// Refs:
//   - 05-CONTEXT.md D-10 (local wall-clock; no timezone; no Date.now())
//   - 05-CONTEXT.md DATA-04 (integer seconds; no ms leakage)
//   - 05-03-PLAN.md Task 1 acceptance criteria

import { describe, it, expect } from 'vitest'
import {
  epochToDatetimeLocal,
  datetimeLocalToEpoch,
  epochToDisplay,
  displayToEpoch,
} from './epoch-datetime'
import type { EpochSeconds } from '@shared/time'

/** Build an EpochSeconds from local wall-clock components (no Date.now()). */
function localEpoch(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
): EpochSeconds {
  return Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000) as EpochSeconds
}

describe('epochToDatetimeLocal', () => {
  it('returns a 19-character YYYY-MM-DDTHH:mm:ss string', () => {
    const ts = 1700000000 as EpochSeconds
    const result = epochToDatetimeLocal(ts)
    expect(result).toHaveLength(19)
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
  })

  it('produces output parseable back to a Date without NaN', () => {
    const ts = 1700000000 as EpochSeconds
    const result = epochToDatetimeLocal(ts)
    const reparsed = new Date(result)
    expect(isNaN(reparsed.getTime())).toBe(false)
  })

  it('preserves seconds (BUG FIX: was truncating to HH:mm)', () => {
    // 1700000099 % 60 = 59, so the seconds component of this epoch is 59.
    // The output must end with :59 (seconds preserved, not truncated to :00).
    const ts = 1700000099 as EpochSeconds
    const result = epochToDatetimeLocal(ts)
    expect(result).toMatch(/:59$/)
  })
})

describe('datetimeLocalToEpoch', () => {
  it('returns null for empty string', () => {
    expect(datetimeLocalToEpoch('')).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(datetimeLocalToEpoch('garbage')).toBeNull()
    expect(datetimeLocalToEpoch('not-a-date')).toBeNull()
    expect(datetimeLocalToEpoch('2023-13-45T25:99')).toBeNull()
  })

  it('returns an integer with no fractional component (DATA-04)', () => {
    const result = datetimeLocalToEpoch('2023-11-14T22:00:00')
    expect(result).not.toBeNull()
    expect(Number.isInteger(result)).toBe(true)
  })

  it('parses legacy 16-char HH:mm format for backward compatibility', () => {
    const result = datetimeLocalToEpoch('2023-11-14T22:00')
    expect(result).not.toBeNull()
    expect(Number.isInteger(result)).toBe(true)
  })
})

describe('round-trip', () => {
  it('datetimeLocalToEpoch(epochToDatetimeLocal(ts)) round-trips to the exact second', () => {
    // With seconds now in the format, the round-trip should preserve the exact
    // second value (no truncation to the minute boundary).
    // 1700000099 % 60 = 59 — has a non-zero seconds component.
    const ts = 1700000099 as EpochSeconds
    const dtLocal = epochToDatetimeLocal(ts)
    const roundTripped = datetimeLocalToEpoch(dtLocal)
    expect(roundTripped).toBe(ts)
  })

  it('datetimeLocalToEpoch(epochToDatetimeLocal(ts)) works for a minute-boundary ts', () => {
    // 1700000040 / 60 = 28333334.0 exactly, so seconds component = 0.
    // Sanity check: a ts on a minute boundary still round-trips correctly.
    const ts = 1700000040 as EpochSeconds
    const dtLocal = epochToDatetimeLocal(ts)
    const roundTripped = datetimeLocalToEpoch(dtLocal)
    expect(roundTripped).toBe(ts)
  })
})

describe('epochToDisplay', () => {
  it('formats local wall-clock as "m/d/yy h:mm:ss a" with no leading zeros on m/d/h', () => {
    // 2026-06-09 19:20:05 local
    expect(epochToDisplay(localEpoch(2026, 6, 9, 19, 20, 5))).toBe('6/9/26 7:20:05 PM')
  })

  it('renders midnight as 12:mm:ss AM and noon as 12:mm:ss PM', () => {
    expect(epochToDisplay(localEpoch(2026, 1, 1, 0, 0, 0))).toBe('1/1/26 12:00:00 AM')
    expect(epochToDisplay(localEpoch(2026, 12, 31, 12, 30, 45))).toBe('12/31/26 12:30:45 PM')
  })
})

describe('displayToEpoch', () => {
  it('returns null for empty / garbage input', () => {
    expect(displayToEpoch('')).toBeNull()
    expect(displayToEpoch('nonsense')).toBeNull()
    expect(displayToEpoch('6/9/26 7:20:05')).toBeNull() // no meridiem
  })

  it('parses the canonical format', () => {
    expect(displayToEpoch('6/9/26 7:20:05 pm')).toBe(localEpoch(2026, 6, 9, 19, 20, 5))
  })

  it('is tolerant: seconds optional, case-insensitive, optional dots, 4-digit year', () => {
    expect(displayToEpoch('6/9/26 7:20 PM')).toBe(localEpoch(2026, 6, 9, 19, 20, 0))
    expect(displayToEpoch('6/9/26 7:20:05 P.M.')).toBe(localEpoch(2026, 6, 9, 19, 20, 5))
    expect(displayToEpoch('6/9/2026 7:20:05 pm')).toBe(localEpoch(2026, 6, 9, 19, 20, 5))
  })

  it('maps 12 am → 00h and 12 pm → 12h', () => {
    expect(displayToEpoch('1/1/26 12:00:00 am')).toBe(localEpoch(2026, 1, 1, 0, 0, 0))
    expect(displayToEpoch('1/1/26 12:00:00 pm')).toBe(localEpoch(2026, 1, 1, 12, 0, 0))
  })

  it('rejects out-of-range and calendar-overflow dates', () => {
    expect(displayToEpoch('13/1/26 1:00:00 am')).toBeNull() // month 13
    expect(displayToEpoch('2/31/26 1:00:00 am')).toBeNull() // Feb 31 overflow
    expect(displayToEpoch('6/9/26 13:00:00 pm')).toBeNull() // hour 13 on a 12-h clock
  })

  it('round-trips epochToDisplay → displayToEpoch to the exact second', () => {
    const ts = localEpoch(2026, 3, 7, 14, 8, 33)
    expect(displayToEpoch(epochToDisplay(ts))).toBe(ts)
  })
})
