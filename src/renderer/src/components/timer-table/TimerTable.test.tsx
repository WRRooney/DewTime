// @vitest-environment jsdom
// src/renderer/src/components/timer-table/TimerTable.test.tsx
// Render-smoke tests for <TimerTable /> (D-32).
//
// Contract under test:
//   1. Renders 6-column headers (Phase 5 D-05): Project #, Project, Description, Duration
//      plus the two empty-header icon columns (startStop, delete).
//   2. Timestamps and Notes headers are ABSENT (stubs removed in D-05).
//   3. Renders description text for each seeded timer row.
//   4. Empty state copy visible when timers list is empty.
//
// Mock strategy (D-33): set window.api in beforeEach.
//   - timers.list: resolved mock with test fixtures.
//   - projects.list: resolved empty list (ProjectCell + ProjectNumberCell use useProjects()).
//   - timeEntries.listByTimer: resolved empty list (safety guard for any time-entry hooks).
//   renderWithProviders wraps in a fresh QueryClientProvider per test (no cache leak).
//
// A-13 note: TimerTable itself does NOT import the tick store — only DurationCell does.
//
// Refs:
//   - 05-UI-SPEC.md § Column reconciliation D-05 (6-column order)
//   - 04-UI-SPEC.md § TimerTable (empty state copy / column headers)
//   - 04-CONTEXT.md D-32 (Phase 4 renderer test coverage ≥ 3 cases)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { TimerTable } from './TimerTable'
import type { Timer } from '@shared/ipc'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 1,
    project_id: null,
    description: 'Test timer',
    notes: '',
    created_at: 1700000000 as Timer['created_at'],
    offset: null,
    totalSeconds: 0,
    running: false,
    ...overrides,
  }
}

const sampleTimers: Timer[] = [
  makeTimer({ id: 1, description: 'Fix login redirect' }),
  makeTimer({ id: 2, description: 'Write Phase 4 plan' }),
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TimerTable', () => {
  beforeEach(() => {
    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue(sampleTimers),
      },
      projects: {
        list: vi.fn().mockResolvedValue([]),
      },
      timeEntries: {
        listByTimer: vi.fn().mockResolvedValue([]),
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders Description column header once query resolves', async () => {
    renderWithProviders(<TimerTable />)
    await screen.findByText('Description')
    expect(screen.getByText('Description')).toBeInTheDocument()
  })

  it('renders a single PROJECT header over the project #/name pair', async () => {
    renderWithProviders(<TimerTable />)
    await screen.findByText('PROJECT')
    expect(screen.getByText('PROJECT')).toBeInTheDocument()
    // The old split headers are gone — PROJECT now spans both project columns.
    expect(screen.queryByText('Project #')).not.toBeInTheDocument()
  })

  it('does not render Timestamps or Notes column headers (stubs removed in D-05)', async () => {
    renderWithProviders(<TimerTable />)
    // Wait for table to settle
    await screen.findByText('Description')
    expect(screen.queryByText('Timestamps')).not.toBeInTheDocument()
    expect(screen.queryByText('Notes')).not.toBeInTheDocument()
  })

  it('renders both sample timer descriptions after data loads', async () => {
    renderWithProviders(<TimerTable />)
    await screen.findByText('Fix login redirect')
    expect(screen.getByText('Fix login redirect')).toBeInTheDocument()
    expect(screen.getByText('Write Phase 4 plan')).toBeInTheDocument()
  })

  it('shows empty-state copy when timers list is empty', async () => {
    window.api = makeMockApi({
      timers: {
        list: vi.fn().mockResolvedValue([]),
      },
      projects: {
        list: vi.fn().mockResolvedValue([]),
      },
      timeEntries: {
        listByTimer: vi.fn().mockResolvedValue([]),
      },
    })

    renderWithProviders(<TimerTable />)

    await screen.findByText('No timers yet. Click + Add Timer to create one.')
    expect(screen.getByText('No timers yet. Click + Add Timer to create one.')).toBeInTheDocument()
  })
})
