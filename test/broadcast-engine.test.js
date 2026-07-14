const { freshDb, seedMedia } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const broadcast = require('../src/broadcast');
const {
  buildShuffleBatch,
  buildSequentialBatch,
  buildSmartPlaylistBatch,
  isBroadcastPlayableTrack,
} = require('../src/broadcast/playlist');

function hlsFlags(args) {
  const flagIndex = args.indexOf('-hls_flags');
  assert.notEqual(flagIndex, -1);
  return args[flagIndex + 1].split('+');
}

test('broadcast HLS batches keep append flags by default', () => {
  const flags = hlsFlags(broadcast._private.buildFFmpegArgs('concat.txt', false));
  assert.ok(flags.includes('append_list'));
  assert.ok(!flags.includes('discont_start'));
});

test('broadcast HLS batches include discontinuity markers for stream type changes', () => {
  const flags = hlsFlags(broadcast._private.buildFFmpegArgs('concat.txt', true, { markDiscontinuity: true }));
  assert.ok(flags.includes('append_list'));
  assert.ok(flags.includes('discont_start'));
});

test('broadcast resets the HLS window when media kind changes', () => {
  assert.equal(broadcast._private.shouldResetHlsWindow(null, 'audio'), false);
  assert.equal(broadcast._private.shouldResetHlsWindow('audio', 'audio'), false);
  assert.equal(broadcast._private.shouldResetHlsWindow('video', 'video'), false);
  assert.equal(broadcast._private.shouldResetHlsWindow('audio', 'video'), true);
  assert.equal(broadcast._private.shouldResetHlsWindow('video', 'audio'), true);
});

test('broadcast playlist builders only return public local tracks', () => {
  const db = freshDb();
  const local = seedMedia(db, { title: 'Local Public', filepath: '/vault/local-public.mp3' });
  const supporter = seedMedia(db, { title: 'Supporter', visibility: 'supporters_only', filepath: '/vault/supporter.mp3' });
  const vault = seedMedia(db, { title: 'Vault', visibility: 'vault', filepath: '/vault/vault.mp3' });
  const external = seedMedia(db, { title: 'External', filepath: 'external://youtube/abc' });
  const inactive = seedMedia(db, { title: 'Inactive', filepath: '/vault/inactive.mp3' });
  db.prepare('UPDATE media SET is_active = 0 WHERE id = ?').run(inactive.id);

  assert.equal(isBroadcastPlayableTrack(local), true);
  assert.equal(isBroadcastPlayableTrack(supporter), false);
  assert.equal(isBroadcastPlayableTrack(vault), false);
  assert.equal(isBroadcastPlayableTrack(external), false);

  assert.deepEqual(buildShuffleBatch({ count: 20 }).map(row => row.id), [local.id]);
  assert.deepEqual(buildSmartPlaylistBatch({ count: 20 }).map(row => row.id), [local.id]);

  const blockId = db.prepare(`
    INSERT INTO schedule_blocks (start_time, end_time, mode, label)
    VALUES ('00:00', '23:59', 'sequential', 'Pinned')
  `).run().lastInsertRowid;
  const insertItem = db.prepare('INSERT INTO playlist_items (block_id, media_id, position) VALUES (?, ?, ?)');
  insertItem.run(blockId, supporter.id, 1);
  insertItem.run(blockId, external.id, 2);
  insertItem.run(blockId, local.id, 3);
  insertItem.run(blockId, vault.id, 4);

  assert.deepEqual(buildSequentialBatch({ blockId, count: 20 }).map(row => row.id), [local.id]);
});
