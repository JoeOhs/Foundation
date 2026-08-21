// One-time archival fetch of a CCEL ThML volume, with an on-disk cache.
//
// Deliberately built on node:https rather than fetch(). CCEL streams these
// files chunked with no Content-Length and takes several minutes to finish
// the larger ones; Node's fetch() aborts at its 300s body timeout, which
// killed every attempt at Vol. 1 (5.4 MB) while the smaller volumes came
// down fine. A raw request with the timeout disabled downloads all three.

import fs from 'node:fs/promises';
import https from 'node:https';
import zlib from 'node:zlib';

const USER_AGENT =
  'FoundationNPNFBuilder/1.0 (personal, non-commercial, offline Bible study app; ' +
  'one-time archival fetch; contact: shintax909@gmail.com)';

const ATTEMPTS = 6;
const RETRY_DELAY_MS = 5_000;
const MIN_BYTES = 100_000;

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml', 'Accept-Encoding': 'gzip, deflate' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        get(new URL(res.headers.location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip())
        : encoding === 'deflate' ? res.pipe(zlib.createInflate())
          : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      res.on('error', reject);
    });
    req.setTimeout(0);
    req.on('error', reject);
  });
}

export async function loadRaw(volumeId, rawDir, refetch) {
  const cachePath = `${rawDir}/${volumeId}.xml`;
  if (!refetch) {
    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      if (cached.length > MIN_BYTES) return cached;
    } catch { /* not cached */ }
  }

  console.log('Downloading ThML XML from CCEL…');
  let lastError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const buf = await get(`https://ccel.org/ccel/s/schaff/${volumeId}.xml`);
      if (buf.length < MIN_BYTES) throw new Error(`truncated response (${buf.length} bytes)`);
      const text = buf.toString('utf8');
      await fs.mkdir(rawDir, { recursive: true });
      await fs.writeFile(cachePath, text, 'utf8');
      return text;
    } catch (err) {
      lastError = err;
      console.log(`  attempt ${attempt}/${ATTEMPTS} failed: ${err.message}`);
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  throw new Error(`Could not download ${volumeId}.xml: ${lastError?.message ?? 'unknown error'}`);
}
