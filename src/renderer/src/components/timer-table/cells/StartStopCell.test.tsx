// @vitest-environment jsdom
// src/renderer/src/components/timer-table/cells/StartStopCell.test.tsx
// Tests for StartStopCell click → mutation behavior (D-26, D-32).
//
// Contract under test:
//   1. timer.running = false → click → window.api.timeEntries.start called with timer.id
//   2. timer.running = true  → click → window.api.timeEntries.stop called with timer.id
//
// Refs:
//   - 04-CONTEXT.md D-26 (start/stop button; no optimistic update)
//   - 04-CONTEXT.md D-32 (Phase 4 renderer test coverage)
//   - 04-UI-SPEC.md § StartStopCell Option B (running derived from Timer.running)
//   - Anti-pattern A-13 (StartStopCell does NOT subscribe to the tick store)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { StartStopCell } from './StartStopCell'
import type { Timer } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 7,
    project_id: null,
    description: 'Test timer',
    notes: '',
    created_at: 1700000000,
    offset: null,
    totalSeconds: 0,
    running: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartStopCell', () => {
  beforeEach(() => {
    window.api = makeMockApi({
      timeEntries: {
        start: vi.fn().mockResolvedValue({ id: 1, timer_id: 7, start_timestamp: 1700000000, end_timestamp: null }),
        stop: vi.fn().mockResolvedValue({ id: 1, timer_id: 7, start_timestamp: 1700000000, end_timestamp: 1700001000 }),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('click fires timeEntries.start with timer.id when timer is not running', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ running: false })

    renderWithProviders(<StartStopCell timer={timer} />)

    const btn = screen.getByRole('button', { name: 'Start timer' })
    await user.click(btn)

    expect(window.api.timeEntries.start).toHaveBeenCalledWith(7)
    expect(window.api.timeEntries.stop).not.toHaveBeenCalled()
  })

  it('click fires timeEntries.stop with timer.id when timer is running', async () => {
    const user = userEvent.setup()
    const timer = makeTimer({ running: true })

    renderWithProviders(<StartStopCell timer={timer} />)

    const btn = screen.getByRole('button', { name: 'Stop timer' })
    await user.click(btn)

    expect(window.api.timeEntries.stop).toHaveBeenCalledWith(7)
    expect(window.api.timeEntries.start).not.toHaveBeenCalled()
  })
})
