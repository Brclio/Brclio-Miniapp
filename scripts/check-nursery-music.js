'use strict';

// Optional live verification: headers/range by default, full streamed SHA256 with --full.
const { SONGS, SOURCE } = require('../miniprogram/data/nursery-songs');
const { createHash } = require('node:crypto');

async function checkSong(song, { full = false } = {}) {
  const head = await fetch(song.url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
  if (head.status !== 200) throw new Error('HEAD ' + head.status);
  if (!String(head.headers.get('content-type')).startsWith('audio/mpeg')) throw new Error('Unexpected Content-Type');
  if (Number(head.headers.get('content-length')) !== song.bytes) throw new Error('Content-Length differs from source');
  if (head.headers.get('accept-ranges') !== 'bytes') throw new Error('Byte-range seek is unsupported');
  const partial = await fetch(song.url, {
    headers: { Range: 'bytes=0-15' }, signal: AbortSignal.timeout(20000)
  });
  if (partial.status !== 206) { if (partial.body) await partial.body.cancel(); throw new Error('Range GET ' + partial.status); }
  if (partial.headers.get('content-range') !== 'bytes 0-15/' + song.bytes) throw new Error('Unexpected Content-Range');
  const bytes = new Uint8Array(await partial.arrayBuffer());
  const id3 = bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51;
  const mp3Frame = bytes[0] === 255 && (bytes[1] & 224) === 224;
  if (bytes.length !== 16 || !id3 && !mp3Frame) throw new Error('MP3 signature missing');
  if (full) {
    const response = await fetch(song.url, { signal: AbortSignal.timeout(120000) });
    if (response.status !== 200 || !response.body) throw new Error('Full GET ' + response.status);
    const hash = createHash('sha256');
    let length = 0;
    for await (const chunk of response.body) { hash.update(chunk); length += chunk.length; }
    if (length !== song.bytes || hash.digest('hex') !== song.sha256) throw new Error('Full audio bytes differ from source SHA256');
  }
}

async function main() {
  const full = process.argv.includes('--full');
  let cursor = 0, verified = 0;
  const failures = [];
  await Promise.all(Array.from({ length: full ? 3 : 6 }, async () => {
    while (cursor < SONGS.length) {
      const song = SONGS[cursor++];
      try { await checkSong(song, { full }); verified++; }
      catch (error) { failures.push({ id: song.id, title: song.title, error: error.message }); }
    }
  }));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode: full ? 'full-sha256' : 'headers-and-range', sourceCommit: SOURCE.commit, verified, total: SONGS.length, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { checkSong };
