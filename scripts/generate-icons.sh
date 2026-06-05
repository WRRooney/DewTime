#!/usr/bin/env bash
# Regenerate the app icons (build/icon.png + build/icon.ico) from the source
# logo SVG. Run after editing assets/dewtime-logo.svg.
#
# Design: dark logo centered on a white rounded-square tile with transparent
# corners (visible on any taskbar/dock). electron-builder reads build/icon.ico
# (Windows) and build/icon.png (Linux); macOS .icns is generated from the PNG
# at package time.
#
# Rasterization uses headless Chromium (same engine the app renders with) — NOT
# ImageMagick. ImageMagick's built-in SVG renderer mis-handles `transform=
# "rotate(...)"`, which silently dropped the clock tick-marks around the dial.
# ImageMagick is still used for the tile composite + ICO packaging (no SVG
# transforms involved there).
#
# Requires: a Chromium/Chrome binary + ImageMagick (`convert`). Outputs are
# committed to the repo so a build never depends on either tool on CI.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="assets/dewtime-logo.svg"
TILE=512          # master icon size
RASTER=1024       # chromium raster size (square, logo letterboxed + centered)
PAD_FIT=360       # logo bounding box inside the tile (~70%)
RADIUS=96         # rounded-corner radius

[ -f "$SRC" ] || { echo "ERROR: $SRC not found" >&2; exit 1; }
command -v convert >/dev/null 2>&1 || { echo "ERROR: ImageMagick 'convert' not found" >&2; exit 1; }

# Locate a Chromium/Chrome binary (override with CHROMIUM_BIN).
CHROME="${CHROMIUM_BIN:-}"
if [ -z "$CHROME" ]; then
  for c in chromium chromium-browser google-chrome google-chrome-stable chrome; do
    if command -v "$c" >/dev/null 2>&1; then CHROME="$c"; break; fi
  done
fi
[ -n "$CHROME" ] || { echo "ERROR: no Chromium/Chrome binary found (set CHROMIUM_BIN)" >&2; exit 1; }

# Work dir under the repo (not /tmp) so snap-confined Chromium can read/write it.
WORK=".icon-build-tmp"
mkdir -p "$WORK"
trap 'rm -rf "$WORK"' EXIT

# 1. Wrap the SVG in an HTML page (transparent bg, contained + centered) and
#    screenshot it with headless Chromium for a faithful raster.
{
  echo '<!doctype html><html><head><meta charset="utf-8"><style>'
  echo 'html,body{margin:0;padding:0;background:transparent}'
  echo "#wrap{width:${RASTER}px;height:${RASTER}px;display:flex;align-items:center;justify-content:center}"
  echo '#wrap svg{width:92%;height:92%}'
  echo '</style></head><body><div id="wrap">'
  cat "$SRC"
  echo '</div></body></html>'
} > "$WORK/logo.html"

"$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=1 --default-background-color=00000000 \
  --window-size=${RASTER},${RASTER} \
  --screenshot="$PWD/$WORK/logo.png" "$PWD/$WORK/logo.html" >/dev/null 2>&1

[ -s "$WORK/logo.png" ] || { echo "ERROR: Chromium produced no raster" >&2; exit 1; }

# 2. Fit the logo into PAD_FIT and composite it centered on a white
#    rounded-square tile with transparent corners.
convert "$WORK/logo.png" -resize ${PAD_FIT}x${PAD_FIT} \
  -colorspace sRGB -type TrueColorAlpha "$WORK/logo-fit.png"
convert -size ${TILE}x${TILE} xc:none -fill white \
  -draw "roundrectangle 0,0,$((TILE-1)),$((TILE-1)),${RADIUS},${RADIUS}" \
  -colorspace sRGB -type TrueColorAlpha "$WORK/tile.png"
convert "$WORK/tile.png" "$WORK/logo-fit.png" -gravity center -composite \
  -colorspace sRGB -define png:color-type=6 build/icon.png

# 3. Multi-resolution ICO (Windows icon).
convert build/icon.png -background none \
  -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico

echo "Generated build/icon.png and build/icon.ico from $SRC (via $CHROME)"
