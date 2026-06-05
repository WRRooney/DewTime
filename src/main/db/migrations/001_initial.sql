-- src/main/db/migrations/001_initial.sql
-- Phase 1 initial schema. Mirrors v1 (Python/Peewee) at timerz/db/models.py.
-- All timestamps are Unix epoch SECONDS (INTEGER), not milliseconds (DATA-04).
--
-- Refs:
--   - CONTEXT.md D-10 (mirror v1 column names + FK semantics)
--   - RESEARCH.md §3 lines ~615-676 (verified DDL)
--   - timerz/db/models.py (authoritative v1 reference)

-- Projects: ordered by creation; project_number is the billing code (nullable per
-- v1 CharField(null=True)); project_name is required.
CREATE TABLE projects (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_number  TEXT,                       -- billing code; nullable per v1
  project_name    TEXT NOT NULL
);

-- Timers: row-per-day-row-per-task. Optional FK to projects (nullable per v1,
-- ForeignKeyField(Project, null=True)). On project delete, the FK is SET NULL
-- (v1 used Peewee default which is RESTRICT, but SET NULL is safer for the
-- "delete a stale project without orphaning timers" workflow).
CREATE TABLE timers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  description   TEXT NOT NULL DEFAULT '',     -- v1 TextField(default='')
  notes         TEXT NOT NULL DEFAULT '',     -- v1 TextField(default='')
  created_at    INTEGER NOT NULL,             -- EpochSeconds; v1 int(time.time())
  offset        INTEGER                       -- persistent duration offset (sec); NULL = 0
);
CREATE INDEX idx_timers_project_id ON timers(project_id);
CREATE INDEX idx_timers_created_at ON timers(created_at);

-- TimeEntries: start/stop records. NULL end_timestamp = currently running.
-- ON DELETE CASCADE so deleting a timer wipes its entries (v1 implicit because
-- the FK has no on_delete clause, but Peewee's default leaves rows orphaned;
-- v2 chooses CASCADE since orphaned entries are useless).
CREATE TABLE time_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  timer_id        INTEGER NOT NULL REFERENCES timers(id) ON DELETE CASCADE,
  start_timestamp INTEGER NOT NULL,           -- EpochSeconds
  end_timestamp   INTEGER                     -- EpochSeconds, NULL = running
);
CREATE INDEX idx_time_entries_timer_id ON time_entries(timer_id);
CREATE INDEX idx_time_entries_start_timestamp ON time_entries(start_timestamp);
-- Partial index for the single-active-timer invariant check (Phase 2's FSM):
CREATE INDEX idx_time_entries_running ON time_entries(timer_id)
  WHERE end_timestamp IS NULL;

-- Heartbeat: single-row table (id=1) updated every 60s by the heartbeat
-- scheduler (Phase 2 wires the scheduler). v1 stores timer_entry_id as a plain
-- int — NOT a FK — to avoid cascade complexity if the underlying entry is
-- deleted (see timerz/db/models.py line 43 comment).
CREATE TABLE heartbeat (
  id              INTEGER PRIMARY KEY,
  last_beat       INTEGER NOT NULL,           -- EpochSeconds
  timer_entry_id  INTEGER                     -- intentionally NOT a FK, per v1
);

-- Settings: key-value typed via JSON-encoded value column.
-- Mirrors v1 SettingsService surface but in SQLite (not QSettings/INI).
-- Window geometry also lives here under well-known keys: window.x, window.y,
-- window.width, window.height (decided against electron-store per project SUMMARY).
CREATE TABLE settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL                         -- JSON-encoded; consumer parses to type
);

-- Initial settings rows mirror v1 SettingsService DEFAULTS exactly:
--   week_start: 0     → JSON-encoded as the number literal '0'
--   dark_mode: true   → JSON-encoded as the literal 'true'
--   auto_pause: false → JSON-encoded as the literal 'false'
--   widget_mode: 'floating' → JSON-encoded as the double-quoted string '"floating"'
--   auto_launch: false → JSON-encoded as the literal 'false'
INSERT INTO settings (key, value) VALUES
  ('settings.week_start',  '0'),
  ('settings.dark_mode',   'true'),
  ('settings.auto_pause',  'false'),
  ('settings.widget_mode', '"floating"'),
  ('settings.auto_launch', 'false');
