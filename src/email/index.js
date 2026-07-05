// Minimal outbound SMTP client — pure Node (net/tls), no new dependencies,
// mirroring the pure-crypto approach used for dashboard 2FA.
//
// Configured entirely from .env; when unconfigured every email feature
// degrades gracefully (password reset falls back to creator-generated links,
// post notifications are simply skipped):
//
//   SMTP_HOST     — required to enable email
//   SMTP_PORT     — default 587 (465 when SMTP_SECURE=implicit)
//   SMTP_SECURE   — 'starttls' (default) | 'implicit' (TLS from byte one) | 'none'
//   SMTP_USER     — optional; enables AUTH PLAIN
//   SMTP_PASS     — optional; used with SMTP_USER
//   SMTP_FROM     — required to enable email, e.g. 'Station <station@example.com>'
//
// Only plain-text messages are sent. This is deliberate: everything Paperweight
// emails (reset links, post notifications) is a short message with a URL.

const net = require('net');
const tls = require('tls');

const COMMAND_TIMEOUT_MS = 30_000;

function smtpSettings() {
  const host = (process.env.SMTP_HOST || '').trim();
  const from = (process.env.SMTP_FROM || '').trim();
  const secure = (process.env.SMTP_SECURE || 'starttls').trim().toLowerCase();
  const port = parseInt(process.env.SMTP_PORT || '', 10)
    || (secure === 'implicit' ? 465 : 587);
  return {
    host,
    from,
    secure,
    port,
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
  };
}

function isEmailConfigured() {
  const s = smtpSettings();
  return !!(s.host && s.from);
}

// Extracts the bare address from 'Name <addr@host>' or returns the input as-is.
function bareAddress(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : String(value)).trim();
}

function isPlausibleAddress(addr) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(addr);
}

// RFC 2047 encoded-word for non-ASCII header values (e.g. station names in Subject).
function encodeHeaderValue(value) {
  const str = String(value).replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(str)) return str;
  return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
}

// SMTP DATA requires CRLF line endings and dot-stuffing of leading periods.
function encodeBody(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

// Reads complete (possibly multiline) SMTP replies off a socket and hands them to
// awaiting commands one at a time.
function createReplyReader(socket) {
  let buffer = '';
  let waiter = null;

  function tryFlush() {
    if (!waiter) return;
    // A reply is complete at the first line with a space after the code ('250 ').
    const lines = buffer.split('\r\n');
    let consumed = 0;
    const replyLines = [];
    for (const line of lines) {
      if (line === '' && consumed + 2 > buffer.length) break;
      replyLines.push(line);
      consumed += line.length + 2;
      if (/^\d{3} /.test(line)) {
        buffer = buffer.slice(consumed);
        const w = waiter;
        waiter = null;
        w.resolve({ code: parseInt(line.slice(0, 3), 10), lines: replyLines });
        return tryFlush();
      }
    }
  }

  socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    tryFlush();
  });

  return function readReply() {
    return new Promise((resolve, reject) => {
      if (waiter) return reject(new Error('SMTP reply reader busy'));
      waiter = { resolve, reject };
      tryFlush();
    });
  };
}

function connectSocket(settings) {
  return new Promise((resolve, reject) => {
    const onError = err => reject(new Error(`SMTP connection failed: ${err.message}`));
    if (settings.secure === 'implicit') {
      const socket = tls.connect({ host: settings.host, port: settings.port, servername: settings.host }, () => resolve(socket));
      socket.once('error', onError);
    } else {
      const socket = net.connect({ host: settings.host, port: settings.port }, () => resolve(socket));
      socket.once('error', onError);
    }
  });
}

function upgradeToTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername: host }, () => resolve(secured));
    secured.once('error', err => reject(new Error(`STARTTLS failed: ${err.message}`)));
  });
}

// Sends one plain-text email. Resolves on acceptance by the server, rejects on
// any protocol or transport error. Callers decide whether a failure is fatal.
async function sendMail({ to, subject, text }) {
  const settings = smtpSettings();
  if (!settings.host || !settings.from) {
    throw new Error('SMTP is not configured (set SMTP_HOST and SMTP_FROM in .env)');
  }

  const toAddr = bareAddress(to);
  if (!isPlausibleAddress(toAddr)) {
    throw new Error(`Invalid recipient address: ${to}`);
  }
  const fromAddr = bareAddress(settings.from);

  let socket = await connectSocket(settings);
  socket.setTimeout(COMMAND_TIMEOUT_MS);

  let finished = false;
  const failure = new Promise((_, reject) => {
    socket.on('timeout', () => { if (!finished) { socket.destroy(); reject(new Error('SMTP timeout')); } });
    socket.on('error', err => { if (!finished) reject(new Error(`SMTP socket error: ${err.message}`)); });
    socket.on('close', () => { if (!finished) reject(new Error('SMTP connection closed unexpectedly')); });
  });

  let readReply = createReplyReader(socket);

  async function expect(codes, replyPromise) {
    const reply = await Promise.race([replyPromise, failure]);
    if (!codes.includes(reply.code)) {
      throw new Error(`SMTP error: ${reply.lines.join(' / ')}`);
    }
    return reply;
  }

  async function command(line, codes) {
    const replyPromise = readReply();
    socket.write(`${line}\r\n`);
    return expect(codes, replyPromise);
  }

  try {
    await expect([220], readReply());
    let ehlo = await command('EHLO paperweight.local', [250]);

    const supportsStartTls = ehlo.lines.some(l => /STARTTLS/i.test(l));
    if (settings.secure === 'starttls') {
      if (!supportsStartTls) {
        throw new Error('SMTP server does not offer STARTTLS (set SMTP_SECURE=none only for trusted networks)');
      }
      await command('STARTTLS', [220]);
      socket.removeAllListeners('data');
      socket = await upgradeToTls(socket, settings.host);
      socket.setTimeout(COMMAND_TIMEOUT_MS);
      socket.on('timeout', () => { if (!finished) socket.destroy(); });
      readReply = createReplyReader(socket);
      ehlo = await command('EHLO paperweight.local', [250]);
    }

    if (settings.user) {
      const token = Buffer.from(`\u0000${settings.user}\u0000${settings.pass}`, 'utf8').toString('base64');
      await command(`AUTH PLAIN ${token}`, [235]);
    }

    await command(`MAIL FROM:<${fromAddr}>`, [250]);
    await command(`RCPT TO:<${toAddr}>`, [250, 251]);
    await command('DATA', [354]);

    const headers = [
      `From: ${encodeHeaderValue(settings.from)}`,
      `To: <${toAddr}>`,
      `Subject: ${encodeHeaderValue(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@paperweight.local>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
    ];
    const message = `${headers.join('\r\n')}\r\n\r\n${encodeBody(text)}\r\n.`;
    await command(message, [250]);

    finished = true;
    socket.write('QUIT\r\n');
    socket.end();
    return true;
  } catch (err) {
    finished = true;
    try { socket.destroy(); } catch {}
    throw err;
  }
}

module.exports = { isEmailConfigured, sendMail, bareAddress, encodeHeaderValue, encodeBody, smtpSettings };
