-- Seed the auto_update setting default.
-- Default is TRUE — preserves current always-on update behavior so existing users
-- are not silently opted out on upgrade. Users must explicitly disable in Settings.
--
-- INSERT OR IGNORE preserves a user's existing preference if this migration
-- somehow runs after the user has already written the row (safe idempotent seed).

INSERT OR IGNORE INTO settings (key, value) VALUES ('settings.auto_update', 'true');
