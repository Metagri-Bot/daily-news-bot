'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

/** Acquire a filesystem lock shared by Bot instances using the same state volume. */
async function acquireAiGuideRunLock(file, now = Date.now()) {
  const token = crypto.randomUUID();
  await fs.mkdir(path.dirname(file), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(file, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ token, pid: process.pid, startedAt: now }));
        await handle.sync();
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          const current = JSON.parse(await fs.readFile(file, 'utf8'));
          if (current.token === token) await fs.unlink(file);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let stat;
      try { stat = await fs.stat(file); }
      catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      if (now - stat.mtimeMs <= STALE_AFTER_MS) return null;
      try { await fs.unlink(file); }
      catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
    }
  }
  return null;
}

module.exports = { acquireAiGuideRunLock };
