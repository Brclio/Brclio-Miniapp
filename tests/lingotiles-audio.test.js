'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../web/lingotiles-audio.mjs');

test('pronunciation forwards only a spelling to the fixed dictionary without user headers', async () => {
  const { pronounceWord } = await loaded;
  let call;
  const result = await pronounceWord(new Request('https://pocket.example/api/lingotiles/pronounce?word=apple&url=https://evil.example', { headers: { Cookie: 'account=private', Authorization: 'private' } }), async (url, options) => {
    call = { url: new URL(url), options };
    return new Response(new Uint8Array(128), { headers: { 'Content-Type': 'audio/mpeg' } });
  });
  assert.equal(result.status, 200);
  assert.equal(call.url.origin, 'https://dict.youdao.com');
  assert.equal(call.url.pathname, '/dictvoice');
  assert.deepEqual([...call.url.searchParams], [['audio', 'apple'], ['type', '1']]);
  assert.deepEqual(call.options.headers, { Accept: 'audio/mpeg', 'User-Agent': 'Brclio-LingoTiles/1.0', Referer: 'https://dict.youdao.com/' });
  assert.equal(call.options.redirect, 'manual');
  assert.equal((await result.arrayBuffer()).byteLength, 128);
});

test('invalid words, methods, upstream errors and non-audio fail explicitly', async () => {
  const { pronounceWord } = await loaded;
  for (const word of ['', 'https://evil.example', '苹果', 'a'.repeat(121)]) {
    const response = await pronounceWord(new Request('https://pocket.example/?word=' + encodeURIComponent(word)), () => { throw new Error('must not fetch'); });
    assert.equal(response.status, 400);
  }
  assert.equal((await pronounceWord(new Request('https://pocket.example/?word=apple', { method: 'POST' }))).status, 405);
  for (const upstream of [new Response(null, { status: 302, headers: { Location: 'https://elsewhere.example/voice.mp3' } }), new Response('failed', { status: 503 }), new Response('<html>not audio</html>', { headers: { 'Content-Type': 'text/html' } }), new Response(new Uint8Array(2), { headers: { 'Content-Type': 'audio/mpeg' } })]) {
    assert.equal((await pronounceWord(new Request('https://pocket.example/?word=apple'), async () => upstream)).status, 502);
  }
});
