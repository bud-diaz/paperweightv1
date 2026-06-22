'use strict';

// Creates a Desktop shortcut to the packaged exe on first run, on Windows and
// macOS only (the two targets users double-click rather than run from a
// terminal). Best-effort: any failure is logged and swallowed so it can never
// stop the server from starting.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function desktopDir() {
  return path.join(os.homedir(), 'Desktop');
}

function createWindowsShortcut(exePath) {
  const desktop = desktopDir();
  if (!fs.existsSync(desktop)) return;

  const shortcutPath = path.join(desktop, 'Paperweight.lnk');
  if (fs.existsSync(shortcutPath)) return;

  const psScript = [
    `$s = (New-Object -COM WScript.Shell).CreateShortcut(${JSON.stringify(shortcutPath)});`,
    `$s.TargetPath = ${JSON.stringify(exePath)};`,
    `$s.WorkingDirectory = ${JSON.stringify(path.dirname(exePath))};`,
    `$s.IconLocation = ${JSON.stringify(`${exePath},0`)};`,
    '$s.Save();',
  ].join(' ');

  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { stdio: 'ignore' });
}

function createMacShortcut(exePath) {
  const desktop = desktopDir();
  if (!fs.existsSync(desktop)) return;

  // A raw Mach-O binary double-clicked in Finder has no registered app to
  // open it with. A .command file is special-cased by Finder/LaunchServices:
  // double-clicking opens Terminal and runs it.
  const shortcutPath = path.join(desktop, 'Paperweight.command');
  if (fs.existsSync(shortcutPath)) return;

  const script = `#!/bin/bash\ncd ${JSON.stringify(path.dirname(exePath))}\nexec ${JSON.stringify(exePath)}\n`;
  fs.writeFileSync(shortcutPath, script, { mode: 0o755 });
}

function createDesktopShortcut() {
  if (typeof process.pkg === 'undefined') return; // packaged standalone exe only

  try {
    if (process.platform === 'win32') {
      createWindowsShortcut(process.execPath);
    } else if (process.platform === 'darwin') {
      createMacShortcut(process.execPath);
    }
  } catch (err) {
    console.warn('[Paperweight] Could not create a Desktop shortcut:', err.message);
  }
}

module.exports = { createDesktopShortcut };
