'use strict';

const fs = require('fs');
const path = require('path');

function assertSafeTomlString(label, value) {
  const str = String(value || '').trim();
  if (!str || /[\r\n"#]/.test(str)) throw new Error(`${label} is invalid`);
  return str;
}

function buildFrpcToml({ serverAddr, serverPort, authToken, proxyName, subdomain, localPort }) {
  const cleanServerAddr = assertSafeTomlString('serverAddr', serverAddr);
  const cleanAuthToken = assertSafeTomlString('authToken', authToken);
  const cleanProxyName = assertSafeTomlString('proxyName', proxyName);
  const cleanSubdomain = assertSafeTomlString('subdomain', subdomain);
  const port = Number(serverPort);
  const local = Number(localPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('serverPort is invalid');
  if (!Number.isInteger(local) || local <= 0 || local > 65535) throw new Error('localPort is invalid');

  return [
    `serverAddr = "${cleanServerAddr}"`,
    `serverPort = ${port}`,
    '',
    'auth.method = "token"',
    `auth.token = "${cleanAuthToken}"`,
    '',
    '[[proxies]]',
    `name = "${cleanProxyName}"`,
    'type = "http"',
    'localIP = "127.0.0.1"',
    `localPort = ${local}`,
    `subdomain = "${cleanSubdomain}"`,
    '',
  ].join('\n');
}

function writeFrpcConfig(root, opts) {
  const dir = path.join(root, 'tunnel');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'frpc.toml');
  fs.writeFileSync(file, buildFrpcToml(opts), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}

module.exports = { buildFrpcToml, writeFrpcConfig };
