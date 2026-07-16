require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { freshDb, seedToken } = require('./helpers');
const liveVideo = require('../src/broadcast/liveVideo');
const { getSetting } = require('../src/db/settings');
const config = require('../src/config');
const { createApp } = require('../src/index');

const { buildRtmpArgs, isConnectSignal, findFreeRtmpPort } = liveVideo._private;

test('buildRtmpArgs shapes a video+audio FFmpeg RTMP listener', () => {
  const args = buildRtmpArgs({ host: '127.0.0.1', port: 1936, streamKey: 'abc123' });
  assert.deepEqual(args.slice(0, 5), ['-f', 'flv', '-listen', '1', '-i']);
  assert.equal(args[5], 'rtmp://127.0.0.1:1936/live/abc123');
  assert.ok(!args.includes('-vn'));
  assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.equal(args[args.indexOf('-f', args.indexOf('-c:a')) + 1], 'hls');
  assert.ok(args.some(a => typeof a === 'string' && a.endsWith('index.m3u8')));
  assert.ok(args.some(a => typeof a === 'string' && a.includes('seg_%05d.ts')));
});

test('isConnectSignal matches only the FFmpeg FLV input header line', () => {
  assert.ok(isConnectSignal('Input #0, flv, from \'rtmp://127.0.0.1:1936/live/abc\':'));
  assert.ok(!isConnectSignal('frame=  120 fps= 25 q=-1.0 size=     256kB'));
  assert.ok(!isConnectSignal(''));
});

test('findFreeRtmpPort walks past an already-bound port', async () => {
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const busyPort = occupied.address().port;

  try {
    const found = await findFreeRtmpPort(busyPort, '127.0.0.1');
    assert.notEqual(found, busyPort);
    assert.ok(found > busyPort);
  } finally {
    occupied.close();
  }
});

test('live video stream key is lazily generated and persists across reads', () => {
  freshDb();
  assert.equal(getSetting('live_video_stream_key'), null);
  const info = liveVideo.getRtmpConnectionInfo();
  assert.ok(info.streamKey);
  assert.equal(getSetting('live_video_stream_key'), info.streamKey);
  const again = liveVideo.getRtmpConnectionInfo();
  assert.equal(again.streamKey, info.streamKey);
});

test('regenerateStreamKey rotates the key while idle', () => {
  freshDb();
  const before = liveVideo.getRtmpConnectionInfo().streamKey;
  const rotated = liveVideo.regenerateStreamKey();
  assert.notEqual(rotated, before);
  assert.equal(getSetting('live_video_stream_key'), rotated);
});

test('getLiveVideoState reports idle when nothing has been started', () => {
  freshDb();
  const state = liveVideo.getLiveVideoState();
  assert.equal(state.isLive, false);
  assert.equal(state.rtmpPending, false);
});

// ─── HLS gating (the real access boundary) ──────────────────────────────────

async function withServer(fn) {
  const app = createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function writeFakeLiveVideoPlaylist() {
  const dir = path.join(config.paths.hlsOutput, 'live-video');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
}

test('/hls/live-video is gated by the creator-configured minimum tier', async () => {
  const db = freshDb();
  writeFakeLiveVideoPlaylist();
  const freeToken = seedToken(db, { tier: 'free' });
  const subscriberToken = seedToken(db, { tier: 'subscriber' });

  await withServer(async baseUrl => {
    const noAuth = await fetch(`${baseUrl}/hls/live-video/index.m3u8`);
    assert.equal(noAuth.status, 403);

    const free = await fetch(`${baseUrl}/hls/live-video/index.m3u8`, {
      headers: { Authorization: `Bearer ${freeToken.token}` },
    });
    assert.equal(free.status, 403);

    const subscriber = await fetch(`${baseUrl}/hls/live-video/index.m3u8`, {
      headers: { Authorization: `Bearer ${subscriberToken.token}` },
    });
    assert.equal(subscriber.status, 200);
    assert.match(await subscriber.text(), /#EXTM3U/);
  });
});

test('/hls/live-video honors a creator-raised minimum tier', async () => {
  const db = freshDb();
  writeFakeLiveVideoPlaylist();
  const { setSetting } = require('../src/db/settings');
  setSetting('live_video_min_tier', 'all_access');
  const subscriberToken = seedToken(db, { tier: 'subscriber' });
  const allAccessToken = seedToken(db, { tier: 'all_access' });

  await withServer(async baseUrl => {
    const subscriber = await fetch(`${baseUrl}/hls/live-video/index.m3u8`, {
      headers: { Authorization: `Bearer ${subscriberToken.token}` },
    });
    assert.equal(subscriber.status, 403);

    const allAccess = await fetch(`${baseUrl}/hls/live-video/index.m3u8`, {
      headers: { Authorization: `Bearer ${allAccessToken.token}` },
    });
    assert.equal(allAccess.status, 200);
  });
});
