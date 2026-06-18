-- Seed gantt settings defaults (Phase 9 — D-04, D-16).
-- INSERT OR IGNORE preserves user's preferences if migration re-runs after live writes.
--
-- Values are JSON-encoded: string defaults wrapped in inner quotes so
-- JSON.parse(row.value) returns a string, not undefined.

INSERT OR IGNORE INTO settings (key, value) VALUES ('settings.active_tab', '"timers"');
INSERT OR IGNORE INTO settings (key, value) VALUES ('settings.gutter_width_pct', '0.25');
