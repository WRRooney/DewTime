import styles from './AppFooter.module.css'
import { useAppVersion } from '../hooks/useAppVersion'

export function AppFooter(): JSX.Element {
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
      {/* Right: version button — opens GitHub releases page (D-31) */}
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
