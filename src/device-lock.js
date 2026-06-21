// Offline hardware fingerprint for the packaged executable build.
// Pure Node builtins (os/fs/child_process/crypto) — no external dependencies.
// NOTE: this only deters casual copying of the .exe + data folder; it is not
// tamper-resistant, since the check ships inside the user's own pkg bundle.

const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function readLinuxMachineId() {
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const id = fs.readFileSync(file, 'utf8').trim();
      if (id) return id;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function readMacPlatformUuid() {
  try {
    const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
      encoding: 'utf8',
      timeout: 2000,
    });
    const match = out.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function readWindowsMachineGuid() {
  try {
    const out = execFileSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { encoding: 'utf8', timeout: 2000 },
    );
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getStableId() {
  if (process.platform === 'linux') {
    const id = readLinuxMachineId();
    if (id) return { id, source: 'linux-machine-id' };
  } else if (process.platform === 'darwin') {
    const id = readMacPlatformUuid();
    if (id) return { id, source: 'macos-ioreg' };
  } else if (process.platform === 'win32') {
    const id = readWindowsMachineGuid();
    if (id) return { id, source: 'windows-registry' };
  }

  const cpuModel = os.cpus()[0]?.model || '';
  return { id: `${os.hostname()}|${cpuModel}`, source: 'fallback' };
}

function computeFingerprint() {
  const { id } = getStableId();
  return crypto
    .createHash('sha256')
    .update(`${id}|${os.platform()}|${os.arch()}`)
    .digest('hex');
}

function getStableIdSource() {
  return getStableId().source;
}

module.exports = { computeFingerprint, getStableIdSource };
