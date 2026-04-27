-- Add archive support to tasks. Local-only until this migration runs;
-- afterwards archive state round trips across devices.
ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN archived_at TEXT;
ALTER TABLE tasks ADD COLUMN archive_reason TEXT NOT NULL DEFAULT '';
