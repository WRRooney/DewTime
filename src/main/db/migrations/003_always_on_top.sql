-- Seed the always_on_top setting default.
-- Default is false (windowed) — the user must explicitly opt in to always-on-top.
--
-- INSERT OR IGNORE preserves a user's existing preference if this migration
-- somehow runs after the user has already written the row (safe idempotent seed).

INSERT OR IGNORE INTO settings (key, value) VALUES ('settings.always_on_top', 'false');
