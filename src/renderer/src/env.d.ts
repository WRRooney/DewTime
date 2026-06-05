/// <reference types="vite/client" />

// Global augmentation: the preload bridge (src/preload/index.ts) exposes
// `window.api` via contextBridge.exposeInMainWorld('api', api). This file
// is the renderer-side type declaration that tells TypeScript the shape
// of that runtime-injected global.
//
// Refs:
//   - 01-04-PLAN.md Task 2 <action>
//   - CONTEXT.md D-12 (namespaced window.api typed surface)
//   - src/shared/ipc.ts (ElectronApi interface — single source of truth)
import type { ElectronApi } from '@shared/ipc'

declare global {
  interface Window {
    /**
     * Preload-injected IPC surface. Typed against the full v1 contract
     * (src/shared/ipc.ts); Phase 1 only WIRES `system.*` — calling any
     * other namespace method rejects with a "not implemented in Phase 1"
     * Error (see src/preload/index.ts notImpl placeholders).
     */
    api: ElectronApi
  }
}

/**
 * Ambient declaration for CSS Module imports (`*.module.css`). Plan 03-05
 * introduces co-located CSS Modules for the renderer chrome (TitleBar,
 * SettingsDialog, App). Without this declaration TypeScript would reject
 * `import styles from './Foo.module.css'` as "cannot find module".
 *
 * Refs:
 *   - 03-CONTEXT.md D-22 (vanilla CSS Modules)
 *   - 03-RESEARCH.md § Code Examples
 */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>
  export default classes
}

export {}
