/// <reference types="vite/client" />

// Renderer-side type declaration for window.api injected by the preload bridge.
import type { ElectronApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Preload-injected IPC surface. Typed against src/shared/ipc.ts. */
    api: ElectronApi
  }
}

/** Ambient declaration for CSS Module imports — without this TS rejects `import styles from '*.module.css'`. */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

export {}
