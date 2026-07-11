const fs = require('fs');
const path = require('path');

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(from, to) {
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
      lastErr = err;
      sleepSync(25 * (attempt + 1));
    }
  }
  throw lastErr;
}

function writeJsonAtomic(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
    renameWithRetry(tmpPath, filePath);
  } catch (err) {
    try { fs.rmSync(tmpPath, { force: true }); } catch {}
    throw err;
  }
}

module.exports = { writeJsonAtomic, _private: { renameWithRetry } };
