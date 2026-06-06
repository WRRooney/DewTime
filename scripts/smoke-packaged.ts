// scripts/smoke-packaged.ts
//
// Plan 01-05 / PKG-04 — packaged-binary smoke test.
//
// Invoked by `npm run smoke:packaged` (which first runs `electron-rebuild -f -w
// better-sqlite3` to restore the Electron-Node ABI per RESEARCH.md §9 Option C).
//
// Pipeline:
//   1. `electron-vite build` — bundle main + preload + renderer.
//   2. `electron-builder --linux AppImage | --win nsis --publish=never` — package.
//   3. Locate the resulting binary in `dist/`.
//   4. Spawn the binary with `TIMERZ_SMOKE=1` set. On Linux CI, prefix with `xvfb-run`.
//   5. Assert exit code 0 AND stdout contains `SMOKE_OK`.
//
// Failure modes detected with hints:
//   - `Could not locate the bindings file` / `Cannot find module .../better_sqlite3.node`
//     → asarUnpack glob in electron-builder.yml is likely wrong.
//   - `NODE_MODULE_VERSION` mismatch
//     → better-sqlite3 ABI mismatch; postinstall electron-rebuild did not run
//       (or `--ignore-scripts` was passed at install time).
//
// Refs:
//   - CONTEXT.md D-19 (smoke runs electron-builder then headless binary)
//   - RESEARCH.md §7 lines ~1113-1139 (CLI invocation pattern)
//   - RESEARCH.md §8 lines ~1156-1226 (TIMERZ_SMOKE branch, headless Linux,
//     asar-cannot-load detection)
//   - RESEARCH.md §6 lines ~1029-1057 (NODE_MODULE_VERSION detection)

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const platform = process.platform

if (platform !== 'linux' && platform !== 'win32') {
  console.error(`[smoke] unsupported platform: ${platform}`)
  console.error('[smoke] this script targets linux + win32 only (Phase 1 packaging targets)')
  process.exit(1)
}

// --- Step 1: electron-vite build ---
console.log('[smoke] electron-vite build...')
try {
  execSync('npx electron-vite build', { stdio: 'inherit' })
} catch (e) {
  console.error('[smoke] FAIL: electron-vite build failed')
  process.exit(1)
}

// --- Step 2: electron-builder package ---
const target = platform === 'win32' ? '--win nsis' : '--linux AppImage'
console.log(`[smoke] electron-builder ${target} --publish=never`)
try {
  execSync(`npx electron-builder ${target} --publish=never`, { stdio: 'inherit' })
} catch (e) {
  console.error(`[smoke] FAIL: electron-builder ${target} failed`)
  process.exit(1)
}

// --- Step 3: locate the binary ---
function findBinary(): string {
  const distDir = join(process.cwd(), 'dist')
  if (!existsSync(distDir)) {
    console.error(`[smoke] FAIL: dist/ directory not found at ${distDir}`)
    process.exit(1)
  }

  if (platform === 'linux') {
    // Run the UNPACKED binary, not the .AppImage. The AppImage is still built
    // above (so CI catches packaging breaks), but running it needs FUSE, which
    // ubuntu-latest no longer ships — and extract-and-run is flaky. The unpacked
    // binary in dist/linux-unpacked/ has the identical asar layout (same
    // better-sqlite3 load path) and runs without any of that.
    const unpackedDir = join(distDir, 'linux-unpacked')
    const exclude = new Set(['chrome-sandbox', 'chrome_crashpad_handler'])
    if (existsSync(unpackedDir)) {
      const cand = readdirSync(unpackedDir).find((f) => {
        if (exclude.has(f) || /\.(so|so\.\d+|pak|bin|dat|json|node)$/i.test(f)) return false
        const p = join(unpackedDir, f)
        try {
          const st = statSync(p)
          return st.isFile() && (st.mode & 0o111) !== 0 // any execute bit
        } catch {
          return false
        }
      })
      if (cand) return join(unpackedDir, cand)
    }
    // Fallback: the .AppImage (older runners with FUSE).
    const entries = readdirSync(distDir)
    const appimage = entries.find((f) => /\.AppImage$/i.test(f))
    if (!appimage) {
      console.error(`[smoke] FAIL: no linux-unpacked binary or .AppImage in ${distDir}`)
      console.error(`[smoke] dist contents: ${entries.join(', ')}`)
      process.exit(1)
    }
    const abs = join(distDir, appimage)
    try {
      chmodSync(abs, 0o755)
    } catch {
      // Non-fatal: if chmod fails, the spawn below will surface a clearer error.
    }
    return abs
  }

  // platform === 'win32'
  // Prefer the unpacked .exe — much faster than running the NSIS installer in CI,
  // and exercises the same asar layout the installed copy would produce.
  // productName in electron-builder.yml is 'DewTime'.
  const unpackedExe = join(distDir, 'win-unpacked', 'DewTime.exe')
  if (existsSync(unpackedExe) && statSync(unpackedExe).isFile()) {
    return unpackedExe
  }

  // Fallback: any *.exe directly in dist/ (the NSIS installer). This still works
  // if the installer is a portable kind, but typically NSIS installers won't run
  // headless. Surface as a warning and try anyway.
  const entries = readdirSync(distDir)
  const exe = entries.find((f) => /\.exe$/i.test(f))
  if (exe) {
    console.warn(`[smoke] WARN: win-unpacked/DewTime.exe missing; falling back to dist/${exe}`)
    return join(distDir, exe)
  }
  console.error(`[smoke] FAIL: no .exe found in ${distDir} (looked for win-unpacked/DewTime.exe and *.exe)`)
  console.error(`[smoke] dist contents: ${entries.join(', ')}`)
  process.exit(1)
}

const binary = findBinary()
console.log(`[smoke] binary: ${binary}`)

// --- Step 4: launch with TIMERZ_SMOKE=1 ---
// On Linux in CI, Electron needs $DISPLAY to initialize Chromium. Even though
// the TIMERZ_SMOKE branch creates no BrowserWindow, the Electron runtime still
// connects to X. xvfb-run --auto-servernum provides a virtual framebuffer.
// (RESEARCH.md §8 lines ~1198-1207.)
const useXvfb = platform === 'linux' && process.env['CI'] === 'true'
// On Linux the Chromium zygote aborts on CI because the SUID chrome-sandbox is
// not root-owned. Pass --no-sandbox as an argv (env→appendSwitch isn't enough
// to disable the SUID sandbox). webPreferences keep contextIsolation/sandbox.
const appArgs = platform === 'linux' ? ['--no-sandbox'] : []
const cmd = useXvfb ? 'xvfb-run' : binary
const cmdArgs = useXvfb ? ['--auto-servernum', binary, ...appArgs] : appArgs

console.log(`[smoke] spawn: ${cmd} ${cmdArgs.join(' ')} (TIMERZ_SMOKE=1, timeout=30s)`)
const result = spawnSync(cmd, cmdArgs, {
  env: { ...process.env, TIMERZ_SMOKE: '1' },
  encoding: 'utf8',
  timeout: 30_000,
})

// --- Step 5: assert ---
const stdout = result.stdout ?? ''
const stderr = result.stderr ?? ''

if (result.error) {
  console.error('[smoke] FAIL: spawn error:', result.error.message)
  if (stdout) console.error('[smoke] stdout:', stdout)
  if (stderr) console.error('[smoke] stderr:', stderr)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`[smoke] FAIL: exit code ${result.status} (expected 0)`)
  if (stdout) console.error('[smoke] stdout:', stdout)
  if (stderr) console.error('[smoke] stderr:', stderr)

  // Targeted hints for the two known failure modes.
  const combined = `${stdout}\n${stderr}`
  if (
    /Could not locate the bindings file/.test(combined) ||
    /Cannot find module/.test(combined) && /better[_-]sqlite3/.test(combined)
  ) {
    console.error(
      '[smoke] HINT: asarUnpack glob in electron-builder.yml is likely wrong; ' +
        'check dist/<linux-unpacked|win-unpacked>/resources/app.asar.unpacked/ ' +
        'contains better-sqlite3/',
    )
  }
  if (/NODE_MODULE_VERSION/.test(combined)) {
    console.error(
      '[smoke] HINT: better-sqlite3 ABI mismatch; postinstall electron-rebuild did not run, ' +
        'or --ignore-scripts was passed. The smoke:packaged npm script should have run ' +
        'electron-rebuild first.',
    )
  }
  process.exit(1)
}

if (!stdout.includes('SMOKE_OK')) {
  console.error('[smoke] FAIL: SMOKE_OK marker not found in stdout')
  if (stdout) console.error('[smoke] stdout:', stdout)
  if (stderr) console.error('[smoke] stderr:', stderr)
  process.exit(1)
}

console.log('[smoke] PASS:', stdout.trim())
process.exit(0)
