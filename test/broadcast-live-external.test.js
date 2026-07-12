require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const { freshDb } = require('./helpers');
const live = require('../src/broadcast/live');
const { getSetting } = require('../src/db/settings');

const { buildRtmpArgs, isConnectSignal, findFreeRtmpPort } = live._private;

test('buildRtmpArgs shapes a single-connection FFmpeg RTMP listener', () => {
  const args = buildRtmpArgs({ host: '127.0.0.1', port: 1935, streamKey: 'abc123' });
  assert.deepEqual(args.slice(0, 5), ['-f', 'flv', '-listen', '1', '-i']);
  assert.equal(args[5], 'rtmp://127.0.0.1:1935/live/abc123');
  assert.ok(args.includes('-vn'));
  assert.equal(args[args.indexOf('-map') + 1], '0:a');
  assert.equal(args[args.indexOf('-c:a') + 1], 'aac');
  assert.equal(args[args.indexOf('-f', args.indexOf('-c:a')) + 1], 'hls');
  assert.ok(args.some(a => typeof a === 'string' && a.endsWith('index.m3u8')));
  assert.ok(args.some(a => typeof a === 'string' && a.includes('seg_%05d.ts')));
});

test('isConnectSignal matches only the FFmpeg FLV input header line', () => {
  assert.ok(isConnectSignal('Input #0, flv, from \'rtmp://127.0.0.1:1935/live/abc\':'));
  assert.ok(!isConnectSignal('frame=  120 fps= 25 q=-1.0 size=     256kB'));
  assert.ok(!isConnectSignal('Output #0, hls, to \'hls_output/live/index.m3u8\':'));
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

test('mic and RTMP live sources are mutually exclusive', async () => {
  freshDb();
  live.startLiveMic();
  try {
    await assert.rejects(() => live.startLiveRtmp({}), /Already live/);
  } finally {
    live.stopLive();
  }
});

test('external stream key is lazily generated and persists across reads', () => {
  freshDb();
  assert.equal(getSetting('external_stream_key'), null);
  const info = live.getRtmpConnectionInfo();
  assert.ok(info.streamKey);
  assert.equal(getSetting('external_stream_key'), info.streamKey);
  const again = live.getRtmpConnectionInfo();
  assert.equal(again.streamKey, info.streamKey);
});

test('regenerateStreamKey rotates the key while idle', () => {
  freshDb();
  const before = live.getRtmpConnectionInfo().streamKey;
  const rotated = live.regenerateStreamKey();
  assert.notEqual(rotated, before);
  assert.equal(getSetting('external_stream_key'), rotated);
});

test('regenerateStreamKey is blocked while a broadcast is live or pending', async () => {
  freshDb();
  live.startLiveMic();
  try {
    assert.throws(() => live.regenerateStreamKey(), /live or pending/);
  } finally {
    live.stopLive();
  }
});

test('getLiveState reports idle when nothing has been started', () => {
  freshDb();
  const state = live.getLiveState();
  assert.equal(state.isLive, false);
  assert.equal(state.source, null);
  assert.equal(state.rtmpPending, false);
});
