// Composition root. <CalendarPickerDialog /> is mounted ONCE here at App scope
// (not inside DateNavToolbar) to avoid unmount/remount on per-second toolbar
// re-renders. <TickBridge /> subscribes to tick:update before any cell renders.
// TimestampEditor opens in a SEPARATE OS window via window.api.editor.open.
import { useRef } from 'react'
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

export function App(): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  const handleOpenSettings = (): void => {
    dialogRef.current?.showModal()
  }

  const handleOpenProjects = (): void => {
    // Projects manager opens in its own OS window (resizable/movable),
    // not an in-renderer dialog. Fire-and-forget IPC.
    void window.api.projects.openManager().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('projects.openManager IPC failed:', err)
    })
  }

  return (
    <SettingsProvider>
      <TickBridge />
      <TitleBar onOpenSettings={handleOpenSettings} />
      <main className={styles.main}>
        <DateNavToolbar />
        <div className={styles.toolbar}>
          <AddTimerButton />
        </div>
        <div className={styles.tableWrap}>
          <TimerTable />
        </div>
      </main>
      <AppFooter onOpenProjects={handleOpenProjects} />
      <SettingsDialog ref={dialogRef} />
      <ConfirmDialog />
      <CalendarPickerDialog />
    </SettingsProvider>
  )
}
