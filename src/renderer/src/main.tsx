// src/renderer/src/main.tsx
// React 18 entry point (D-03). Mounts <App /> into #root.
//
// `./styles/globals.css` is the single global stylesheet load point (UI-SPEC
// § File inventory). Imported FIRST so the dark theme tokens and body
// background resolve before React mounts — pairs with the BrowserWindow
// backgroundColor '#181b21' set in src/main/index.ts to prevent the white
// first-paint flash on window restore (UI-SPEC § Window restore visual moment).
//
// QueryClient singleton (D-12 + RESEARCH § Pattern 2):
//   - refetchOnWindowFocus disabled — single-user local app; no external state
//     changes between focus events.
//   - retry disabled — IPC failures are deterministic (handler throws or returns
//     a typed error); retrying adds latency with no benefit.
//   A single module-level QueryClient avoids React re-mounting the provider tree
//   on hot-reload. <TickBridge /> is mounted inside <App> (plan 04-07) so it
//   lives within the QueryClientProvider scope.
import './styles/globals.css'
// Side-effect import: resolves the persisted theme and sets <html data-theme>
// before React mounts, so the correct palette is live on first paint.
import './stores/useThemeStore'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './components/App'
import { EditorWindow } from './components/EditorWindow'

// Module-level singleton — instantiated once per process lifetime so cache
// state survives HMR reloads without the provider re-mounting (D-12).
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
})

// Route: the separate timestamp-editor window loads this same bundle with a
// `#editor=<timerId>` hash (src/main/windows/timestampEditorWindow.ts). Branch
// on it to mount the editor root instead of the main app.
const editorMatch = window.location.hash.match(/^#editor=(\d+)/)
const editorTimerId = editorMatch ? Number(editorMatch[1]) : null

if (editorTimerId !== null) {
  // Editor window: after any mutation succeeds, tell main to broadcast so the
  // main window's timer table refetches (each window is its own renderer
  // process with its own TanStack cache).
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.mutation?.state.status === 'success') {
      window.api.editor.notifyChanged()
    }
  })
} else {
  // Main window: refetch timers + entry lists when an editor window reports a change.
  window.api.editor.onDataChanged(() => {
    void queryClient.invalidateQueries({ queryKey: ['timers'] })
    void queryClient.invalidateQueries({ queryKey: ['timeEntries', 'byTimer'] })
  })
}

const container = document.getElementById('root')!
createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    {editorTimerId !== null ? <EditorWindow timerId={editorTimerId} /> : <App />}
  </QueryClientProvider>,
)
