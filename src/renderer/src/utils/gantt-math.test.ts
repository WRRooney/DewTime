// src/renderer/src/utils/gantt-math.test.ts
// Unit tests for gantt-math pure transform and snap functions.
//
// Covers:
//   - epochToX / xToEpoch: round-trip within 1s tolerance for a 86400s/1000px viewport (D-06)
//   - snapEpoch: rounds to nearest increment; returns input unchanged when altKey=true (D-18)
//   - snapIncrementFor: zoom-aware grid increment across all brackets (D-27)
//   - Clamp constants: MIN_SPAN_SECONDS, MAX_SPAN_SECONDS, DEFAULT_SPAN_SECONDS (D-07, D-08)
//
// Pure-math test — no jsdom environment needed.
// Refs: 09-02-PLAN.md, 09-PATTERNS.md § gantt-math.ts

import { describe, it, expect } from 'vitest'
import {
  epochToX,
  xToEpoch,
  snapEpoch,
  snapIncrementFor,
  MIN_SPAN_SECONDS,
  MAX_SPAN_SECONDS,
  DEFAULT_SPAN_SECONDS,
} from './gantt-math'
import type { GanttViewport } from './gantt-math'
import type { EpochSeconds } from '@shared/time'

// Reference viewport: 24-hour day, 1000px canvas
const VP_DAY: GanttViewport = {
  startEpoch: 1_700_000_000 as EpochSeconds, // arbitrary fixed epoch
  spanSeconds: 86400,
  canvasWidthPx: 1000,
}

describe('epochToX', () => {
  it('left edge (startEpoch) maps to x=0', () => {
    expect(epochToX(VP_DAY.startEpoch, VP_DAY)).toBe(0)
  })

  it('right edge (startEpoch + spanSeconds) maps to x=canvasWidthPx', () => {
    const rightEpoch = (VP_DAY.startEpoch + VP_DAY.spanSeconds) as EpochSeconds
    expect(epochToX(rightEpoch, VP_DAY)).toBe(VP_DAY.canvasWidthPx)
  })

  it('midpoint epoch maps to canvasWidthPx/2', () => {
    const midEpoch = (VP_DAY.startEpoch + VP_DAY.spanSeconds / 2) as EpochSeconds
    expect(epochToX(midEpoch, VP_DAY)).toBe(VP_DAY.canvasWidthPx / 2)
  })

  it('epoch before startEpoch produces negative x (off-canvas left)', () => {
    const before = (VP_DAY.startEpoch - 3600) as EpochSeconds
    expect(epochToX(before, VP_DAY)).toBeLessThan(0)
  })
})

describe('xToEpoch', () => {
  it('x=0 maps back to startEpoch', () => {
    expect(xToEpoch(0, VP_DAY)).toBe(VP_DAY.startEpoch)
  })

  it('x=canvasWidthPx maps back to startEpoch+spanSeconds', () => {
    const result = xToEpoch(VP_DAY.canvasWidthPx, VP_DAY)
    expect(result).toBe(VP_DAY.startEpoch + VP_DAY.spanSeconds)
  })
})

describe('epochToX / xToEpoch round-trip (D-06)', () => {
  it('round-trips an arbitrary epoch within 1s tolerance for 86400s/1000px viewport', () => {
    const epoch = (VP_DAY.startEpoch + 12345) as EpochSeconds
    const x = epochToX(epoch, VP_DAY)
    const recovered = xToEpoch(x, VP_DAY)
    expect(Math.abs(recovered - epoch)).toBeLessThanOrEqual(1)
  })

  it('round-trips the midpoint epoch within 1s tolerance', () => {
    const midEpoch = (VP_DAY.startEpoch + 43200) as EpochSeconds
    const x = epochToX(midEpoch, VP_DAY)
    const recovered = xToEpoch(x, VP_DAY)
    expect(Math.abs(recovered - midEpoch)).toBeLessThanOrEqual(1)
  })
})

describe('snapEpoch (D-18 Alt free-drag)', () => {
  it('rounds down when epoch is just below the midpoint of an increment', () => {
    // epoch = 1000 * 900 + 449 → nearest 900-multiple is 900000
    const epoch = (900 * 1000 + 449) as EpochSeconds
    expect(snapEpoch(epoch, 900, false)).toBe(900 * 1000)
  })

  it('rounds up when epoch is just above the midpoint of an increment', () => {
    // epoch = 1000 * 900 + 451 → nearest 900-multiple is 900900
    const epoch = (900 * 1000 + 451) as EpochSeconds
    expect(snapEpoch(epoch, 900, false)).toBe(900 * 1001)
  })

  it('rounds to nearest 900s increment when altKey=false', () => {
    const epoch = (900 * 100 + 300) as EpochSeconds // 300 is exactly half of 600, rounds up for 900 increment: 900*100+300 rounds to 900*100 (300 < 450)
    expect(snapEpoch(epoch, 900, false)).toBe(900 * 100)
  })

  it('returns epoch unchanged when altKey=true (free-drag, no snap)', () => {
    const epoch = (900 * 100 + 300) as EpochSeconds
    expect(snapEpoch(epoch, 900, true)).toBe(epoch)
  })

  it('snapEpoch(e, 900, true) === e (D-18 exact assertion)', () => {
    const e = 1_700_045_678 as EpochSeconds
    expect(snapEpoch(e, 900, true)).toBe(e)
  })
})

describe('snapIncrementFor (D-27 zoom-aware grid)', () => {
  it('span=3600 (1 hour) → increment=60 (1 min)', () => {
    expect(snapIncrementFor(3600)).toBe(60)
  })

  it('span=3601 (just above 1 hour) → increment=300 (5 min)', () => {
    expect(snapIncrementFor(3601)).toBe(300)
  })

  it('span=10800 (3 hours) → increment=300 (5 min)', () => {
    expect(snapIncrementFor(10800)).toBe(300)
  })

  it('span=10801 (just above 3 hours) → increment=900 (15 min)', () => {
    expect(snapIncrementFor(10801)).toBe(900)
  })

  it('span=43200 (12 hours) → increment=900 (15 min)', () => {
    expect(snapIncrementFor(43200)).toBe(900)
  })

  it('span=43201 (just above 12 hours) → increment=1800 (30 min)', () => {
    expect(snapIncrementFor(43201)).toBe(1800)
  })

  it('span=86400 (1 day / DEFAULT_SPAN_SECONDS) → increment=1800 (30 min)', () => {
    expect(snapIncrementFor(86400)).toBe(1800)
  })

  it('span=86401 (just above 1 day) → increment=3600 (1 hour)', () => {
    expect(snapIncrementFor(86401)).toBe(3600)
  })

  it('span=604800 (7 days / MAX_SPAN_SECONDS) → increment=3600 (1 hour)', () => {
    expect(snapIncrementFor(604800)).toBe(3600)
  })

  // Acceptance criteria explicit assertions
  it('snapIncrementFor(3600)===60 (acceptance criteria)', () => {
    expect(snapIncrementFor(3600)).toBe(60)
  })

  it('snapIncrementFor(86400)===1800 (acceptance criteria)', () => {
    expect(snapIncrementFor(86400)).toBe(1800)
  })

  it('snapIncrementFor(604800)===3600 (acceptance criteria)', () => {
    expect(snapIncrementFor(604800)).toBe(3600)
  })
})

describe('getGridlines', () => {
  // A viewport anchored on a known local :00 boundary for deterministic tests.
  // We pick midnight 2024-01-01 in LOCAL time via Date arithmetic so the epoch
  // is always aligned regardless of the runner's timezone.
  function localMidnightEpoch(): number {
    const d = new Date(2024, 0, 1, 0, 0, 0, 0) // Jan 1 2024 00:00 local
    return Math.floor(d.getTime() / 1000)
  }

  it('degenerate: span=0 returns []', () => {
    const { getGridlines } = require('./gantt-math')
    const vp: GanttViewport = { startEpoch: localMidnightEpoch() as EpochSeconds, spanSeconds: 0, canvasWidthPx: 1000 }
    expect(getGridlines(vp)).toEqual([])
  })

  it('degenerate: canvasWidthPx=0 returns []', () => {
    const { getGridlines } = require('./gantt-math')
    const vp: GanttViewport = { startEpoch: localMidnightEpoch() as EpochSeconds, spanSeconds: 3600, canvasWidthPx: 0 }
    expect(getGridlines(vp)).toEqual([])
  })

  it('1-hour viewport starting on local :00 yields exactly 5 lines (at 0,15,30,45,60 min)', () => {
    const { getGridlines } = require('./gantt-math')
    const start = localMidnightEpoch()
    const vp: GanttViewport = { startEpoch: start as EpochSeconds, spanSeconds: 3600, canvasWidthPx: 1000 }
    const lines = getGridlines(vp)
    expect(lines).toHaveLength(5)
  })

  it('isHour is true for the two :00 entries (start and end of the hour)', () => {
    const { getGridlines } = require('./gantt-math')
    const start = localMidnightEpoch()
    const vp: GanttViewport = { startEpoch: start as EpochSeconds, spanSeconds: 3600, canvasWidthPx: 1000 }
    const lines = getGridlines(vp)
    // The :00 boundaries at the start and end of the hour should both be isHour=true
    expect(lines.filter((l: { x: number; isHour: boolean }) => l.isHour)).toHaveLength(2)
    // The three quarter marks should be isHour=false
    expect(lines.filter((l: { x: number; isHour: boolean }) => !l.isHour)).toHaveLength(3)
  })

  it('x values align with epochToX: first line at x=0 when start is on :00', () => {
    const { getGridlines } = require('./gantt-math')
    const start = localMidnightEpoch()
    const vp: GanttViewport = { startEpoch: start as EpochSeconds, spanSeconds: 3600, canvasWidthPx: 1000 }
    const lines = getGridlines(vp)
    // First boundary = start of viewport (startEpoch is already on :00)
    expect(lines[0].x).toBeCloseTo(0, 3)
    // Last boundary = exactly 60 min in → x should be canvasWidthPx
    expect(lines[lines.length - 1].x).toBeCloseTo(1000, 3)
  })

  it('alignment starts on a clean boundary even when startEpoch is mid-quarter', () => {
    const { getGridlines } = require('./gantt-math')
    // Start 7 minutes past a local :00 boundary
    const midnight = localMidnightEpoch()
    const start = midnight + 7 * 60 // 00:07 local
    const vp: GanttViewport = { startEpoch: start as EpochSeconds, spanSeconds: 3600, canvasWidthPx: 1000 }
    const lines = getGridlines(vp)
    // The first gridline should be at the :15 boundary (8 min after start)
    // x = epochToX(:15 epoch, vp) = (8*60/3600)*1000 ≈ 133.33
    const firstX = lines[0].x
    expect(firstX).toBeGreaterThan(0)
    // Verify it lands on a real :15 local boundary by checking the corresponding Date
    const firstEpoch = start + (firstX / 1000) * 3600
    const d = new Date(firstEpoch * 1000)
    expect(d.getSeconds()).toBe(0)
    expect(d.getMilliseconds()).toBe(0)
    expect(d.getMinutes() % 15).toBe(0)
  })

  it('isHour correct: :15/:30/:45 boundaries have isHour=false', () => {
    const { getGridlines } = require('./gantt-math')
    const start = localMidnightEpoch()
    const vp: GanttViewport = { startEpoch: start as EpochSeconds, spanSeconds: 3600, canvasWidthPx: 1000 }
    const lines = getGridlines(vp)
    for (const line of lines) {
      const epoch = start + (line.x / 1000) * 3600
      const d = new Date(epoch * 1000)
      const mins = d.getMinutes()
      if (mins === 0) {
        expect(line.isHour).toBe(true)
      } else {
        expect(line.isHour).toBe(false)
      }
    }
  })
})

describe('Span clamp constants (D-07, D-08)', () => {
  it('MIN_SPAN_SECONDS === 3600 (D-08 minimum zoom = 1 hour)', () => {
    expect(MIN_SPAN_SECONDS).toBe(3600)
  })

  it('MAX_SPAN_SECONDS === 604800 (D-08 maximum zoom = 7 days)', () => {
    expect(MAX_SPAN_SECONDS).toBe(604800)
  })

  it('DEFAULT_SPAN_SECONDS === 86400 (D-07 default zoom = current day)', () => {
    expect(DEFAULT_SPAN_SECONDS).toBe(86400)
  })

  it('DEFAULT_SPAN_SECONDS is between MIN and MAX', () => {
    expect(DEFAULT_SPAN_SECONDS).toBeGreaterThanOrEqual(MIN_SPAN_SECONDS)
    expect(DEFAULT_SPAN_SECONDS).toBeLessThanOrEqual(MAX_SPAN_SECONDS)
  })
})
