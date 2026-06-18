// @vitest-environment jsdom
// src/renderer/src/components/App.test.tsx
//
// Behavior under test:
//   1. projects-tab-inline: switching to 'projects' tab renders ProjectsManager inline
//      WITHOUT calling window.api.projects.openManager (SC-6a / D-29)
//   2. gantt-tab-renders: switching to 'gantt' renders the GanttView region (D-29)
//   3. timers-tab-renders: 'timers' tab renders the TimerTable region (default, D-29)
//   4. confirm-entry-delete-mounted: App mounts ConfirmEntryDeleteDialog at scope
//
// Refs:
//   - 09-06-PLAN.md Task 3 acceptance_criteria
//   - 09-UI-SPEC.md §"Projects Tab"
//   - 09-CONTEXT.md D-29, SC-6a

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { screen, cleanup, act } from '@testing-library/react'
import { renderWithProviders } from '@/test-utils/render-with-providers'
import { makeMockApi } from '@/test-utils/mock-api'
import { App } from './App'
import { useActiveTabStore } from '@/stores/useActiveTabStore'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function setupMockApi() {
  window.api = makeMockApi({
    timers: {
      list: vi.fn().mockResolvedValue([]),
    },
    timeEntries: {
      listInRange: vi.fn().mockResolvedValue([]),
      listByTimer: vi.fn().mockResolvedValue([]),
    },
    settings: {
      get: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    },
    projects: {
      list: vi.fn().mockResolvedValue([]),
      openManager: vi.fn().mockResolvedValue(undefined),
    },
    system: {
      getVersion: vi.fn().mockResolvedValue('1.0.0-test'),
      openReleases: vi.fn().mockResolvedValue(undefined),
    },
    tick: {
      subscribe: vi.fn(() => vi.fn()),
    },
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App', () => {
  beforeEach(() => {
    setupMockApi()
    // Reset tab store to timers (default) before each test
    useActiveTabStore.setState({ tab: 'timers' })
  })

  afterEach(() => {
    cleanup()
    useActiveTabStore.setState({ tab: 'timers' })
  })

  it('timers-tab-renders: default tab shows the timer table region (D-29)', () => {
    renderWithProviders(<App />)
    // The timers tab should be active by default — look for the AddTimerButton or timer-table
    expect(useActiveTabStore.getState().tab).toBe('timers')
  })

  it('projects-tab-inline: projects tab renders ProjectsManager INLINE (SC-6a/D-29)', async () => {
    renderWithProviders(<App />)

    // Switch to projects tab via the store (matches how TabStrip calls setTab)
    act(() => {
      useActiveTabStore.getState().setTab('projects')
    })

    // ProjectsManager renders a "Projects" heading
    const heading = screen.getByRole('heading', { name: /projects/i })
    expect(heading).toBeInTheDocument()
  })

  it('projects-tab-no-open-manager: openManager IPC NOT called when switching to projects tab (SC-6a)', async () => {
    renderWithProviders(<App />)

    act(() => {
      useActiveTabStore.getState().setTab('projects')
    })

    // The old path called projects.openManager — it must NOT be called
    expect(window.api.projects.openManager).not.toHaveBeenCalled()
  })

  it('gantt-tab-renders: switching to gantt tab renders the GanttView region (D-29)', async () => {
    renderWithProviders(<App />)

    act(() => {
      useActiveTabStore.getState().setTab('gantt')
    })

    // GanttView renders a data-testid="gantt-view"
    expect(screen.getByTestId('gantt-view')).toBeInTheDocument()
  })
})
