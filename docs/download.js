/* DewTime download page — dynamic release wiring.
 *
 * Fetches the most recent GitHub release (prereleases/betas included) and fills
 * the per-platform download cards from its assets. No build step; pure
 * client-side. Drafts are invisible to unauthenticated requests, so a release
 * only appears here once it is actually published.
 */
;(() => {
  const OWNER = 'WRRooney'
  const REPO = 'DewTime'
  const API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=10`
  const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases`

  // ── decorative dial: 60 tick marks, every 5th emphasized ────────────────
  buildTicks()
  const yearEl = document.getElementById('year')
  if (yearEl) yearEl.textContent = String(new Date().getFullYear())

  // Asset classifiers — match electron-builder's artifact names.
  // Windows installer is the NSIS "… Setup ….exe"; portable carries "portable".
  const MATCHERS = {
    'win-installer': (n) => /\.exe$/i.test(n) && /setup/i.test(n),
    'win-portable': (n) => /\.exe$/i.test(n) && /portable/i.test(n),
    linux: (n) => /\.AppImage$/i.test(n),
  }

  const osGuess = detectOS()

  fetchLatest()

  // ─────────────────────────────────────────────────────────────────────────
  async function fetchLatest() {
    try {
      const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(`GitHub API ${res.status}`)
      const releases = await res.json()
      // Newest first; include prereleases. Skip drafts (absent when unauthed).
      const release = Array.isArray(releases)
        ? releases.find((r) => !r.draft)
        : null
      if (!release) return showEmpty()
      render(release)
    } catch (err) {
      showError()
      // eslint-disable-next-line no-console
      console.warn('DewTime: release fetch failed —', err)
    }
  }

  function render(release) {
    const assets = release.assets || []
    const picked = {}
    for (const key of Object.keys(MATCHERS)) {
      picked[key] = assets.find((a) => MATCHERS[key](a.name)) || null
    }

    // Version tag + date in the hero.
    const ver = release.tag_name || release.name || ''
    const verEl = document.getElementById('rel-version')
    if (verEl) verEl.textContent = ver
    const dateEl = document.getElementById('rel-date')
    if (dateEl && release.published_at) {
      dateEl.textContent = `released ${formatDate(release.published_at)}`
    }

    // Fill each card.
    let anyAsset = false
    document.querySelectorAll('.card[data-asset]').forEach((card) => {
      const key = card.getAttribute('data-asset')
      const asset = picked[key]
      const link = card.querySelector('[data-dl-link]')
      const meta = card.querySelector('[data-dl-meta]')
      if (asset) {
        anyAsset = true
        link.href = asset.browser_download_url
        link.setAttribute('aria-disabled', 'false')
        link.removeAttribute('aria-disabled')
        link.setAttribute('download', '')
        meta.textContent = `${asset.name} · ${formatSize(asset.size)}`
      } else {
        link.setAttribute('aria-disabled', 'true')
        link.href = RELEASES_URL
        meta.textContent = 'not in this release'
      }
    })

    if (!anyAsset) return showEmpty(ver)

    highlightOS(picked)
    wirePrimary(picked, ver)
  }

  // OS-detected hero button.
  function wirePrimary(picked, ver) {
    const cta = document.getElementById('primary-cta')
    const link = document.getElementById('primary-link')
    const osEl = document.getElementById('primary-os')
    const subEl = document.getElementById('primary-sub')
    if (!cta || !link) return

    let asset = null
    let label = ''
    if (osGuess === 'windows' && picked['win-installer']) {
      asset = picked['win-installer']
      label = 'Download for Windows'
    } else if (osGuess === 'linux' && picked['linux']) {
      asset = picked['linux']
      label = 'Download for Linux'
    }

    cta.setAttribute('data-state', 'ready')
    if (asset) {
      link.href = asset.browser_download_url
      link.setAttribute('download', '')
      osEl.textContent = label
      subEl.textContent = `${ver} · ${formatSize(asset.size)}`
    } else {
      // Unknown/unsupported OS (e.g. macOS) — point at the downloads grid.
      link.href = '#downloads'
      osEl.textContent = 'Choose your download'
      subEl.textContent = `${ver} · Windows & Linux`
    }
  }

  function highlightOS(picked) {
    const map = { windows: ['win-installer'], linux: ['linux'] }
    const keys = map[osGuess]
    if (!keys) return
    keys.forEach((key) => {
      if (!picked[key]) return
      const card = document.querySelector(`.card[data-asset="${key}"]`)
      if (card) card.classList.add('is-recommended')
    })
  }

  // ── empty / error states ────────────────────────────────────────────────
  function showEmpty(ver) {
    setBanner(
      `🌅 Builds for ${
        ver ? `<strong>${escapeHtml(ver)}</strong>` : 'the first release'
      } are on the way. Watch the <a href="${RELEASES_URL}" target="_blank" rel="noopener">Releases page</a> or the repo for updates.`,
    )
    disableCards('coming soon')
    primaryFallback('No builds yet', 'watch the repo')
  }

  function showError() {
    setBanner(
      `Couldn't reach GitHub just now. Grab the latest build directly from the <a href="${RELEASES_URL}" target="_blank" rel="noopener">Releases page</a>.`,
    )
    disableCards('see releases →', RELEASES_URL)
    primaryFallback('View releases', 'on GitHub', RELEASES_URL)
  }

  function disableCards(metaText, href) {
    document.querySelectorAll('.card[data-asset]').forEach((card) => {
      const link = card.querySelector('[data-dl-link]')
      const meta = card.querySelector('[data-dl-meta]')
      if (href) {
        link.href = href
        link.removeAttribute('aria-disabled')
      } else {
        link.setAttribute('aria-disabled', 'true')
      }
      meta.textContent = metaText
    })
  }

  function primaryFallback(os, sub, href) {
    const cta = document.getElementById('primary-cta')
    const link = document.getElementById('primary-link')
    const osEl = document.getElementById('primary-os')
    const subEl = document.getElementById('primary-sub')
    if (!cta) return
    cta.setAttribute('data-state', 'ready')
    link.href = href || '#downloads'
    if (href) link.target = '_blank'
    osEl.textContent = os
    subEl.textContent = sub
  }

  function setBanner(html) {
    const b = document.getElementById('dl-banner')
    if (!b) return
    b.innerHTML = html
    b.hidden = false
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  function detectOS() {
    const ua = navigator.userAgent || ''
    if (/Windows/i.test(ua)) return 'windows'
    if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux'
    if (/Mac/i.test(ua)) return 'mac'
    return 'other'
  }

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return ''
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return ''
    }
  }

  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    )
  }

  function buildTicks() {
    const g = document.getElementById('ticks')
    if (!g) return
    const cx = 100
    const cy = 100
    const rOuter = 96
    const NS = 'http://www.w3.org/2000/svg'
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0
      const len = major ? 12 : 6
      const w = major ? 2.4 : 1.4
      const angle = (i / 60) * Math.PI * 2
      const x1 = cx + Math.sin(angle) * rOuter
      const y1 = cy - Math.cos(angle) * rOuter
      const x2 = cx + Math.sin(angle) * (rOuter - len)
      const y2 = cy - Math.cos(angle) * (rOuter - len)
      const rect = document.createElementNS(NS, 'rect')
      rect.setAttribute('x', String(Math.min(x1, x2) - w / 2))
      rect.setAttribute('y', String(Math.min(y1, y2)))
      rect.setAttribute('width', String(w))
      rect.setAttribute('height', String(len))
      rect.setAttribute('rx', String(w / 2))
      rect.setAttribute(
        'transform',
        `rotate(${(i / 60) * 360} ${(x1 + x2) / 2} ${(y1 + y2) / 2})`,
      )
      rect.setAttribute('x', String((x1 + x2) / 2 - w / 2))
      rect.setAttribute('y', String((y1 + y2) / 2 - len / 2))
      if (major) rect.setAttribute('class', 'major')
      g.appendChild(rect)
    }
  }
})()
