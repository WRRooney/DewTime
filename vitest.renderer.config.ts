// vitest.renderer.config.ts
// Renderer-process vitest config — mirrors vitest.main.config.ts exactly with
// these substitutions: jsdom environment, renderer test include pattern, React
// plugin, and renderer-specific path aliases.
//
// Refs:
//   - 04-PATTERNS.md § vitest.renderer.config.ts
//   - 04-RESEARCH.md § Example E (lines 1277-1298)
//   - vitest.main.config.ts (the analog this mirrors)
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/renderer/**/*.test.{ts,tsx}'],
    exclude: ['src/main/**', 'src/shared/**', 'node_modules/**'],
    setupFiles: ['./vitest.setup.renderer.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
      '@': resolve('src/renderer/src'),
    },
  },
})
