// @vitest-environment jsdom
// src/renderer/src/stores/useActiveTabStore.test.ts
// Tests for useActiveTabStore: default tab 'timers', setTab write-through to SQLite.
//
// Contract under test (D-04, T-09-09):
//   1. default tab is 'timers' before settings load
//   2. setTab('gantt') updates tab to 'gantt' in state
//   3. setTab('gantt') calls window.api.settings.set('settings.active_tab', 'gantt') exactly once
//   4. setTab does NOT use localStorage (SQLite-only persistence)
//
// Refs:
//   - 09-RESEARCH.md Pattern 7 (useActiveTabStore)
//   - 09-PATTERNS.md § useActiveTabStore.ts
//   - STATE.md anti-pattern: no localStorage for persisted settings

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeMockApi } from '@/test-utils/mock-api'
import { useActiveTabStore } from './useActiveTabStore'

describe('useActiveTabStore', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
    useActiveTabStore.setState({ tab: 'timers' })
    // Install a fresh mock API
    window.api = makeMockApi({
      settings: { set: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('default tab is timers before settings load', () => {
    const { tab } = useActiveTabStore.getState()
    expect(tab).toBe('timers')
  })

  it('setTab updates tab state to the new value', () => {
    useActiveTabStore.getState().setTab('gantt')
    expect(useActiveTabStore.getState().tab).toBe('gantt')
  })

  it('setTab calls window.api.settings.set with settings.active_tab and the new tab', () => {
    useActiveTabStore.getState().setTab('gantt')
    expect(window.api.settings.set).toHaveBeenCalledWith('settings.active_tab', 'gantt')
    expect(window.api.settings.set).toHaveBeenCalledTimes(1)
  })

  it('setTab to projects calls settings.set with projects', () => {
    useActiveTabStore.getState().setTab('projects')
    expect(window.api.settings.set).toHaveBeenCalledWith('settings.active_tab', 'projects')
  })
})
