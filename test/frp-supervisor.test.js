process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { createFrpSupervisor } = require('../src/runtime/frp-supervisor');

function fakeProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killCalls = [];
  proc.kill = signal => { proc.killCalls.push(signal); };
  return proc;
}

test('frp supervisor starts frpc with config path', () => {
  const proc = fakeProcess();
  const calls = [];
  const supervisor = createFrpSupervisor({
    frpcPath: '/bin/frpc',
    spawnImpl: (cmd, args) => { calls.push({ cmd, args }); return proc; },
    logImpl: () => {},
  });

  supervisor.start('/tmp/frpc.toml');
  assert.deepEqual(calls[0], { cmd: '/bin/frpc', args: ['-c', '/tmp/frpc.toml'] });
  assert.equal(supervisor.getStatus().status, 'connecting');
});

test('frp supervisor marks connected when frpc emits success log', () => {
  const proc = fakeProcess();
  const supervisor = createFrpSupervisor({
    spawnImpl: () => proc,
    logImpl: () => {},
  });
  supervisor.start('/tmp/frpc.toml');
  proc.stderr.emit('data', Buffer.from('login to server success'));
  assert.equal(supervisor.getStatus().status, 'connected');
});

test('frp supervisor stop marks process stopped', () => {
  const proc = fakeProcess();
  const supervisor = createFrpSupervisor({
    spawnImpl: () => proc,
    logImpl: () => {},
  });
  supervisor.start('/tmp/frpc.toml');
  supervisor.stop();
  assert.equal(supervisor.getStatus().status, 'stopped');
  assert.deepEqual(proc.killCalls, ['SIGTERM']);
});
