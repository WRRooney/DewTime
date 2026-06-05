// @vitest-environment jsdom
// src/renderer/src/components/TimestampEditor.test.tsx
// Tests for the windowless TimestampEditor form (FIELD-04/05/06, D-08).
// The editor now renders directly with a `timerId` prop (separate editor window)
// — no <dialog>, no open/close store.
//
// Behaviors under test:
//   1. Lists each entry with "Entry {n}" and "(running)" on the open entry.
//   2. The running entry's End input is disabled (D-08).
//   3. Editing + blurring a stopped entry's Start input calls timeEntries.setStart (FIELD-04).
//   4. Editing + blurring the offset input calls timers.setOffset with Math.round(min*60) (FIELD-05).
//   5. Changing + blurring notes calls timers.setNotes (FIELD-06); an unchanged blur does NOT.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { TimestampEditor } from './TimestampEditor'
import { epochToDatetimeLocal } from '@/utils/epoch-datetime'
import type { EpochSeconds } from '@shared/time'

const EPOCH_START_1 = 1748865600 as EpochSeconds // stopped entry start
const EPOCH_END_1 = 1748869200 as EpochSeconds // stopped entry end
const EPOCH_START_2 = 1748872800 as EpochSeconds // running entry start

const TIMER_ID = 7

describe('TimestampEditor', () => {
  beforeEach(() => {
    window.api = makeMockApi({
      timeEntries: {
        listByTimer: vi.fn().mockResolvedValue([
          { id: 1, timer_id: TIMER_ID, start_timestamp: EPOCH_START_1, end_timestamp: EPOCH_END_1 },
          { id: 2, timer_id: TIMER_ID, start_timestamp: EPOCH_START_2, end_timestamp: null },
        ]),
        setStart: vi.fn().mockResolvedValue(undefined),
        setEnd: vi.fn().mockResolvedValue(undefined),
      },
      timers: {
        list: vi.fn().mockResolvedValue([
          {
            id: TIMER_ID,
            project_id: null,
            description: 'Test timer',
            notes: 'old notes',
            created_at: 1748000000 as EpochSeconds,
            offset: 0,
            totalSeconds: 0,
            running: true,
          },
        ]),
        setOffset: vi.fn().mockResolvedValue(undefined),
        setNotes: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('lists entries with correct labels', async () => {
    renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      expect(screen.getByText('Entry 1')).toBeTruthy()
      expect(screen.getByText(/Entry 2.*running/)).toBeTruthy()
    })
  })

  it('renders the running entry End input as disabled (D-08)', async () => {
    const { container } = renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      expect(screen.getByText(/Entry 2.*running/)).toBeTruthy()
    })
    const endInputs = container.querySelectorAll<HTMLInputElement>(
      'input[type="datetime-local"]',
    )
    // 2 entries × (Start, End) = 4 inputs; entry 2 (running) End is the last, disabled.
    expect(endInputs[3]!.disabled).toBe(true)
    // entry 1 (stopped) End is editable
    expect(endInputs[1]!.disabled).toBe(false)
  })

  it('a calendar pick (change, no blur) on a stopped Start commits immediately (FIELD-04)', async () => {
    const { container } = renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      expect(screen.getByText('Entry 1')).toBeTruthy()
    })
    const startInput = container.querySelectorAll<HTMLInputElement>(
      'input[type="datetime-local"]',
    )[0]!
    const newEpoch = (EPOCH_START_1 - 3600) as EpochSeconds // 1h earlier
    // NO blur — a native calendar pick fires `change` only; the edit must apply now.
    fireEvent.change(startInput, { target: { value: epochToDatetimeLocal(newEpoch) } })
    await waitFor(() => {
      expect(window.api.timeEntries.setStart).toHaveBeenCalledWith(1, newEpoch)
    })
    // Dedupe: re-firing the same value must not produce a second mutation.
    fireEvent.change(startInput, { target: { value: epochToDatetimeLocal(newEpoch) } })
    expect((window.api.timeEntries.setStart as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
  })

  it('editing + blurring the offset input calls timers.setOffset with minutes*60 (FIELD-05)', async () => {
    const { container } = renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      expect(screen.getByText('Entry 1')).toBeTruthy()
    })
    const offsetInput = container.querySelector<HTMLInputElement>('input[type="number"]')!
    fireEvent.change(offsetInput, { target: { value: '5' } })
    fireEvent.blur(offsetInput)
    await waitFor(() => {
      expect(window.api.timers.setOffset).toHaveBeenCalledWith(TIMER_ID, 300)
    })
  })

  it('changing + blurring notes calls setNotes; unchanged blur does not (FIELD-06)', async () => {
    const { container } = renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      expect(screen.getByText('Entry 1')).toBeTruthy()
    })
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!
    // Unchanged blur — must NOT call setNotes (value still "old notes")
    fireEvent.blur(textarea)
    expect(window.api.timers.setNotes).not.toHaveBeenCalled()
    // Changed blur — calls setNotes
    fireEvent.change(textarea, { target: { value: 'new notes' } })
    fireEvent.blur(textarea)
    await waitFor(() => {
      expect(window.api.timers.setNotes).toHaveBeenCalledWith(TIMER_ID, 'new notes')
    })
  })
})
