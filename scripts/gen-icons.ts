// scripts/gen-icons.ts
//
// ONE-TIME icon generation recipe — NOT run in CI.
//
// Run this script manually once to (re-)generate build/icon.png and build/icon.ico
// from scratch. The outputs are committed as static binary assets; electron-builder
// reads them directly at packaging time. Replace build/icon.png with a real brand
// asset and re-run step 2 to regenerate the ICO layers — zero config change needed.
//
// Requirements:
//   - ImageMagick `convert` (available on Ubuntu/Debian: sudo apt-get install imagemagick)
//   - Verified available at /usr/bin/convert (ImageMagick 6.9.12+)
//
// Design specs:
//   - Background: #181b21 (matches BrowserWindow backgroundColor in src/main/index.ts line 176)
//   - Foreground: #4da6ff (accent blue)
//   - Glyph: letter "T", DejaVu-Sans, pointsize 200, centered
//   - PNG: 512x512 (source of truth for AppImage + ICO derivation)
//   - ICO: multi-size (256, 128, 64, 48, 32, 16 px layers) for NSIS installer + .exe
//
// Step 1 — Generate 512x512 PNG:
//
//   convert -size 512x512 xc:'#181b21' \
//     -fill '#4da6ff' -font DejaVu-Sans -pointsize 200 \
//     -gravity Center -annotate 0 'T' \
//     build/icon.png
//
// Step 2 — Derive multi-size ICO from PNG:
//
//   convert build/icon.png \
//     -define icon:auto-resize="256,128,64,48,32,16" \
//     build/icon.ico
//
// Both commands must be run from the project root (where build/ lives).
//
// After running, commit the updated build/icon.png and build/icon.ico:
//
//   git add build/icon.png build/icon.ico
//   git commit -m "chore: regenerate placeholder icon assets"
//
// References:
//   - RESEARCH.md §"Pattern 5: Icon Generation (One-Time)"
//   - PATTERNS.md §"build/icon.png + build/icon.ico"
//   - electron-builder icon docs: https://www.electron.build/icons
