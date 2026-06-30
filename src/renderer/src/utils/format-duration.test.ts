// @vitest-environment jsdom
// src/renderer/src/utils/format-duration.test.ts
// Unit tests for the formatDuration four-rule contract from UI-SPEC § DurationCell.
//
// Covers all four rules:
//   Rule 1 — negative seconds → '00:00:00' (clamp)
//   Rule 2 — 0 ≤ seconds < 360_000 → zero-padded HH:MM:SS
//   Rule 3 — seconds >= 360_000 → hours unpadded + padded MM:SS
//   Rule 4 — output is digits + colons only (verified by the literal assertions above)
//
// Refs:
//   - 04-UI-SPEC.md § DurationCell formatDuration rules
//   - 04-06-PLAN.md Task 1 acceptance criteria

import { describe, it, expect } from 'vitest'
import { formatDuration, formatHours } from './format-duration'

describe('formatDuration', () => {
  // Rule 1: negative seconds → clamp to '00:00:00'
  it('clamps negative seconds to 00:00:00', () => {
    expect(formatDuration(-1)).toBe('00:00:00')
    expect(formatDuration(-3600)).toBe('00:00:00')
    expect(formatDuration(-0.5)).toBe('00:00:00')
  })

  // Rule 2: zero → '00:00:00'
  it('returns 00:00:00 for zero seconds', () => {
    expect(formatDuration(0)).toBe('00:00:00')
  })

  // Rule 2: small values within the padded range
  it('zero-pads HH:MM:SS for seconds in the 0–359999 range', () => {
    expect(formatDuration(1)).toBe('00:00:01')
    expect(formatDuration(59)).toBe('00:00:59')
    expect(formatDuration(60)).toBe('00:01:00')
    expect(formatDuration(61)).toBe('00:01:01')
    expect(formatDuration(3600)).toBe('01:00:00')
    expect(formatDuration(3661)).toBe('01:01:01')
    expect(formatDuration(360_000 - 1)).toBe('99:59:59')
  })

  // Rule 3: seconds >= 360_000 → hours unpadded + padded MM:SS
  it('returns unpadded hours for seconds >= 360_000 (100 hours boundary)', () => {
    expect(formatDuration(360_000)).toBe('100:00:00')
    expect(formatDuration(4_444_567)).toBe('1234:36:07') // 4444567 = 1234h 36m 7s (plan had a typo: '1234:56:07')
    expect(formatDuration(360_001)).toBe('100:00:01')
  })

  // Rule 4: output contains only digits and colons (no suffixes)
  it('output contains only digits and colons', () => {
    const result = formatDuration(3661)
    expect(result).toMatch(/^\d+:\d{2}:\d{2}$/)
  })
})

describe('formatHours', () => {
  it('clamps negative seconds to 0 hrs', () => {
    expect(formatHours(-1)).toBe('0 hrs')
  })

  it('drops the decimal for whole hours', () => {
    expect(formatHours(3600)).toBe('1 hrs')
  })

  it('shows a single decimal place', () => {
    expect(formatHours(1800)).toBe('0.5 hrs')
  })

  it('rounds to one decimal and adds a thousands separator', () => {
    expect(formatHours(4_444_567)).toBe('1,234.6 hrs')
  })

  it('formats zero as 0 hrs', () => {
    expect(formatHours(0)).toBe('0 hrs')
  })
})
