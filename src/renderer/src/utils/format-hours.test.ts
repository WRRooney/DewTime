// src/renderer/src/utils/format-hours.test.ts
// Tests for the quarter-hour rounding + decimal-hours formatting used by the
// duration copy-button.

import { describe, it, expect } from 'vitest'
import { roundToQuarterHours, formatDecimalHours } from './format-hours'

const H = 3600
const M = 60

describe('roundToQuarterHours', () => {
  it('clamps zero and negatives to 0', () => {
    expect(roundToQuarterHours(0)).toBe(0)
    expect(roundToQuarterHours(-100)).toBe(0)
  })

  it('rounds DOWN when < 5 minutes past a quarter boundary', () => {
    expect(roundToQuarterHours(1 * H + 4 * M)).toBe(1.0) // 1:04 → 1.00
    expect(roundToQuarterHours(1 * H + 18 * M)).toBe(1.25) // 1:18 → 1.25
  })

  it('rounds UP at exactly 5 minutes past a quarter boundary', () => {
    expect(roundToQuarterHours(1 * H + 5 * M)).toBe(1.25) // 1:05 → 1.25
    expect(roundToQuarterHours(1 * H + 20 * M)).toBe(1.5) // 1:20 → 1.50
  })

  it('rounds UP when well past the 5-minute threshold', () => {
    expect(roundToQuarterHours(1 * H + 14 * M)).toBe(1.25) // 1:14 → 1.25
    expect(roundToQuarterHours(1 * H + 44 * M)).toBe(1.75) // 1:44 → 1.75
  })

  it('matches the Ignition v0 example (22:48 → 22.75)', () => {
    expect(roundToQuarterHours(22 * H + 48 * M)).toBe(22.75)
  })

  it('keeps exact quarter values unchanged', () => {
    expect(roundToQuarterHours(15 * M)).toBe(0.25)
    expect(roundToQuarterHours(30 * M)).toBe(0.5)
    expect(roundToQuarterHours(45 * M)).toBe(0.75)
    expect(roundToQuarterHours(1 * H)).toBe(1.0)
  })
})

describe('formatDecimalHours', () => {
  it('formats with two decimal places', () => {
    expect(formatDecimalHours(0)).toBe('0.00')
    expect(formatDecimalHours(1 * H + 5 * M)).toBe('1.25')
    expect(formatDecimalHours(22 * H + 48 * M)).toBe('22.75')
  })
})
