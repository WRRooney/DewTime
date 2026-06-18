// src/renderer/src/components/TabStrip.tsx
// Three-tab navigation component bound to useActiveTabStore (D-01).
//
// Renders Timers | Gantt | Projects tabs in that exact order.
// Active tab: --font-weight-semibold + 2px bottom border --color-accent (per UI-SPEC).
// Inactive tab: --font-weight-normal + --color-fg-muted.
//
// Refs:
//   - 09-04-PLAN.md Task 1
//   - 09-UI-SPEC.md §"Tab Strip"
//   - 09-CONTEXT.md D-01

import styles from './TabStrip.module.css'
import { useActiveTabStore } from '@/stores/useActiveTabStore'
import type { ActiveTab } from '@/stores/useActiveTabStore'

const TABS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'timers', label: 'Timers' },
  { id: 'gantt', label: 'Gantt' },
  { id: 'projects', label: 'Projects' },
]

export function TabStrip(): JSX.Element {
  const tab = useActiveTabStore((s) => s.tab)
  const setTab = useActiveTabStore((s) => s.setTab)

  return (
    <nav className={styles.tabStrip} aria-label="Main navigation">
      {TABS.map(({ id, label }) => {
        const isActive = tab === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}
