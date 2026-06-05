// src/renderer/src/components/EditorWindow.tsx
// Root component mounted in the SEPARATE timestamp-editor BrowserWindow
// (Phase 5 UAT follow-up). main.tsx renders this instead of <App> when the
// renderer is loaded with a `#editor=<timerId>` hash. The native window frame
// provides move/resize/close; this just hosts the editor form.

import { TimestampEditor } from './TimestampEditor'

interface EditorWindowProps {
  timerId: number
}

/** Full-window host for the timestamp editor form. */
export function EditorWindow({ timerId }: EditorWindowProps): JSX.Element {
  return <TimestampEditor timerId={timerId} />
}
