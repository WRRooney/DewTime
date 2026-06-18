# 09-07 Summary — Phase 9 Manual UAT Gate

**Plan:** 09-07 (human-verify checkpoint, blocking)
**Status:** complete — operator approved all six success criteria 2026-06-18

## What happened

Task 1 (automated pre-UAT gate) ran green: typecheck clean, full renderer suite + full
main suite passing. Task 2 (human verification) was driven by the operator against a
running dev build over nine review rounds. Round 1 surfaced real defects; rounds 2–9 fixed
them and added requested polish/features. The operator then approved all of SC-1..SC-6.

## Result

- `09-HUMAN-UAT.md`: status `passed`, 7/7 checks PASS (SC-1..SC-6 + manual-only visuals).
- No code was written under this plan itself; it is the verification gate. The fixes and
  enhancements made during UAT are recorded as their own commits (see below) against the
  Phase 9 implementation plans (09-01..09-06).

## Fixes / enhancements landed during UAT

- Integer epochs at every IPC boundary (fixed listInRange ValidationError, bars vanishing
  on zoom, drag snap-back).
- Pointer-capture pan reworked (threshold + interactive-target guards + release) — restored
  double-click create, ghost "new timer", project dropdown.
- Width-aware axis tick density; track-width coordinate model (bars no longer clipped/
  unclickable); info popover relocated.
- Wheel zoom gated to the time axis; lanes scroll natively elsewhere.
- Viewport persisted across tab switches; auto zoom-to-fit on day change + manual fit button.
- Overlap highlight extended to same-timer pairs; in-bar description label removed.
- Lane selection + subtle highlight (bar-selected / gutter-focused / blank-space click);
  hover-revealed per-lane start/stop + delete actions.
- Project dropdown z-index lift; "Gantt" tab relabelled "Timeline".
- useStartTimer gantt invalidation (running bar appears immediately).

## Self-Check: PASSED

Automated gate green; operator UAT approved.
