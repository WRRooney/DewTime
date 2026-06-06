// Ambient declaration so TypeScript recognises Vite's `?raw` asset suffix
// on .sql imports inside the main process bundle. The renderer's `vite/client`
// types declare this globally, but `tsconfig.node.json` does NOT pull in
// `vite/client` (it's a DOM-flavoured types pack). This gives `tsc` the same
// string-typed return shape Vite produces at build time.

declare module '*.sql?raw' {
  const content: string
  export default content
}
