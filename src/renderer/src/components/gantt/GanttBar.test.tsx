// @vitest-environment jsdom
// src/renderer/src/components/gantt/GanttBar.test.tsx
//
// Behavior under test:
//   1. running-handle-omitted: running entry (end IS NULL) renders NO right-edge handle (D-19, Pitfall 2)
//   2. both-handles: stopped entry renders both left and right edge handles
//   3. min-width: tiny-duration entry renders at >= 8px width (D-28)
//   4. dblclick-editor: double-click calls window.api.editor.open with timer_id (D-23)
//   5. delete-opens-confirm: pressing Delete on a selected bar opens useConfirmDeleteEntryStore (D-24)
//
// Refs:
//   - 09-05-PLAN.md acceptance_criteria
//   - 09-UI-SPEC.md §Bars §Running bar §Bar Selection and Deletion

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { GanttBar } from './GanttBar'
import { useConfirmDeleteEntryStore } from '@/stores/useConfirmDeleteEntryStore'
import type { TimeEntry, Timer } from '@shared/ipc'
import type { GanttViewport } from '@/utils/gantt-math'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockViewport: GanttViewport = {
  startEpoch: 0 as import('@shared/time').EpochSeconds,
  spanSeconds: 3600,       // 1 hour
  canvasWidthPx: 1000,
}

const mockTimer: Timer = {
  id: 1,
  project_id: null,
  description: 'Test Timer',
  notes: '',
  offset: null,
  created_at: 0 as import('@shared/time').EpochSeconds,
  totalSeconds: 0,
  running: false,
}

const mockRunningTimer: Timer = {
  ...mockTimer,
  running: true,
}

/** A stopped entry spanning 10 min (600s) in the viewport */
const stoppedEntry: TimeEntry = {
  id: 10,
  timer_id: 1,
  start_timestamp: 600 as import('@shared/time').EpochSeconds,  // x = 166.7px
  end_timestamp: 1200 as import('@shared/time').EpochSeconds,   // x = 333.3px
}

/** A running entry (end IS NULL) */
const runningEntry: TimeEntry = {
  id: 11,
  timer_id: 1,
  start_timestamp: 600 as import('@shared/time').EpochSeconds,
  end_timestamp: null,
}

/** A tiny-duration stopped entry: 1 second (much less than 8px at this zoom) */
const tinyEntry: TimeEntry = {
  id: 12,
  timer_id: 1,
  start_timestamp: 600 as import('@shared/time').EpochSeconds,
  end_timestamp: 601 as import('@shared/time').EpochSeconds, // only ~0.28px at 1000px/3600s
}

function makeBar(overrides: {
  entry?: TimeEntry
  timer?: Timer
  selected?: boolean
  onSelect?: (id: number) => void
}) {
  return renderWithProviders(
    <GanttBar
      entry={overrides.entry ?? stoppedEntry}
      timer={overrides.timer ?? mockTimer}
      viewport={mockViewport}
      color="hsl(210 35% 55%)"
      selected={overrides.selected ?? false}
      onSelect={overrides.onSelect ?? vi.fn()}
      onDragTooltip={vi.fn()}
    />
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GanttBar', () => {
  beforeEach(() => {
    window.api = makeMockApi({
      editor: { open: vi.fn().mockResolvedValue(undefined) },
      timeEntries: {
        stop: vi.fn().mockResolvedValue(null),
        setStart: vi.fn().mockResolvedValue(undefined),
        setEnd: vi.fn().mockResolvedValue(undefined),
        setTimestamps: vi.fn().mockResolvedValue(undefined),
      },
    })
    // Reset the confirm store state between tests
    useConfirmDeleteEntryStore.setState({ pendingDelete: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('running-handle-omitted: running entry does NOT render right-edge handle in DOM (D-19)', () => {
    makeBar({ entry: runningEntry, timer: mockRunningTimer })

    // Left edge handle should be present
    expect(screen.getByTestId('edge-handle-start')).toBeInTheDocument()
    // Right edge handle must be absent from the DOM entirely (Pitfall 2 — DOM omission)
    expect(screen.queryByTestId('edge-handle-end')).toBeNull()
  })

  it('both-handles: stopped entry renders both left and right edge handles', () => {
    makeBar({ entry: stoppedEntry, timer: mockTimer })

    expect(screen.getByTestId('edge-handle-start')).toBeInTheDocument()
    expect(screen.getByTestId('edge-handle-end')).toBeInTheDocument()
  })

  it('min-width: tiny-duration entry renders at >= 8px width (D-28)', () => {
    makeBar({ entry: tinyEntry, timer: mockTimer })

    const bar = screen.getByTestId('gantt-bar')
    const style = bar.getAttribute('style') ?? ''
    // Parse width from inline style. min-width is 8px by CSS, but we also clamp
    // inline width to at least 8px.
    const widthMatch = /width:\s*([\d.]+)px/.exec(style)
    const width = widthMatch ? parseFloat(widthMatch[1] ?? '0') : 0
    expect(width).toBeGreaterThanOrEqual(8)
  })

  it('dblclick-editor: double-click calls window.api.editor.open with timer_id (D-23)', async () => {
    const user = userEvent.setup()
    makeBar({ entry: stoppedEntry, timer: mockTimer })

    const bar = screen.getByTestId('gantt-bar')
    await user.dblClick(bar)

    expect(window.api.editor.open).toHaveBeenCalledWith(mockTimer.id)
  })

  it('delete-opens-confirm: pressing Delete on a selected bar opens useConfirmDeleteEntryStore (D-24)', () => {
    makeBar({ entry: stoppedEntry, timer: mockTimer, selected: true })

    const bar = screen.getByTestId('gantt-bar')
    bar.focus()
    fireEvent.keyDown(bar, { key: 'Delete' })

    expect(useConfirmDeleteEntryStore.getState().pendingDelete).not.toBeNull()
    expect(useConfirmDeleteEntryStore.getState().pendingDelete?.id).toBe(stoppedEntry.id)
  })
})
