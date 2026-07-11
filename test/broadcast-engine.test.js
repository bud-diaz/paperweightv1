require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const broadcast = require('../src/broadcast');

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
