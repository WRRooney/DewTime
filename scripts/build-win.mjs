// Windows packaging orchestrator.
//
// Why this exists: `build:win` runs electron-builder inside the
// electronuserland/builder:wine Docker container. That image runs Windows
// executables under Wine but has no node-gyp Windows cross-compile toolchain,
// so electron-builder cannot rebuild better-sqlite3 for win32 — it silently
// falls back to the Linux .node already in node_modules. The packaged app then
// ships a Linux ELF addon that Windows cannot load, and the main process
// crashes the instant it `require('better-sqlite3')`. (See
// .planning/debug/windows-app-silent-crash.md.)
//
// Fix: before packaging, swap in the genuine win32/x64 Electron-ABI prebuilt
// binary that WiseLibs publishes on GitHub releases, then restore the host
// (Linux) binary afterward so local dev/test keeps working. Deterministic
// packaging is enforced by `npmRebuild: false` in electron-builder.yml — that
// makes electron-builder pack exactly what is in node_modules rather than
// attempting (and silently failing) its own rebuild.

import { spawnSync } from 'node:child_process'
import { existsSync, copyFileSync, rmSync, openSync, readSync, closeSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()
const bs3 = `${root}/node_modules/better-sqlite3`
const nodeFile = `${bs3}/build/Release/better_sqlite3.node`
const backup = `${nodeFile}.hostbak`

const electronVersion = require('electron/package.json').version
const prebuildInstall = `${root}/node_modules/.bin/prebuild-install`
const electronBuilder = `${root}/node_modules/.bin/electron-builder`

// Run a command, inheriting stdio. Throws on non-zero so the finally block runs
// (process.exit would skip it and leave the host binary swapped out).
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`)
}

// Classify a binary by its magic bytes (the `file` CLI is not present in the
// Wine build container, so we read the header ourselves). Windows PE images
// start with "MZ"; Linux ELF objects start with 0x7F "ELF".
function magic(file) {
  const fd = openSync(file, 'r')
  try {
    const buf = Buffer.alloc(4)
    readSync(fd, buf, 0, 4, 0)
    if (buf[0] === 0x4d && buf[1] === 0x5a) return 'PE'
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'ELF'
    return `unknown (${buf.toString('hex')})`
  } finally {
    closeSync(fd)
  }
}

// Back up the host-built (Linux) binary so we can restore it afterward.
if (existsSync(nodeFile)) copyFileSync(nodeFile, backup)

let exitCode = 0
try {
  console.log(`[build-win] fetching win32-x64 better-sqlite3 for electron ${electronVersion}`)
  run(prebuildInstall, [
    '--platform', 'win32',
    '--arch', 'x64',
    '--runtime', 'electron',
    '--target', electronVersion,
  ], { cwd: bs3 })

  const kind = magic(nodeFile)
  if (kind !== 'PE') {
    throw new Error(`expected a Windows PE binary after prebuild fetch, got: ${kind}`)
  }
  console.log('[build-win] win32 PE binary in place, packaging...')

  run(electronBuilder, ['--win', '--publish=never'])
} catch (err) {
  console.error(`[build-win] ${err.message}`)
  exitCode = 1
} finally {
  // Restore the host (Linux) binary so local dev/test is unaffected.
  if (existsSync(backup)) {
    copyFileSync(backup, nodeFile)
    rmSync(backup)
    console.log('[build-win] restored host better-sqlite3 binary')
  }
}

process.exit(exitCode)
