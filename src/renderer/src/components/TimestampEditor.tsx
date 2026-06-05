// src/renderer/src/components/TimestampEditor.tsx
// Windowless timestamp/offset/notes editor form (FIELD-04/05/06).
//
// Phase 5 UAT follow-up: the editor moved from an in-window modal <dialog> to a
// SEPARATE OS window (see src/main/windows/timestampEditorWindow.ts). This
// component is the form body — it is mounted full-window by <EditorWindow> in the
// editor BrowserWindow. It takes the target `timerId` as a prop (from the
// `#editor=<id>` route) rather than from a renderer store.
//
// Each datetime-local input is driven by LOCAL draft state (EntryRow) so the
// user can type or pick a date — a controlled value with a no-op onChange reverts
// every keystroke/calendar pick.
//
// BUG FIX (missing-seconds): all datetime-local inputs now carry step="1" so
// browsers render and expose the seconds field. epochToDatetimeLocal now returns
// YYYY-MM-DDTHH:mm:ss (19 chars) so the input value includes seconds precision.
//
// Refs:
//   - 05-CONTEXT.md D-08 (running entry end disabled), D-09 (ordering guard), D-11 (offset seconds)

import { useEffect, useRef, useState } from 'react'
import styles from './TimestampEditor.module.css'
import { useTimers } from '@/hooks/useTimers'
import { useEntriesForTimer } from '@/hooks/useEntriesForTimer'
import { useSetEntryStart, useSetEntryEnd } from '@/hooks/useSetEntryTimestamps'
import { useSetOffset } from '@/hooks/useSetOffset'
import { useSetNotes } from '@/hooks/useSetNotes'
import { epochToDatetimeLocal, datetimeLocalToEpoch } from '@/utils/epoch-datetime'
import type { TimeEntry } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'

interface EntryRowProps {
  entry: TimeEntry
  idx: number
  onCommitStart: (entryId: number, ts: EpochSeconds) => void
  onCommitEnd: (entryId: number, ts: EpochSeconds) => void
}

/**
 * One editable time-entry row. Each datetime-local input is driven by LOCAL draft
 * state so the user can type or pick a date; draft resyncs from the persisted
 * entry after a save (refetch) or external change.
 */
function EntryRow({ entry, idx, onCommitStart, onCommitEnd }: EntryRowProps): JSX.Element {
  const isRunning = entry.end_timestamp === null
  const [startStr, setStartStr] = useState(() => epochToDatetimeLocal(entry.start_timestamp))
  const [endStr, setEndStr] = useState(() =>
    entry.end_timestamp !== null ? epochToDatetimeLocal(entry.end_timestamp) : '',
  )
  // Last epoch we sent for each field — dedupes repeated change events so a
  // single calendar pick fires at most one mutation (not one per change event).
  const lastSentStart = useRef<EpochSeconds | null>(entry.start_timestamp)
  const lastSentEnd = useRef<EpochSeconds | null>(entry.end_timestamp)

  useEffect(() => {
    setStartStr(epochToDatetimeLocal(entry.start_timestamp))
    lastSentStart.current = entry.start_timestamp
  }, [entry.start_timestamp])
  useEffect(() => {
    setEndStr(entry.end_timestamp !== null ? epochToDatetimeLocal(entry.end_timestamp) : '')
    lastSentEnd.current = entry.end_timestamp
  }, [entry.end_timestamp])

  // Commit on CHANGE: the datetime-local value is atomic (empty until every
  // field is filled), so this fires once on a calendar pick / completed type-in
  // — not per keystroke — and applies immediately instead of waiting for blur.
  const handleStartChange = (value: string): void => {
    setStartStr(value)
    const ts = datetimeLocalToEpoch(value)
    if (ts !== null && ts !== entry.start_timestamp && ts !== lastSentStart.current) {
      lastSentStart.current = ts
      onCommitStart(entry.id, ts)
    }
  }
  const handleEndChange = (value: string): void => {
    if (isRunning) return
    setEndStr(value)
    const ts = datetimeLocalToEpoch(value)
    if (ts !== null && ts !== entry.end_timestamp && ts !== lastSentEnd.current) {
      lastSentEnd.current = ts
      onCommitEnd(entry.id, ts)
    }
  }

  return (
    <div className={styles.entryRow}>
      {/* Ignition entry index badge ("1.", "2." …) */}
      <span className={styles.entryIndex}>{idx + 1}</span>
      <div className={styles.entryBody}>
        <span className={styles.entryLabel}>
          Entry {idx + 1}{isRunning ? ' (running)' : ''}
        </span>
        <div className={styles.entryFields}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Start</label>
          <input
            type="datetime-local"
            step="1"
            className={styles.datetimeInput}
            value={startStr}
            onChange={(e) => handleStartChange(e.target.value)}
            // Revert to the persisted value if the field was emptied/left invalid.
            onBlur={() => {
              if (datetimeLocalToEpoch(startStr) === null) {
                setStartStr(epochToDatetimeLocal(entry.start_timestamp))
              }
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>End</label>
          <input
            type="datetime-local"
            step="1"
            className={`${styles.datetimeInput}${isRunning ? ` ${styles.disabled}` : ''}`}
            value={endStr}
            disabled={isRunning}
            onChange={(e) => handleEndChange(e.target.value)}
            onBlur={() => {
              if (!isRunning && datetimeLocalToEpoch(endStr) === null) {
                setEndStr(entry.end_timestamp !== null ? epochToDatetimeLocal(entry.end_timestamp) : '')
              }
            }}
          />
        </div>
        </div>
      </div>
    </div>
  )
}

interface TimestampEditorProps {
  timerId: number
}

/** Timestamp/offset/notes editor form for one timer. Mounted full-window by EditorWindow. */
export function TimestampEditor({ timerId }: TimestampEditorProps): JSX.Element {
  const { data: timers } = useTimers()
  const timer = timers?.find((t) => t.id === timerId) ?? null

  const { data: entries } = useEntriesForTimer(timerId)

  const setStart = useSetEntryStart()
  const setEnd = useSetEntryEnd()
  const setOffset = useSetOffset()
  const setNotes = useSetNotes()

  const [offsetMinutes, setOffsetMinutes] = useState<number>(0)
  const [notesValue, setNotesValue] = useState<string>('')

  // Resync local draft when the timer resolves / changes.
  useEffect(() => {
    if (timer !== null) {
      // Round to whole minutes so a no-op blur cannot truncate a sub-minute offset.
      setOffsetMinutes(Math.round((timer.offset ?? 0) / 60))
      setNotesValue(timer.notes ?? '')
    }
  }, [timer])

  return (
    <div className={styles.body}>
      {/* Header — echoes the Ignition popup title ("<description>"). */}
      <h1 className={styles.heading}>
        {timer?.description?.trim() || 'Untitled timer'}
      </h1>

      {/* Entries list (FIELD-04) */}
      <div className={styles.entriesList}>
        {entries && entries.length === 0 && (
          <p className={styles.noEntries}>No time entries recorded yet.</p>
        )}
        {entries?.map((entry, idx) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            idx={idx}
            onCommitStart={(entryId, ts) => setStart.mutate({ entryId, ts })}
            onCommitEnd={(entryId, ts) => setEnd.mutate({ entryId, ts })}
          />
        ))}
      </div>

      {/* Offset section (FIELD-05 / D-11) — Ignition inline "Offset [ 0.0 ] min" row */}
      <div className={styles.section}>
        <div className={styles.offsetRow}>
          <label className={styles.sectionLabel} htmlFor={`offset-${timerId}`}>
            Offset
          </label>
          <input
            id={`offset-${timerId}`}
            type="number"
            step="1"
            className={styles.offsetInput}
            value={offsetMinutes}
            onChange={(e) => setOffsetMinutes(Number(e.target.value))}
            onBlur={() => {
              // Pitfall 4: parseInt not parseFloat; negatives allowed (D-11).
              const seconds = Math.round(parseInt(String(offsetMinutes), 10) * 60) || 0
              // Only persist on real change — a no-op blur must not rewrite the stored offset.
              if (seconds !== (timer?.offset ?? 0)) {
                setOffset.mutate({ id: timerId, offsetSeconds: seconds })
              }
            }}
          />
          <span className={styles.offsetUnit}>min</span>
        </div>
      </div>

      {/* Notes section (FIELD-06) */}
      <div className={styles.section}>
        <label className={styles.sectionLabel} htmlFor={`notes-${timerId}`}>
          Notes
        </label>
        <textarea
          id={`notes-${timerId}`}
          className={styles.notesTextarea}
          rows={3}
          value={notesValue}
          placeholder="Add notes…"
          onChange={(e) => setNotesValue(e.target.value)}
          onBlur={() => {
            if (notesValue !== (timer?.notes ?? '')) {
              setNotes.mutate({ id: timerId, notes: notesValue || null })
            }
          }}
        />
      </div>
    </div>
  )
}
