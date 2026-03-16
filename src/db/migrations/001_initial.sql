CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filepath    TEXT    NOT NULL UNIQUE,
  filename    TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  title       TEXT,
  artist      TEXT,
  album       TEXT,
  duration    REAL,
  bpm         REAL,
  tags        TEXT,
  file_size   INTEGER,
  mime_type   TEXT,
  visibility  TEXT    NOT NULL DEFAULT 'public',
  indexed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL UNIQUE,
  label       TEXT,
  tier        TEXT    NOT NULL DEFAULT 'subscriber',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used   TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS schedule_blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week INTEGER,
  start_time  TEXT    NOT NULL,
  end_time    TEXT    NOT NULL,
  category    TEXT,
  tags_filter TEXT,
  mode        TEXT    NOT NULL DEFAULT 'shuffle',
  label       TEXT,
  priority    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  block_id    INTEGER REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  media_id    INTEGER REFERENCES media(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,
  UNIQUE(block_id, position)
);

CREATE INDEX IF NOT EXISTS idx_media_category  ON media(category);
CREATE INDEX IF NOT EXISTS idx_media_active    ON media(is_active);
CREATE INDEX IF NOT EXISTS idx_media_visibility ON media(visibility);
CREATE INDEX IF NOT EXISTS idx_tokens_token    ON tokens(token);
CREATE INDEX IF NOT EXISTS idx_schedule_dow    ON schedule_blocks(day_of_week, start_time);
