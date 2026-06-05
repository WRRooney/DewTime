// electron.vite.config.ts
// Source: RESEARCH.md §1 (electron-vite v5 Scaffold Mechanics)
// electron-vite.org/config/ + electron-vite.org/guide/dependency-handling
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      // electron-vite@5's MainBuildOptions extends vite's BuildEnvironmentOptions,
      // which only exists in vite@6+. On vite@5 that import resolves to `any` and
      // `rollupOptions` is dropped from the type, so this valid (runtime-honored)
      // option trips an excess-property check. Remove this directive once vite is
      // on ^6 — @ts-expect-error will then fail, flagging it for cleanup.
      // @ts-expect-error see comment above (electron-vite@5 / vite@5 type drift)
      rollupOptions: {
        // CRITICAL: better-sqlite3 is a native .node addon; must NOT be bundled.
        // externalizeDepsPlugin() above auto-externalizes dependencies (NOT
        // devDependencies), so `better-sqlite3` must be in `dependencies` in
        // package.json. This is a defensive double-tag per RESEARCH.md §1.
        external: ['better-sqlite3'],
        // Setting custom rollupOptions clobbers electron-vite's default ESM
        // filename config. With package.json "type":"module" + "main":
        // "out/main/index.mjs", we must force .mjs explicitly here. Without
        // this, the main bundle ships as out/main/index.js and electron-vite
        // dev fails with "No electron app entry file found".
        output: {
          format: 'es',
          entryFileNames: '[name].mjs',
          chunkFileNames: '[name]-[hash].mjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@preload': resolve('src/preload'),
        '@shared': resolve('src/shared'),
      },
    },
    build: {
      // See main.build above — same electron-vite@5 / vite@5 type drift.
      // @ts-expect-error remove once vite is on ^6 (BuildEnvironmentOptions)
      rollupOptions: {
        // Sandboxed preload scripts can ONLY use CommonJS — Electron docs:
        // https://www.electronjs.org/docs/latest/tutorial/sandbox#preload
        // ESM preload silently fails to load under sandbox: true so
        // contextBridge.exposeInMainWorld never fires and window.api is
        // undefined in the renderer. Emit .cjs to satisfy the sandbox loader.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name]-[hash].cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src'),
      },
    },
  },
})
