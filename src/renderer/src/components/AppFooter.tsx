import styles from './AppFooter.module.css'
import { useAppVersion } from '../hooks/useAppVersion'

interface AppFooterProps {
  onOpenProjects: () => void
}

export function AppFooter({ onOpenProjects }: AppFooterProps): JSX.Element {
  const { data: version } = useAppVersion()
  const versionLabel = version ? `v${version}` : 'v—'

  const handleOpenReleases = (): void => {
    // Fire-and-forget; URL is hardcoded in the main-side handler (gate A-03).
    void window.api.system.openReleases().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('openReleases IPC failed:', err)
    })
  }

  return (
    <footer className={styles.footer}>
      {/* Left: Projects button — folder icon + label */}
      <button
        type="button"
        className={styles.btn}
        aria-label="Projects"
        title="Projects"
        onClick={onOpenProjects}
      >
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
          <path d="M2 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
        </svg>
        <span>Projects</span>
      </button>

      {/* Right: version button — opens GitHub releases page */}
      <button
        type="button"
        className={`${styles.btn} ${styles.versionBtn}`}
        aria-label="View releases on GitHub"
        title="View releases on GitHub"
        onClick={handleOpenReleases}
      >
        {versionLabel}
      </button>
    </footer>
  )
}
