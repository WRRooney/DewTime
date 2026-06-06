-- Seed the composite `settings.window_geometry` row.
-- Nullable x/y are the "center on first launch" sentinel.
--
-- INSERT OR IGNORE (not INSERT OR REPLACE): the geometry writer persists real
-- bounds at runtime; OR IGNORE preserves a user's saved bounds if this
-- migration somehow runs after the live writer already wrote a row.

INSERT OR IGNORE INTO settings (key, value) VALUES ('settings.window_geometry', '{"x":null,"y":null,"width":800,"height":600}');
