process.env.PAPERWEIGHT_ALLOW_MISSING_ENV = 'true';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const email = require('../src/email');

// Minimal in-process SMTP server that records the full session.
function startFakeSmtp({ requireAuth = false } = {}) {
  const session = { commands: [], message: null, authToken: null };
  const server = net.createServer(socket => {
    let inData = false;
    let dataBuf = '';
    socket.write('220 fake.test ESMTP\r\n');
    socket.on('data', chunk => {
      const text = chunk.toString('utf8');
      if (inData) {
        dataBuf += text;
        const end = dataBuf.indexOf('\r\n.\r\n');
        if (end !== -1) {
          session.message = dataBuf.slice(0, end);
          inData = false;
          socket.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n')) {
        if (!line) continue;
        session.commands.push(line);
        if (/^EHLO/i.test(line)) {
          socket.write('250-fake.test\r\n250-8BITMIME\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (/^AUTH PLAIN/i.test(line)) {
          session.authToken = line.split(' ')[2];
          socket.write('235 ok\r\n');
        } else if (/^MAIL FROM/i.test(line)) {
          if (requireAuth && !session.authToken) { socket.write('530 auth required\r\n'); continue; }
          socket.write('250 ok\r\n');
        } else if (/^RCPT TO/i.test(line)) {
          socket.write('250 ok\r\n');
        } else if (/^DATA/i.test(line)) {
          inData = true;
          dataBuf = '';
          socket.write('354 go ahead\r\n');
        } else if (/^QUIT/i.test(line)) {
          socket.write('221 bye\r\n');
          socket.end();
        } else {
          socket.write('250 ok\r\n');
        }
      }
    });
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, session }));
  });
}

function withSmtpEnv(port, extra, fn) {
  const saved = {};
  const vars = {
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(port),
    SMTP_SECURE: 'none',
    SMTP_FROM: 'Test Station <station@example.com>',
    SMTP_USER: '',
    SMTP_PASS: '',
    ...extra,
  };
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === '') delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('isEmailConfigured requires SMTP_HOST and SMTP_FROM', async () => {
  await withSmtpEnv(2525, { SMTP_HOST: '' }, async () => {
    assert.equal(email.isEmailConfigured(), false);
  });
  await withSmtpEnv(2525, {}, async () => {
    assert.equal(email.isEmailConfigured(), true);
  });
  await withSmtpEnv(2525, { SMTP_FROM: '' }, async () => {
    assert.equal(email.isEmailConfigured(), false);
  });
});

test('sendMail delivers a plain-text message over SMTP', async () => {
  const { server, port, session } = await startFakeSmtp();
  try {
    await withSmtpEnv(port, {}, async () => {
      await email.sendMail({
        to: 'listener@example.com',
        subject: 'Reset your password',
        text: 'Hello.\n.leading dot line\nBye.',
      });
    });

    assert.ok(session.commands.some(c => c === 'MAIL FROM:<station@example.com>'));
    assert.ok(session.commands.some(c => c === 'RCPT TO:<listener@example.com>'));
    assert.match(session.message, /Subject: Reset your password/);
    assert.match(session.message, /To: <listener@example.com>/);
    assert.match(session.message, /Content-Type: text\/plain; charset=utf-8/);
    // Dot-stuffing: the leading '.' line must arrive doubled.
    assert.match(session.message, /\r\n\.\.leading dot line\r\n/);
  } finally {
    server.close();
  }
});

test('sendMail authenticates with AUTH PLAIN when SMTP_USER is set', async () => {
  const { server, port, session } = await startFakeSmtp({ requireAuth: true });
  try {
    await withSmtpEnv(port, { SMTP_USER: 'user@example.com', SMTP_PASS: 'sekret' }, async () => {
      await email.sendMail({ to: 'l@example.com', subject: 'Hi', text: 'Body' });
    });
    const decoded = Buffer.from(session.authToken, 'base64').toString('utf8');
    assert.equal(decoded, '\u0000user@example.com\u0000sekret');
  } finally {
    server.close();
  }
});

test('sendMail rejects bad recipients and unconfigured SMTP', async () => {
  await withSmtpEnv(2525, { SMTP_HOST: '' }, async () => {
    await assert.rejects(() => email.sendMail({ to: 'a@b.co', subject: 'x', text: 'y' }), /not configured/);
  });
  await withSmtpEnv(2525, {}, async () => {
    await assert.rejects(() => email.sendMail({ to: 'not-an-email', subject: 'x', text: 'y' }), /Invalid recipient/);
  });
});

test('header encoding and body encoding helpers', () => {
  assert.equal(email.encodeHeaderValue('Plain ASCII'), 'Plain ASCII');
  assert.match(email.encodeHeaderValue('Stätion'), /^=\?UTF-8\?B\?/);
  assert.equal(email.encodeBody('a\n.b\nc'), 'a\r\n..b\r\nc');
  assert.equal(email.bareAddress('Name <x@y.z>'), 'x@y.z');
  assert.equal(email.bareAddress('x@y.z'), 'x@y.z');
});
