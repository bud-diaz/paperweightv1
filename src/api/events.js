'use strict';

const router = require('express').Router();
const { getDb } = require('../db');
const { CLIENT_EVENT_TYPES, recordAudienceEvent } = require('../events');

function positiveId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// POST /api/events — deliberately restricted to harmless client-observable
// interactions. Commerce and subscription events are server-authoritative.
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!CLIENT_EVENT_TYPES.has(body.type)) {
    return res.status(400).json({ error: 'Unsupported event type' });
  }

  const mediaId = positiveId(body.mediaId);
  const postId = positiveId(body.postId);
  if (mediaId) {
    const media = getDb().prepare('SELECT id FROM media WHERE id = ? AND is_active = 1').get(mediaId);
    if (!media) return res.status(404).json({ error: 'Media not found' });
  }
  if (postId) {
    const post = getDb().prepare('SELECT id FROM creator_posts WHERE id = ?').get(postId);
    if (!post) return res.status(404).json({ error: 'Post not found' });
  }

  const id = recordAudienceEvent(body.type, {
    req,
    mediaId,
    postId,
    source: body.source,
    dedupeKey: body.dedupeKey,
    metadata: body.metadata,
  });
  res.status(202).json({ accepted: true, id });
});

module.exports = router;
