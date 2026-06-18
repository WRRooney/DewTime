// Composition root. <CalendarPickerDialog /> is mounted ONCE here at App scope
// (not inside DateNavToolbar) to avoid unmount/remount on per-second toolbar
// re-renders. <TickBridge /> subscribes to tick:update before any cell renders.
// TimestampEditor opens in a SEPARATE OS window via window.api.editor.open.
//
// D-29: three-way tab conditional render — Timers / Gantt / Projects by activeTab.
// On mount, reads 'settings.active_tab' from SQLite and hydrates the store.
// ConfirmEntryDeleteDialog is mounted at App scope (not inside GanttView) so it
// persists across tab switches and never double-mounts.

import { useRef, useEffect } from 'react'
import styles from './App.module.css'
import { SettingsProvider } from '../contexts/SettingsContext'
import { TitleBar } from './TitleBar'
import { SettingsDialog } from './SettingsDialog'
import { TickBridge } from './TickBridge'
import { ConfirmDialog } from './ConfirmDialog'
import { AddTimerButton } from './AddTimerButton'
import { TimerTable } from './timer-table'
import { DateNavToolbar } from './DateNavToolbar'
import { CalendarPickerDialog } from './CalendarPickerDialog'
import { AppFooter } from './AppFooter'
import { GanttView } from './gantt/GanttView'
import { ConfirmEntryDeleteDialog } from './gantt/ConfirmEntryDeleteDialog'
import { ProjectsManager } from './ProjectsManager'
import { useActiveTabStore } from '@/stores/useActiveTabStore'

export function App(): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const activeTab = useActiveTabStore((s) => s.tab)

  const handleOpenSettings = (): void => {
    dialogRef.current?.showModal()
  }

  // Load persisted tab on mount (read-once; hydrates store from SQLite)
  useEffect(() => {
    void window.api.settings.get('settings.active_tab')
      .then((tab) => {
        if (tab === 'timers' || tab === 'gantt' || tab === 'projects') {
          useActiveTabStore.getState().setTab(tab)
        }
      })
      .catch(() => {
        // Default 'timers' stays — settings key not yet seeded or IPC failed
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SettingsProvider>
      <TickBridge />
      <TitleBar onOpenSettings={handleOpenSettings} />
      <main className={styles.main}>
        <DateNavToolbar />
        {activeTab === 'timers' && (
          <>
            <div className={styles.toolbar}>
              <AddTimerButton />
            </div>
            <div className={styles.tableWrap}>
              <TimerTable />
            </div>
          </>
        )}
        {activeTab === 'gantt' && <GanttView />}
        {activeTab === 'projects' && <ProjectsManager />}
      </main>
      <AppFooter />
      <SettingsDialog ref={dialogRef} />
      <ConfirmDialog />
      <ConfirmEntryDeleteDialog />
      <CalendarPickerDialog />
    </SettingsProvider>
  )
}
