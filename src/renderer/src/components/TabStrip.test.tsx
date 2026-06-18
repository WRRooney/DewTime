// @vitest-environment jsdom
// src/renderer/src/components/TabStrip.test.tsx
// Tests for TabStrip three-tab navigation bound to useActiveTabStore (D-01).
//
// Contract under test:
//   1. Renders exactly three tabs with labels "Timers", "Gantt", "Projects" in order (D-01)
//   2. Each button has role="tab"; active tab has aria-selected="true", others "false"
//   3. Clicking "Gantt" calls useActiveTabStore.setTab('gantt')
//
// Refs:
//   - 09-04-PLAN.md Task 1
//   - 09-UI-SPEC.md §"Tab Strip"
//   - 09-CONTEXT.md D-01

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useActiveTabStore } from '@/stores/useActiveTabStore'

// ---------------------------------------------------------------------------
// Mock window.api.settings.set so setTab write-through doesn't reject
// ---------------------------------------------------------------------------
beforeEach(() => {
  window.api = {
    settings: {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
    },
  } as unknown as typeof window.api

  // Reset store to default tab before each test
  useActiveTabStore.setState({ tab: 'timers' })
})

afterEach(() => {
  cleanup()
})

// ---------------------------------------------------------------------------
// Lazy import after mocks are set up
// ---------------------------------------------------------------------------
async function renderTabStrip() {
  const { TabStrip } = await import('./TabStrip')
  return render(<TabStrip />)
}

describe('TabStrip', () => {
  it('renders exactly three tabs with labels Timers, Gantt, Projects in order (D-01)', async () => {
    await renderTabStrip()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]).toHaveTextContent('Timers')
    expect(tabs[1]).toHaveTextContent('Gantt')
    expect(tabs[2]).toHaveTextContent('Projects')
  })

  it('active tab (timers) has aria-selected="true"; others have aria-selected="false"', async () => {
    await renderTabStrip()

    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')   // Timers = active
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false')  // Gantt = inactive
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false')  // Projects = inactive
  })

  it('clicking Gantt tab calls useActiveTabStore setTab with "gantt"', async () => {
    const user = userEvent.setup()
    await renderTabStrip()

    const ganttTab = screen.getByRole('tab', { name: 'Gantt' })
    await user.click(ganttTab)

    expect(useActiveTabStore.getState().tab).toBe('gantt')
    expect(window.api.settings.set).toHaveBeenCalledWith('settings.active_tab', 'gantt')
  })

  it('after switching to Gantt, Gantt tab has aria-selected="true" and Timers has "false"', async () => {
    useActiveTabStore.setState({ tab: 'gantt' })
    await renderTabStrip()

    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')  // Timers = inactive
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')   // Gantt = active
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false')  // Projects = inactive
  })
})
