const fs = require('fs');
const path = require('path');

function loadEnvValue(key) {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const stripped = line.replace(/#.*$/, '').trim();
      const m = stripped.match(/^([A-Z_]+)=(.*)$/);
      if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch {}
  return '';
}

const tunnelToken = loadEnvValue('CLOUDFLARE_TUNNEL_TOKEN');

const apps = [
  {
    name: 'paperweight',
    script: './src/index.js',
    max_memory_restart: '400M',
    restart_delay: 3000,
    log_file: './logs/combined.log',
    error_file: './logs/error.log',
    time: true,
    env: {
      NODE_ENV: 'production',
    },
  },
];

if (tunnelToken) {
  apps.push({
    name: 'cloudflared-tunnel',
    script: 'cloudflared',
    args: `tunnel --no-autoupdate run --token ${tunnelToken}`,
    interpreter: 'none',
    autorestart: true,
    restart_delay: 5000,
    log_file: './logs/tunnel.log',
    error_file: './logs/tunnel-error.log',
    time: true,
  });
}

module.exports = { apps };
