-- Initial schema. Mirrors v1 (Python/Peewee) at timerz/db/models.py.
-- All timestamps are Unix epoch SECONDS (INTEGER), not milliseconds.

-- Projects: ordered by creation; project_number is the billing code (nullable);
-- project_name is required.
CREATE TABLE projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_number  TEXT,                       -- billing code; nullable
  project_name    TEXT NOT NULL
);

-- Timers: row-per-day-row-per-task. Optional FK to projects (nullable). On
-- project delete, the FK is SET NULL so timers are not orphaned.
CREATE TABLE timers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  description   TEXT NOT NULL DEFAULT '',     -- free-form
  notes         TEXT NOT NULL DEFAULT '',     -- free-form
  created_at    INTEGER NOT NULL,             -- EpochSeconds
  offset        INTEGER                       -- persistent duration offset (sec); NULL = 0
);
CREATE INDEX idx_timers_project_id ON timers(project_id);
CREATE INDEX idx_timers_created_at ON timers(created_at);

-- TimeEntries: start/stop records. NULL end_timestamp = currently running.
-- ON DELETE CASCADE so deleting a timer wipes its entries (orphaned entries
-- are useless).
CREATE TABLE time_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id        INTEGER NOT NULL REFERENCES timers(id) ON DELETE CASCADE,
  start_timestamp INTEGER NOT NULL,           -- EpochSeconds
  end_timestamp   INTEGER                     -- EpochSeconds, NULL = running
);
CREATE INDEX idx_time_entries_timer_id ON time_entries(timer_id);
CREATE INDEX idx_time_entries_start_timestamp ON time_entries(start_timestamp);
-- Partial index for the single-active-timer invariant check:
CREATE INDEX idx_time_entries_running ON time_entries(timer_id)
  WHERE end_timestamp IS NULL;

-- Heartbeat: single-row table (id=1) updated every 60s by the heartbeat
-- scheduler. timer_entry_id is intentionally NOT a FK to avoid cascade
-- complexity if the underlying entry is deleted.
CREATE TABLE heartbeat (
  id              INTEGER PRIMARY KEY,
  last_beat       INTEGER NOT NULL,           -- EpochSeconds
  timer_entry_id  INTEGER                     -- intentionally NOT a FK (see table comment)
);

-- Settings: key-value store with JSON-encoded value column.
-- Window geometry lives here under the composite key `settings.window_geometry`.
CREATE TABLE settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL                         -- JSON-encoded; consumer parses to type
);

-- Seed default settings rows (all values are JSON-encoded):
INSERT INTO settings (key, value) VALUES
  ('settings.week_start',  '0'),
  ('settings.dark_mode',   'true'),
  ('settings.auto_pause',  'false'),
  ('settings.widget_mode', '"floating"'),
  ('settings.auto_launch', 'false');
