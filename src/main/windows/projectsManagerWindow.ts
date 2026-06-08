// Separate OS window for the projects manager.
//
// Mirrors timestampEditorWindow.ts: the projects manager is its own
// BrowserWindow so the user can resize/move it independently of the main
// widget. It loads the SAME renderer bundle with a `#projects` hash; the
// renderer entry (main.tsx) branches on that hash to mount the projects-manager
// root instead of <App>.
//
// Security posture mirrors the main window: contextIsolation,
// nodeIntegration:false, sandbox, webSecurity, same built preload bundle.
//
// A single projects window is reused — opening again focuses the existing one.

import { BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM __dirname — bundle sits at out/main/, preload at out/preload/index.cjs,
// renderer HTML at out/renderer/index.html.
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let projectsWin: BrowserWindow | null = null

/** Load the renderer in projects-manager mode (dev URL or packaged file). */
function loadProjects(win: BrowserWindow): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#projects`)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'projects',
    })
  }
}

/**
 * Open (or focus) the projects manager window. Creates the window on first
 * call; reuses it thereafter so the user never accumulates a stack of windows.
 */
export function openProjectsManagerWindow(): void {
  if (projectsWin && !projectsWin.isDestroyed()) {
    if (projectsWin.isMinimized()) projectsWin.restore()
    projectsWin.focus()
    return
  }

  projectsWin = new BrowserWindow({
    width: 460,
    height: 560,
    minWidth: 380,
    minHeight: 320,
    frame: true, // native title bar → OS-native move/resize/close
    resizable: true,
    // The main widget is alwaysOnTop, so a normal window would open BEHIND it
    // and be hidden. Keep the projects manager on top too; it's still freely
    // movable/resizable so the user can drag it aside.
    alwaysOnTop: true,
    autoHideMenuBar: true,
    // hex equivalent of --color-bg — paints before the renderer mounts (no white flash)
    backgroundColor: '#181b21',
    title: 'Projects',
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

  const win = projectsWin
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    projectsWin = null
  })

  loadProjects(win)
}
