-- Migration 035: one coordinated release plan spanning content visibility,
-- posts, notifications, highlight placement, and a radio premiere queue.

CREATE TABLE IF NOT EXISTS release_campaigns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  title             TEXT    NOT NULL,
  description       TEXT,
  project_id        INTEGER REFERENCES vault_projects(id) ON DELETE SET NULL,
  release_at        TEXT    NOT NULL,
  visibility        TEXT    NOT NULL DEFAULT 'public'
                    CHECK(visibility IN ('public','supporters_only','vault')),
  post_title        TEXT,
  post_body         TEXT,
  post_visibility   TEXT    NOT NULL DEFAULT 'public'
                    CHECK(post_visibility IN ('public','supporters_only')),
  notify_webhook    INTEGER NOT NULL DEFAULT 1,
  notify_supporters INTEGER NOT NULL DEFAULT 0,
  set_highlight     INTEGER NOT NULL DEFAULT 1,
  queue_premiere    INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','scheduled','publishing','published','failed','cancelled')),
  published_at      TEXT,
  last_error        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS release_campaign_items (
  campaign_id INTEGER NOT NULL REFERENCES release_campaigns(id) ON DELETE CASCADE,
  media_id    INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, media_id)
);

CREATE INDEX IF NOT EXISTS idx_release_campaigns_due ON release_campaigns(status, release_at);
