// Separate OS window for the timestamp/offset/notes editor.
//
// The editor is its own BrowserWindow so the user can resize it, move it
// aside, or push it behind the main widget. It loads the SAME renderer bundle
// with a `#editor=<timerId>` hash; the renderer entry (main.tsx) branches on
// that hash to mount the editor root instead of <App>.
//
// Security posture mirrors the main window: contextIsolation,
// nodeIntegration:false, sandbox, webSecurity, same built preload bundle.
//
// A single editor window is reused across timers — opening a different timer
// reloads the existing window and focuses it.

import { BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM __dirname — bundle sits at out/main/, preload at out/preload/index.cjs,
// renderer HTML at out/renderer/index.html.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let editorWin: BrowserWindow | null = null

/** Load the renderer in editor mode for a specific timer (dev URL or packaged file). */
function loadEditor(win: BrowserWindow, timerId: number): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#editor=${timerId}`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: `editor=${timerId}`,
    })
  }
}

/**
 * Open (or focus + retarget) the timestamp editor window for `timerId`.
 * Creates the window on first call; reuses it thereafter so the user never
 * accumulates a stack of editor windows.
 */
export function openTimestampEditorWindow(timerId: number): void {
  if (editorWin && !editorWin.isDestroyed()) {
    loadEditor(editorWin, timerId)
    if (editorWin.isMinimized()) editorWin.restore()
    editorWin.focus()
    return
  }

  editorWin = new BrowserWindow({
    // Wider, shorter popup so each entry's Start/End sit side by side.
    width: 520,
    height: 440,
    minWidth: 420,
    minHeight: 300,
    frame: true, // native title bar → OS-native move/resize/close
    resizable: true,
    // alwaysOnTop: the main widget is alwaysOnTop, so a normal window would open
    // BEHIND it and be hidden. Keep the editor on top too; it's still freely
    // movable/resizable so the user can drag it aside.
    alwaysOnTop: true,
    autoHideMenuBar: true,
    // hex equivalent of --color-bg — paints before the renderer mounts (no white flash)
    backgroundColor: '#181b21',
    title: 'Edit timer',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, '../preload/index.cjs'),
    },
  })

  const win = editorWin
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    editorWin = null
  })

  loadEditor(win, timerId)
}

/**
 * Broadcast a "data changed" event to every renderer window. Called when the
 * editor window persists an edit so the main window refetches its timer table
 * (each window has its own renderer process → its own TanStack cache).
 */
export function broadcastDataChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('timerz:data-changed')
    }
  }
}
