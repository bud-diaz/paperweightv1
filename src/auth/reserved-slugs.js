// Slugs that cannot be claimed by stations — system paths, brand names, and
// anything that would collide with platform routes or impersonate the service.
const RESERVED = new Set([
  'admin', 'administrator', 'ai', 'api', 'app', 'apps', 'assets', 'auth',
  'authentication', 'backend', 'billing', 'cache', 'cdn', 'cloud', 'config',
  'console', 'control', 'dashboard', 'data', 'db', 'database', 'deploy',
  'deployment', 'dev', 'developer', 'developers', 'docs', 'documentation',
  'download', 'downloads', 'edge', 'engine', 'gateway', 'health', 'host',
  'hosting', 'hub', 'infra', 'infrastructure', 'internal', 'kpi', 'logs',
  'mail', 'metrics', 'monitor', 'monitoring', 'network', 'observability',
  'observatory', 'ops', 'operations', 'panel', 'platform', 'portal', 'proxy',
  'root', 'secure', 'security', 'server', 'services', 'settings', 'shell',
  'ssh', 'stack', 'static', 'status', 'storage', 'support', 'sys', 'system',
  'systems', 'telemetry', 'terminal', 'update', 'updates', 'upload', 'uploads',
  'webhook', 'webhooks', 'www', 'core', 'play', 'studio', 'paperweight',
  'paperweighthq', 'sync', 'marketplace', 'directory', 'discover', 'analytics',
  'insights', 'stations', 'broadcast', 'radio', 'stream', 'streams', 'player',
  'listen', 'creator', 'creators', 'account', 'accounts', 'login', 'logout',
  'register', 'signup', 'signin', 'profile', 'profiles', 'user', 'users',
  'member', 'members', 'team', 'teams', 'organization', 'org', 'owner',
  'owners', 'help', 'about', 'contact', 'legal', 'privacy', 'terms', 'jobs',
  'careers', 'press', 'news', 'blog', 'store', 'shop', 'payment', 'payments',
  'checkout', 'verify', 'verification',
]);

// Substrings that are blocked individually and as part of any larger combination.
const PROFANITY = [
  'ass', 'fuck', 'shit', 'bitch', 'nigga', 'nigger', 'cock', 'pussy', 'butthole',
];

function isReservedSlug(slug) {
  return RESERVED.has(slug.toLowerCase());
}

function containsProfanity(slug) {
  const lower = slug.toLowerCase();
  return PROFANITY.some(term => lower.includes(term));
}

// Returns { valid: true } or { valid: false, reason: string }.
function validateSlug(slug) {
  if (!slug || typeof slug !== 'string') {
    return { valid: false, reason: 'Slug is required' };
  }
  const normalized = slug.toLowerCase().trim();
  if (isReservedSlug(normalized)) {
    return { valid: false, reason: `"${slug}" is a reserved slug` };
  }
  if (containsProfanity(normalized)) {
    return { valid: false, reason: `"${slug}" contains a restricted term` };
  }
  return { valid: true };
}

module.exports = { RESERVED, PROFANITY, isReservedSlug, containsProfanity, validateSlug };
