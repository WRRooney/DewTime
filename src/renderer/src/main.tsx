// globals.css is imported FIRST so dark theme tokens and body background resolve
// before React mounts — pairs with BrowserWindow backgroundColor '#181b21' in
// src/main/index.ts to prevent the white first-paint flash on window restore.
import './styles/globals.css'
// Side-effect import: resolves the persisted theme and sets <html data-theme>
// before React mounts, so the correct palette is live on first paint.
import './stores/useThemeStore'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './components/App'
import { EditorWindow } from './components/EditorWindow'

// Module-level singleton so cache state survives HMR reloads without the
// provider re-mounting. refetchOnWindowFocus disabled — single-user local app,
// no external state changes between focus events. retry disabled — IPC
// failures are deterministic; retrying adds latency with no benefit.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
})

// The separate timestamp-editor window loads this same bundle with a
// `#editor=<timerId>` hash. Branch on it to mount the editor root instead of the main app.
const editorMatch = window.location.hash.match(/^#editor=(\d+)/)
const editorTimerId = editorMatch ? Number(editorMatch[1]) : null

// Cross-window sync (each window is its own renderer with its own TanStack
// cache). Both directions are symmetric so a change in either window reaches the
// other: after any successful local mutation, notify main to broadcast; on a
// broadcast, refetch timers + entry lists. This keeps the editor's entry list
// live when the main window starts/stops a timer (and vice-versa). Refetching
// is not a mutation, so the broadcast cannot loop.
queryClient.getMutationCache().subscribe((event) => {
  if (event.type === 'updated' && event.mutation?.state.status === 'success') {
    window.api.editor.notifyChanged()
  }
})
window.api.editor.onDataChanged(() => {
  void queryClient.invalidateQueries({ queryKey: ['timers'] })
  void queryClient.invalidateQueries({ queryKey: ['timeEntries', 'byTimer'] })
})

const container = document.getElementById('root')!
createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    {editorTimerId !== null ? <EditorWindow timerId={editorTimerId} /> : <App />}
  </QueryClientProvider>,
)
