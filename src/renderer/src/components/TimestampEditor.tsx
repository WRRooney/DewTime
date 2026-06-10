
import { useEffect, useState } from 'react'
import styles from './TimestampEditor.module.css'
import { useTimers } from '@/hooks/useTimers'
import { useEntriesForTimer } from '@/hooks/useEntriesForTimer'
import { useSetEntryStart, useSetEntryEnd } from '@/hooks/useSetEntryTimestamps'
import { useDeleteEntry } from '@/hooks/useDeleteEntry'
import { useStopTimer } from '@/hooks/useStopTimer'
import { useSetOffset } from '@/hooks/useSetOffset'
import { useSetNotes } from '@/hooks/useSetNotes'
import { epochToDisplay, displayToEpoch } from '@/utils/epoch-datetime'
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
 * One editable time-entry row rendered as a `<tr>`. Each timestamp is a free
 * text input formatted as "m/d/yy h:mm:ss a", driven by LOCAL draft state so
 * the user can type a value; the draft resyncs from the persisted entry after
 * a save (refetch) or external change.
 */
function EntryRow({ entry, idx, timerId, onCommitStart, onCommitEnd, onDelete, onStop }: EntryRowProps): JSX.Element {
  const isRunning = entry.end_timestamp === null
  const [startStr, setStartStr] = useState(() => epochToDisplay(entry.start_timestamp))
  const [endStr, setEndStr] = useState(() =>
    entry.end_timestamp !== null ? epochToDisplay(entry.end_timestamp) : '',
  )

  useEffect(() => {
    setStartStr(epochToDisplay(entry.start_timestamp))
  }, [entry.start_timestamp])
  useEffect(() => {
    setEndStr(entry.end_timestamp !== null ? epochToDisplay(entry.end_timestamp) : '')
  }, [entry.end_timestamp])

  // Free text can't commit per keystroke (a partial string parses as invalid),
  // so commit on BLUR (and Enter). A valid+changed value mutates; anything else
  // resets the draft to the persisted value so the field never shows garbage.
  const commitStart = (): void => {
    const ts = displayToEpoch(startStr)
    if (ts !== null && ts !== entry.start_timestamp) {
      onCommitStart(entry.id, ts)
    } else if (ts === null) {
      setStartStr(epochToDisplay(entry.start_timestamp))
    }
  }
  const commitEnd = (): void => {
    if (isRunning) return
    const ts = displayToEpoch(endStr)
    if (ts !== null && ts !== entry.end_timestamp) {
      onCommitEnd(entry.id, ts)
    } else if (ts === null) {
      setEndStr(entry.end_timestamp !== null ? epochToDisplay(entry.end_timestamp) : '')
    }
  }

  return (
    <tr className={`${styles.entryRow}${isRunning ? ` ${styles.runningRow}` : ''}`}>
      {/* # — 1-based monospace index */}
      <td className={styles.cellIndex}>{idx + 1}</td>

      {/* Start cell */}
      <td className={styles.cellStart}>
        <input
          type="text"
          inputMode="text"
          className={styles.datetimeInput}
          aria-label={`Start time, entry ${idx + 1}`}
          placeholder="m/d/yy h:mm:ss am"
          value={startStr}
          onChange={(e) => setStartStr(e.target.value)}
          onBlur={commitStart}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
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
            type="text"
            inputMode="text"
            className={styles.datetimeInput}
            aria-label={`End time, entry ${idx + 1}`}
            placeholder="m/d/yy h:mm:ss am"
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            onBlur={commitEnd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
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
