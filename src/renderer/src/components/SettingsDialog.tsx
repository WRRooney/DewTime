// src/renderer/src/components/SettingsDialog.tsx
// Native HTML <dialog> Settings modal (D-13). Opened imperatively by App via
// dialogRef.current?.showModal() (D-08, UI-SPEC A-05 forbids state-driven
// open). Phase 3 surfaces ONLY the week-start radios (Monday=0 / Sunday=6;
// D-16). OK / Cancel / Apply semantics per D-14:
//   - Cancel discards local draft + close()
//   - Apply persists via window.api.settings.set + keeps dialog open
//   - OK persists + close()
//   - ESC fires native `cancel` event → handler runs (discards draft) → dialog closes
//
// Form uses <form method="dialog"> so pressing Enter on a focused control
// triggers OK (the <button type="submit">). Cancel/Apply are type="button" so
// they don't trigger submit. On IPC error we surface the inline string from
// UI-SPEC § Copywriting verbatim — "Could not save settings. Try again." —
// in role="status" aria-live="polite" so screen readers announce the failure.
//
// Refs:
//   - 03-UI-SPEC.md § Settings dialog (visual + copy contract)
//   - 03-CONTEXT.md D-13, D-14, D-15, D-16, D-17
//   - 03-RESEARCH.md § Pattern 8 (SettingsDialog literal),
//     § Pitfall 7 (onCancel cannot preventDefault — discard only)
import { forwardRef, useEffect, useState, type FormEvent } from 'react'
import styles from './SettingsDialog.module.css'
import { useSettings, type WeekStart } from '../contexts/SettingsContext'

export const SettingsDialog = forwardRef<HTMLDialogElement>(
  function SettingsDialog(_, ref): JSX.Element {
    const { weekStart, setWeekStart } = useSettings()
    const [draft, setDraft] = useState<WeekStart>(weekStart)
    const [error, setError] = useState<string | null>(null)

    // Defensive sync: if the context's weekStart changes from another source
    // (e.g., the Provider's mount-time refresh resolves AFTER the dialog has
    // already rendered with the seeded default), update the draft on the next
    // open. The dialog uses controlled radios so the draft is the single
    // source of truth for the form.
    useEffect(() => {
      setDraft(weekStart)
    }, [weekStart])

    const close = (): void => {
      if (typeof ref === 'object' && ref !== null && ref.current !== null) {
        ref.current.close()
      }
    }

    /**
     * Returns true on successful persist. On failure, surfaces the UI-SPEC
     * inline error string and returns false so OK can keep the dialog open.
     */
    const persist = async (): Promise<boolean> => {
      try {
        await window.api.settings.set('settings.week_start', draft)
        await setWeekStart(draft)
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
          {error !== null && (
            <p className={styles.error} role="status" aria-live="polite">
              {error}
            </p>
          )}
          <footer className={styles.footer}>
            {/* Button labels kept inline (no whitespace between the opening
                tag close and the glyph) so the UI-SPEC SET-03 verifier grep
                gate matches each label verbatim — see 03-VALIDATION.md. */}
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
