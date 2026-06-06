import styles from './TitleBar.module.css'
import { useThemeStore } from '@/stores/useThemeStore'

interface TitleBarProps {
  onOpenSettings: () => void
}

export function TitleBar({ onOpenSettings }: TitleBarProps): JSX.Element {
  const theme = useThemeStore((s) => s.theme)
  const toggleTheme = useThemeStore((s) => s.toggle)
  const handleClose = (): void => {
    // Fire-and-forget; the close handler in main calls BrowserWindow.close()
    // which tears down the renderer mid-promise. Errors here surface only if
    // the IPC bridge itself is broken — log to console for the dev who hit it.
    void window.api.system.closeWindow().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('closeWindow IPC failed:', err)
    })
  }

  return (
    <header className={styles.titleBar}>
      <div className={styles.brand}>
        {/* DewTime brand mark (clock crescent + rising checkmark). Fill flows
            from `currentColor` so it tracks the title bar fg in both themes. */}
        <svg
          className={styles.logo}
          width="18"
          height="18"
          viewBox="0 0 37.027561 33.15612"
          fill="currentColor"
          aria-hidden="true"
          focusable="false"
        >
          <g transform="translate(-109.85841,-123.49065)">
            <path d="m 126.52226,124.22753 a 15.841228,15.841228 0 0 0 -15.84093,15.84093 15.841228,15.841228 0 0 0 15.84093,15.84143 15.841228,15.841228 0 0 0 2.46503,-0.19308 15.841228,15.841228 0 0 1 -13.37739,-15.64835 15.841228,15.841228 0 0 1 13.37739,-15.64835 15.841228,15.841228 0 0 0 -2.46503,-0.19258 z" />
            <path d="m 146.05786,129.58823 c -0.13204,-0.13348 -9.0313,2.19998 -9.08088,2.38108 -0.0184,0.0673 0.86267,1.01203 1.98703,2.17071 l -8.80386,8.80387 -4.81153,-4.81894 -2.28825,2.58897 7.09978,7.10027 11.22543,-11.22543 c 1.16659,1.15776 2.1251,2.07209 2.19344,2.05418 0.18162,-0.0476 2.61089,-8.92123 2.47884,-9.05471 z" />
            <rect width="3.5793073" height="1.701638" x="117.76934" y="138.98599" ry="0.85081899" />
            <rect width="3.5793073" height="1.701638" x="169.69678" y="54.428406" ry="0.85081899" transform="rotate(29.803567)" />
            <rect width="3.5793073" height="1.701638" x="171.45546" y="-49.520306" ry="0.85081899" transform="rotate(61.172821)" />
            <rect width="3.5793073" height="1.701638" x="-70.232353" y="183.90828" ry="0.85081899" transform="rotate(-60.157091)" />
            <rect width="3.5793073" height="1.701638" x="26.427578" y="187.21246" ry="0.85081899" transform="rotate(-31.097209)" />
          </g>
        </svg>
        <span className={styles.appName}>DewTime</span>
      </div>
      <div className={styles.actions}>
        {/* Theme toggle — shows the icon of the theme you'll switch TO. */}
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? (
            /* Sun — click to go light */
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="12" cy="12" r="4.5" />
              <path d="M12 1.5v2.5M12 20v2.5M4.2 4.2l1.8 1.8M18 18l1.8 1.8M1.5 12h2.5M20 12h2.5M4.2 19.8l1.8-1.8M18 6l1.8-1.8" />
            </svg>
          ) : (
            /* Moon — click to go dark */
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label="Open settings"
          title="Open settings"
          onClick={onOpenSettings}
        >
          {/* Gear/cog */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${styles.closeBtn}`}
          aria-label="Close window"
          title="Close window"
          onClick={handleClose}
        >
          {/* Close: two crossing strokes */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
    </header>
  )
}
