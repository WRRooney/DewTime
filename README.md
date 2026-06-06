<div align="center">

<img src="build/icon.png" alt="DewTime" width="96" height="96" />

# DewTime

A lightweight, always-on-top desktop **time-tracking widget** for Windows and Linux.
Local-first: all data lives in a local SQLite database — no account, no cloud.

### [⬇ Download DewTime →](https://dewtime.dewnet.app)

</div>

## Features

- **Timers** — project number, project name, description, and notes per timer, with
  start/stop tracking. Only one timer runs at a time; starting one auto-stops the rest.
- **Timestamp management** — each timer holds zero or more start/end pairs; edit any
  start/end date and time after the fact.
- **Duration offset** — nudge a timer's total by a signed value + unit (e.g. `-1 hours`).
- **In-place editing** — every field is editable inline; project number/name are
  autocomplete dropdowns sourced from values used across all timers.
- **Date navigation** — day-range control with prev/next, jump-to-today, an inline
  calendar, and running totals for the day and the week.
- **Copy to clipboard** — one click to copy a timer's project #, name, description, or
  total time.
- **Settings** — week start/end day, launch on system startup, and light/dark theme
  (defaults to dark).

## Tech stack

Electron · TypeScript · React · Vite ([electron-vite]) · better-sqlite3 · Vitest · Playwright

## Getting started

Requires Node.js 22+.

```bash
npm install      # postinstall rebuilds better-sqlite3 against Electron's ABI
npm run dev      # launch the app in development
```

> On some Linux setups the sandbox needs disabling in dev: `npm run dev:no-sandbox`.

## Building

Releases are built and published by CI — push a `vX.Y.Z` tag (matching
`package.json` version) and the [release workflow](.github/workflows/release.yml)
builds each platform on its own native runner and uploads a draft GitHub Release
(Linux AppImage + Windows portable/NSIS, with auto-update metadata).

```bash
git tag v1.0.0 && git push origin v1.0.0
```

To build locally (artifacts written to `dist/`):

```bash
npm run build:linux       # Linux AppImage
npm run build:win:native  # Windows portable .exe + NSIS installer (run on Windows)
```

## Testing

```bash
npm run typecheck      # tsc, main + renderer
npm run test:run       # main + renderer unit tests (Vitest)
npm run test:e2e       # end-to-end (Playwright)
npm run smoke:packaged # spawn the packaged binary and verify it boots
```

## License

[MIT](LICENSE) © 2026 Will Rooney

[electron-vite]: https://electron-vite.org
