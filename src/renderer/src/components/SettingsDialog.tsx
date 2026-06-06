// Native HTML <dialog> Settings modal. Opened imperatively by App via
// dialogRef.current?.showModal() — not state-driven.
// Surfaces the week-start radios (Monday=0 / Sunday=6). OK / Cancel / Apply semantics:
//   - Cancel discards local draft + close()
//   - Apply persists via window.api.settings.set + keeps dialog open
//   - OK persists + close()
//   - ESC fires native `cancel` event → handler runs (discards draft) → dialog closes
//
// Form uses <form method="dialog"> so pressing Enter on a focused control
// triggers OK (the <button type="submit">). Cancel/Apply are type="button" so
// they don't trigger submit. On IPC error we surface an inline error message
// in role="status" aria-live="polite" so screen readers announce the failure.
import { forwardRef, useEffect, useState, type FormEvent } from 'react'
import styles from './SettingsDialog.module.css'
import { useSettings, type WeekStart } from '../contexts/SettingsContext'

export const SettingsDialog = forwardRef<HTMLDialogElement>(
  function SettingsDialog(_, ref): JSX.Element {
    const { weekStart, setWeekStart, alwaysOnTop, setAlwaysOnTop } = useSettings()
    const [draft, setDraft] = useState<WeekStart>(weekStart)
    const [draftAlwaysOnTop, setDraftAlwaysOnTop] = useState<boolean>(alwaysOnTop)
    const [error, setError] = useState<string | null>(null)

    // Defensive sync: if the context's weekStart changes from another source
    // (e.g., the Provider's mount-time refresh resolves AFTER the dialog has
    // already rendered with the seeded default), update the draft on the next
    // open. The dialog uses controlled radios so the draft is the single
    // source of truth for the form.
    useEffect(() => {
      setDraft(weekStart)
    }, [weekStart])

    // Defensive sync for alwaysOnTop — mirrors the weekStart pattern above.
    useEffect(() => {
      setDraftAlwaysOnTop(alwaysOnTop)
    }, [alwaysOnTop])

    const close = (): void => {
      if (typeof ref === 'object' && ref !== null && ref.current !== null) {
        ref.current.close()
      }
    }

    /**
     * Returns true on successful persist, false on failure (so OK can keep the dialog open).
     */
    const persist = async (): Promise<boolean> => {
      try {
        await window.api.settings.set('settings.week_start', draft)
        await setWeekStart(draft)
        await window.api.settings.set('settings.always_on_top', draftAlwaysOnTop)
        await setAlwaysOnTop(draftAlwaysOnTop)
        setError(null)
        return true
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('settings.set failed:', err)
        setError('Could not save settings. Try again.')
        return false
      }
    }

    const handleCancel = (): void => {
      setDraft(weekStart)
      setDraftAlwaysOnTop(alwaysOnTop)
      setError(null)
      close()
    }

    const handleApply = (): void => {
      void persist()
    }

    const handleSubmit = async (
      e: FormEvent<HTMLFormElement>,
    ): Promise<void> => {
      // Preventing default keeps the <form method="dialog"> from auto-closing
      // before persist resolves; we close manually on success.
      e.preventDefault()
      if (await persist()) {
        close()
      }
    }

    return (
      <dialog ref={ref} className={styles.dialog} onCancel={handleCancel}>
        <header className={styles.header}>
          <h2 className={styles.title}>Settings</h2>
        </header>
        <form
          method="dialog"
          className={styles.body}
          onSubmit={handleSubmit}
        >
          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>Week starts on</legend>
            <label className={styles.radioRow}>
              <input
                type="radio"
                name="weekStart"
                value="0"
                checked={draft === 0}
                onChange={() => setDraft(0)}
              />
              Monday
            </label>
            <label className={styles.radioRow}>
              <input
                type="radio"
                name="weekStart"
                value="6"
                checked={draft === 6}
                onChange={() => setDraft(6)}
              />
              Sunday
            </label>
          </fieldset>
          <fieldset className={`${styles.fieldset} ${styles.fieldsetSpaced}`}>
            <legend className={styles.legend}>Window</legend>
            <label className={styles.radioRow}>
              <input
                type="checkbox"
                checked={draftAlwaysOnTop}
                onChange={(e) => setDraftAlwaysOnTop(e.target.checked)}
              />
              Always on top
            </label>
          </fieldset>
          {error !== null && (
            <p className={styles.error} role="status" aria-live="polite">
              {error}
            </p>
          )}
          <footer className={styles.footer}>
            <button type="button" className={styles.btn} onClick={handleCancel}>Cancel</button>
            <button type="button" className={styles.btn} onClick={handleApply}>Apply</button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>OK</button>
          </footer>
        </form>
      </dialog>
    )
  },
)

SettingsDialog.displayName = 'SettingsDialog'
