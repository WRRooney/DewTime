
import { useEffect, useRef, useState } from 'react'
import styles from './TimestampEditor.module.css'
import { useTimers } from '@/hooks/useTimers'
import { useEntriesForTimer } from '@/hooks/useEntriesForTimer'
import { useSetEntryStart, useSetEntryEnd } from '@/hooks/useSetEntryTimestamps'
import { useDeleteEntry } from '@/hooks/useDeleteEntry'
import { useStopTimer } from '@/hooks/useStopTimer'
import { useSetOffset } from '@/hooks/useSetOffset'
import { useSetNotes } from '@/hooks/useSetNotes'
import { epochToDatetimeLocal, datetimeLocalToEpoch } from '@/utils/epoch-datetime'
import type { TimeEntry } from '@shared/ipc'
import type { EpochSeconds } from '@shared/time'

interface EntryRowProps {
  entry: TimeEntry
  idx: number
  timerId: number
  onCommitStart: (entryId: number, ts: EpochSeconds) => void
  onCommitEnd: (entryId: number, ts: EpochSeconds) => void
  onDelete: (entryId: number) => void
  onStop: (timerId: number) => void
}

/**
 * One editable time-entry row rendered as a `<tr>`. Each datetime-local input
 * is driven by LOCAL draft state so the user can type or pick a date; draft
 * resyncs from the persisted entry after a save (refetch) or external change.
 */
function EntryRow({ entry, idx, timerId, onCommitStart, onCommitEnd, onDelete, onStop }: EntryRowProps): JSX.Element {
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
    <tr className={`${styles.entryRow}${isRunning ? ` ${styles.runningRow}` : ''}`}>
      {/* # — 1-based monospace index */}
      <td className={styles.cellIndex}>{idx + 1}</td>

      {/* Start cell */}
      <td className={styles.cellStart}>
        <input
          type="datetime-local"
          step="1"
          className={styles.datetimeInput}
          value={startStr}
          onChange={(e) => handleStartChange(e.target.value)}
          onBlur={() => {
            if (datetimeLocalToEpoch(startStr) === null) {
              setStartStr(epochToDatetimeLocal(entry.start_timestamp))
            }
          }}
        />
      </td>

      {/* End cell — Stop button for running entry, editable input for stopped */}
      <td className={styles.cellEnd}>
        {isRunning ? (
          <button
            type="button"
            className={styles.stopBtn}
            aria-label="Stop timer"
            onClick={() => onStop(timerId)}
          >
            Stop
          </button>
        ) : (
          <input
            type="datetime-local"
            step="1"
            className={styles.datetimeInput}
            value={endStr}
            onChange={(e) => handleEndChange(e.target.value)}
            onBlur={() => {
              if (datetimeLocalToEpoch(endStr) === null) {
                setEndStr(entry.end_timestamp !== null ? epochToDatetimeLocal(entry.end_timestamp) : '')
              }
            }}
          />
        )}
      </td>

      {/* Delete cell — available for ALL rows including running */}
      <td className={styles.cellDelete}>
        <button
          type="button"
          className={styles.entryDelete}
          aria-label={`Delete entry ${idx + 1}`}
          title="Delete entry"
          onClick={() => onDelete(entry.id)}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M2.5 4h11M6.5 4V2.8c0-.4.3-.8.8-.8h1.4c.5 0 .8.4.8.8V4M4 4l.6 9c0 .5.4.9.9.9h5c.5 0 .9-.4.9-.9L12 4M6.5 7v4M9.5 7v4" />
          </svg>
        </button>
      </td>
    </tr>
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
  const deleteEntry = useDeleteEntry()
  const stopTimer = useStopTimer()
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
      {/* Header — the popup title ("<description>"). */}
      <h1 className={styles.heading}>
        {timer?.description?.trim() || 'Untitled timer'}
      </h1>

      {/* Entries table */}
      <div className={styles.entriesList}>
        {entries && entries.length === 0 && (
          <p className={styles.noEntries}>No time entries recorded yet.</p>
        )}
        {entries && entries.length > 0 && (
          <table className={styles.entriesTable}>
            <thead>
              <tr>
                <th className={`${styles.thCell} ${styles.thIndex}`}>#</th>
                <th className={`${styles.thCell} ${styles.thStart}`}>Start</th>
                <th className={`${styles.thCell} ${styles.thEnd}`}>End</th>
                <th className={`${styles.thCell} ${styles.thDelete}`}>Delete</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, idx) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  idx={idx}
                  timerId={timerId}
                  onCommitStart={(entryId, ts) => setStart.mutate({ entryId, ts })}
                  onCommitEnd={(entryId, ts) => setEnd.mutate({ entryId, ts })}
                  onDelete={(entryId) => deleteEntry.mutate({ entryId })}
                  onStop={(tid) => stopTimer.mutate(tid)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Offset section */}
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
              // parseInt not parseFloat; negatives allowed.
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

      {/* Notes section */}
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
