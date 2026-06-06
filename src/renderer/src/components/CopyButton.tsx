// Small ghost copy-to-clipboard button used in timer-table cells (project #,
// description, decimal-hours duration). Echoes the Ignition v0 per-field copy
// icons.
//
// Copy routes through window.api.system.copyToClipboard (Electron main-process
// clipboard) — NOT navigator.clipboard, which is unavailable in the packaged
// file:// context. Click handler stops propagation so the surrounding cell's
// click (enter-edit / open-editor) does not also fire.
//
// Reveal-on-row-hover is driven by the [data-copy-btn] attribute selector in
// TimerTable.module.css (attribute selectors survive CSS-module hashing).

import React, { useRef, useState } from 'react'
import styles from './CopyButton.module.css'

interface CopyButtonProps {
  /** Text written to the clipboard on click. */
  value: string
  /** Accessible label / tooltip, e.g. "Copy project number". */
  label: string
}

/** Ghost icon button that copies `value` to the OS clipboard via main-process IPC. */
export function CopyButton({ value, label }: CopyButtonProps): JSX.Element {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = (e: React.MouseEvent): void => {
    // Don't let the cell's own click handler (edit / open editor) fire too.
    e.stopPropagation()
    void window.api.system.copyToClipboard(value)
    setCopied(true)
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setCopied(false), 1000)
  }

  return (
    <button
      type="button"
      data-copy-btn=""
      data-testid="copy-btn"
      className={`${styles.copyBtn}${copied ? ` ${styles.copied}` : ''}`}
      aria-label={label}
      title={label}
      onClick={handleClick}
      // Stop mousedown too: cells that close/commit on outside-mousedown (e.g.
      // ProjectCell click-outside) must not treat a copy click as "outside".
      onMouseDown={(e) => e.stopPropagation()}
    >
      {copied ? (
        /* ✓ check — confirms the copy landed */
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M3 8.5l3.5 3.5L13 4.5" />
        </svg>
      ) : (
        /* ⧉ two overlapping rectangles — classic copy glyph */
        <svg
          width="13"
          height="13"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="6" y="6" width="7.5" height="7.5" rx="1.3" />
          <path d="M3.5 10.2V3.3C3.5 2.6 4 2 4.8 2H10" />
        </svg>
      )}
    </button>
  )
}
