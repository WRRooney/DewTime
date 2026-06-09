// @vitest-environment jsdom
// src/renderer/src/components/TimestampEditor.test.tsx
// Tests for the windowless TimestampEditor form (FIELD-04/05/06, table-view).
// The editor renders directly with a `timerId` prop (separate editor window)
// — no <dialog>, no open/close store.
//
// Behaviors under test:
//   1. Table renders with #/Start/End/Delete column headers and one row per entry.
//   2. The running entry's End cell shows a Stop control (not a disabled input).
//      Clicking Stop calls window.api.timeEntries.stop with the timer id.
//   3. The running entry's Delete button calls window.api.timeEntries.deleteEntry.
//   4. Editing + blurring a stopped entry's Start input calls timeEntries.setStart (FIELD-04).
//   5. Editing + blurring the offset input calls timers.setOffset with Math.round(min*60) (FIELD-05).
//   6. Changing + blurring notes calls timers.setNotes (FIELD-06); an unchanged blur does NOT.

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
        stop: vi.fn().mockResolvedValue(null),
        deleteEntry: vi.fn().mockResolvedValue(undefined),
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

  it('renders a table with #, Start, End, Delete column headers and one row per entry', async () => {
    renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      // Column headers
      expect(screen.getByRole('columnheader', { name: '#' })).toBeTruthy()
      expect(screen.getByRole('columnheader', { name: /start/i })).toBeTruthy()
      expect(screen.getByRole('columnheader', { name: /end/i })).toBeTruthy()
      expect(screen.getByRole('columnheader', { name: /delete/i })).toBeTruthy()
      // Two body rows
      expect(screen.getAllByRole('row')).toHaveLength(3) // 1 header + 2 body rows
    })
  })

  it('running entry End cell shows a Stop control; clicking it calls timeEntries.stop with timerId', async () => {
    renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      // The Stop button should be present (running entry's End cell)
      expect(screen.getByRole('button', { name: /stop timer/i })).toBeTruthy()
    })
    const stopBtn = screen.getByRole('button', { name: /stop timer/i })
    fireEvent.click(stopBtn)
    await waitFor(() => {
      expect(window.api.timeEntries.stop).toHaveBeenCalledWith(TIMER_ID)
    })
  })

  it('running entry Delete button calls timeEntries.deleteEntry with the running entry id', async () => {
    renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      // Two delete buttons — one per row (both rows are now deletable)
      expect(screen.getAllByRole('button', { name: /delete entry/i })).toHaveLength(2)
    })
    // The running entry is entry id=2 (index 1 = "Delete entry 2")
    const deleteButtons = screen.getAllByRole('button', { name: /delete entry/i })
    fireEvent.click(deleteButtons[1]!) // second row = running entry
    await waitFor(() => {
      expect(window.api.timeEntries.deleteEntry).toHaveBeenCalledWith(2)
    })
  })

  it('a calendar pick (change, no blur) on a stopped Start commits immediately (FIELD-04)', async () => {
    const { container } = renderWithProviders(<TimestampEditor timerId={TIMER_ID} />)
    await waitFor(() => {
      // Wait for table to render
      expect(screen.getByRole('columnheader', { name: '#' })).toBeTruthy()
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
      expect(screen.getByRole('columnheader', { name: '#' })).toBeTruthy()
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
      expect(screen.getByRole('columnheader', { name: '#' })).toBeTruthy()
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
