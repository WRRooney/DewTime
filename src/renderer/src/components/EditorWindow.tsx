// Root component mounted in the separate timestamp-editor BrowserWindow.
// main.tsx renders this instead of <App> when the renderer is loaded with a
// `#editor=<timerId>` hash. The native window frame provides move/resize/close.

import { TimestampEditor } from './TimestampEditor'

interface EditorWindowProps {
  timerId: number
}

/** Full-window host for the timestamp editor form. */
export function EditorWindow({ timerId }: EditorWindowProps): JSX.Element {
  return <TimestampEditor timerId={timerId} />
}
