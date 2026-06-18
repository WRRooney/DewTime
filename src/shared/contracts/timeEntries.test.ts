// src/shared/contracts/timeEntries.test.ts
// Contract tests for new Zod schemas added in Phase 9 (09-01-PLAN.md Task 2).
// Tests verify accept/reject behavior per <behavior> bullets.
import { describe, it, expect } from 'vitest'
import {
  ListInRangeArgsSchema,
  CreateEntryArgsSchema,
  SetTimestampsArgsSchema,
} from './timeEntries'
import { SetArgsSchema } from './settings'

describe('ListInRangeArgsSchema', () => {
  it('accepts valid range { fromEpoch, toEpoch }', () => {
    expect(
      ListInRangeArgsSchema.safeParse({ fromEpoch: 1700000000, toEpoch: 1700003600 }).success,
    ).toBe(true)
  })

  it('rejects reversed range (fromEpoch >= toEpoch)', () => {
    expect(
      ListInRangeArgsSchema.safeParse({ fromEpoch: 1700000100, toEpoch: 1700000000 }).success,
    ).toBe(false)
  })

  it('rejects zero-span range (fromEpoch === toEpoch)', () => {
    expect(
      ListInRangeArgsSchema.safeParse({ fromEpoch: 1700000000, toEpoch: 1700000000 }).success,
    ).toBe(false)
  })

  it('rejects non-positive epochs', () => {
    expect(
      ListInRangeArgsSchema.safeParse({ fromEpoch: 0, toEpoch: 1700000000 }).success,
    ).toBe(false)
    expect(
      ListInRangeArgsSchema.safeParse({ fromEpoch: -1, toEpoch: 1700000000 }).success,
    ).toBe(false)
  })
})

describe('CreateEntryArgsSchema', () => {
  it('accepts valid { timerId, startTs, endTs }', () => {
    expect(
      CreateEntryArgsSchema.safeParse({
        timerId: 1,
        startTs: 1700001000,
        endTs: 1700002000,
      }).success,
    ).toBe(true)
  })

  it('rejects reversed timestamps (startTs >= endTs)', () => {
    expect(
      CreateEntryArgsSchema.safeParse({
        timerId: 1,
        startTs: 1700000100,
        endTs: 1700000000,
      }).success,
    ).toBe(false)
  })

  it('rejects equal timestamps (startTs === endTs)', () => {
    expect(
      CreateEntryArgsSchema.safeParse({
        timerId: 1,
        startTs: 1700000000,
        endTs: 1700000000,
      }).success,
    ).toBe(false)
  })

  it('rejects non-positive timerId', () => {
    expect(
      CreateEntryArgsSchema.safeParse({
        timerId: 0,
        startTs: 1700001000,
        endTs: 1700002000,
      }).success,
    ).toBe(false)
  })
})

describe('SetTimestampsArgsSchema', () => {
  it('accepts valid { entryId, startTs, endTs }', () => {
    expect(
      SetTimestampsArgsSchema.safeParse({
        entryId: 1,
        startTs: 1700001000,
        endTs: 1700002000,
      }).success,
    ).toBe(true)
  })

  it('rejects reversed timestamps (startTs >= endTs)', () => {
    expect(
      SetTimestampsArgsSchema.safeParse({
        entryId: 1,
        startTs: 1700002000,
        endTs: 1700001000,
      }).success,
    ).toBe(false)
  })

  it('rejects equal timestamps (startTs === endTs)', () => {
    expect(
      SetTimestampsArgsSchema.safeParse({
        entryId: 1,
        startTs: 1700001500,
        endTs: 1700001500,
      }).success,
    ).toBe(false)
  })
})

describe('settings SetArgsSchema — new gantt keys', () => {
  it('accepts { key: settings.active_tab, value: timers }', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.active_tab', value: 'timers' }).success,
    ).toBe(true)
  })

  it('accepts { key: settings.active_tab, value: gantt }', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.active_tab', value: 'gantt' }).success,
    ).toBe(true)
  })

  it('accepts { key: settings.active_tab, value: projects }', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.active_tab', value: 'projects' }).success,
    ).toBe(true)
  })

  it('rejects { key: settings.active_tab, value: invalid }', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.active_tab', value: 'dashboard' }).success,
    ).toBe(false)
  })

  it('accepts { key: settings.gutter_width_pct, value: 0.25 }', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.gutter_width_pct', value: 0.25 }).success,
    ).toBe(true)
  })

  it('accepts boundary values: 0 and 1', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.gutter_width_pct', value: 0 }).success,
    ).toBe(true)
    expect(
      SetArgsSchema.safeParse({ key: 'settings.gutter_width_pct', value: 1 }).success,
    ).toBe(true)
  })

  it('rejects { key: settings.gutter_width_pct, value: 1.5 } (out of range)', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.gutter_width_pct', value: 1.5 }).success,
    ).toBe(false)
  })

  it('rejects { key: settings.gutter_width_pct, value: -0.1 } (below 0)', () => {
    expect(
      SetArgsSchema.safeParse({ key: 'settings.gutter_width_pct', value: -0.1 }).success,
    ).toBe(false)
  })
})
