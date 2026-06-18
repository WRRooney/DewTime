// Active tab store with SQLite write-through persistence (D-04, D-16, T-09-09).
//
// Rules:
//   - Default tab is 'timers' before settings load; App.tsx reads persisted value on mount.
//   - setTab writes to SQLite via window.api.settings.set — NOT localStorage.
//   - NO Zustand persist middleware — SQLite is the single source of truth.
//
// Refs:
//   - 09-RESEARCH.md Pattern 7
//   - 09-PATTERNS.md § useActiveTabStore.ts

import { create } from 'zustand'

export type ActiveTab = 'timers' | 'gantt' | 'projects'

interface ActiveTabState {
  /** Currently active tab. Defaults to 'timers' before settings load. */
  tab: ActiveTab
  /** Set the active tab and write-through to the SQLite settings table. */
  setTab: (tab: ActiveTab) => void
}

export const useActiveTabStore = create<ActiveTabState>((set) => ({
  tab: 'timers', // default before settings load; App.tsx loads persisted value on mount
  setTab: (tab) => {
    set({ tab })
    // Write-through to SQLite settings table (NOT localStorage — see STATE.md rule)
    void window.api.settings.set('settings.active_tab', tab)
  },
}))
