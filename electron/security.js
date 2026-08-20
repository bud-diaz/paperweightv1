'use strict';

function normalizePort(protocol, port) {
  if (port) return String(port);
  if (protocol === 'http:') return '80';
  if (protocol === 'https:') return '443';
  return '';
}

function parseUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || ''));
  } catch {
    return null;
  }
}

function isTrustedSetupUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed || parsed.protocol !== 'file:') return false;
  const pathname = decodeURIComponent(parsed.pathname || '').replace(/\\/g, '/');
  return /\/renderer\/setup\.html$/i.test(pathname);
}

function isTrustedAppUrl(rawUrl, config) {
  const parsed = parseUrl(rawUrl);
  if (!parsed || parsed.protocol !== 'http:') return false;
  const expectedHost = String(config?.host || '').toLowerCase();
  const expectedPort = normalizePort('http:', String(config?.port || ''));
  const actualHost = parsed.hostname.toLowerCase();
  const actualPort = normalizePort(parsed.protocol, parsed.port);
  return actualHost === expectedHost && actualPort === expectedPort;
}

function isAllowedExternalUrl(rawUrl, allowedHosts = ['github.com']) {
  const parsed = parseUrl(rawUrl);
  if (!parsed || parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return allowedHosts.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function safeOpenExternal(shell, rawUrl, allowedHosts) {
  if (!isAllowedExternalUrl(rawUrl, allowedHosts)) return false;
  shell.openExternal(rawUrl);
  return true;
}

module.exports = {
  isAllowedExternalUrl,
  isTrustedAppUrl,
  isTrustedSetupUrl,
  safeOpenExternal,
};
