// src/main/db/migrations/raw.d.ts
// Ambient declaration so TypeScript recognises Vite's `?raw` asset suffix
// on .sql imports inside the main process bundle. The renderer's
// `vite/client` types declare this globally, but the main bundle uses the
// `tsconfig.node.json` config which does NOT pull in `vite/client` (it's a
// DOM-flavoured types pack). This file gives `tsc -p tsconfig.node.json` the
// same string-typed return shape Vite produces at build time.
//
// Refs:
//   - RESEARCH.md §3 lines ~597-609 (?raw imports work identically in dev + packaged)
//   - vitejs.dev/guide/assets.html#importing-asset-as-string

declare module '*.sql?raw' {
  const content: string
  export default content
}
