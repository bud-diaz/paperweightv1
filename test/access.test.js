// Access-control matrix: visibility x tier x scoped tokens x all-access.
const test = require('node:test');
const assert = require('node:assert');
const { freshDb, seedMedia, seedListener, seedToken } = require('./helpers');
const { canAccessMedia, canDownloadMedia } = require('../src/auth/access');

test('public media is playable by everyone, downloadable only by subscribers', () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'public' });

  assert.ok(canAccessMedia({ tier: 'free' }, media).allowed);
  assert.ok(canAccessMedia({ tier: 'subscriber' }, media).allowed);

  // Download requires subscriber tier even for public tracks.
  assert.ok(!canDownloadMedia({ tier: 'free' }, media).allowed);
  assert.ok(canDownloadMedia({ tier: 'subscriber' }, media).allowed);
});

test('supporters_only requires subscriber tier or a scoped token', () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'supporters_only' });

  const free = canAccessMedia({ tier: 'free' }, media);
  assert.ok(!free.allowed);
  assert.strictEqual(free.error, 'Supporter access required');

  assert.ok(canAccessMedia({ tier: 'subscriber' }, media).allowed);
  assert.ok(canAccessMedia({ tier: 'pro' }, media).allowed);

  // A free listener holding a track-scoped token for this item gets in.
  const scoped = { tier: 'free', tokenRow: { scope_type: 'track', scope_id: media.id } };
  assert.ok(canAccessMedia(scoped, media).allowed);

  // ...but a scoped token for a different track does not.
  const wrongScope = { tier: 'free', tokenRow: { scope_type: 'track', scope_id: media.id + 999 } };
  assert.ok(!canAccessMedia(wrongScope, media).allowed);
});

test('vault denies a free listener and returns unlock options', () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'vault' });

  const res = canAccessMedia({ tier: 'free', tokenRow: null }, media);
  assert.ok(!res.allowed);
  assert.strictEqual(res.error, 'Vault access required');
  assert.ok(res.unlockOptions, 'denied vault response carries unlockOptions');
});

test('vault allows a track-scoped token without consulting unlock tables', () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'vault' });
  const req = { tier: 'free', tokenRow: { scope_type: 'track', scope_id: media.id } };
  assert.ok(canAccessMedia(req, media).allowed);
});

test('vault allows subscriber tiers when the creator includes subscribers', () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'vault' });

  for (const tier of ['subscriber', 'pro', 'all_access']) {
    assert.ok(!canAccessMedia({ tier, tokenRow: null }, media).allowed);
  }

  // Creator flips the switch.
  db.prepare('UPDATE vault_all_access SET enabled = 1, subscribers_included = 1 WHERE id = 1').run();
  for (const tier of ['subscriber', 'pro', 'all_access']) {
    assert.ok(canAccessMedia({ tier, tokenRow: null }, media).allowed);
  }
});

test('canDownloadMedia on a vault track follows the vault access rules', () => {
  const db = freshDb();
  const media = seedMedia(db, { visibility: 'vault' });

  // Subscriber tier does not by itself grant vault downloads.
  assert.ok(!canDownloadMedia({ tier: 'subscriber', tokenRow: null }, media).allowed);

  // A matching track-scoped token does.
  const scoped = { tier: 'free', tokenRow: { scope_type: 'track', scope_id: media.id } };
  assert.ok(canDownloadMedia(scoped, media).allowed);
});
