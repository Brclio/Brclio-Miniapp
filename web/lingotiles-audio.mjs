// Native WeChat has no browser speechSynthesis. Proxy only the selected spelling
// to one fixed dictionary endpoint; no account headers or arbitrary URLs forward.
export async function pronounceWord(request, fetcher = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET, HEAD' } });
  const query = new URL(request.url).searchParams;
  const word = (query.get('word') || '').trim();
  if (!word || word.length > 120 || !/^[a-zA-Z][a-zA-Z .,'’()&/+_-]*$/.test(word)) return Response.json({ error: 'invalid_word' }, { status: 400 });
  const url = new URL('https://dict.youdao.com/dictvoice');
  url.searchParams.set('audio', word);
  url.searchParams.set('type', '1');
  let reason = 'network';
  try {
    const response = await fetcher(url.href, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Accept: 'audio/mpeg', 'User-Agent': 'Brclio-LingoTiles/1.0', Referer: 'https://dict.youdao.com/' } });
    const type = (response.headers.get('Content-Type') || '').toLowerCase();
    reason = !response.ok ? 'upstream_' + response.status : 'upstream_content_type';
    if (!response.ok || !/^(audio\/|application\/octet-stream)/.test(type)) throw new Error('Audio unavailable');
    const audio = await response.arrayBuffer();
    reason = 'upstream_audio_length';
    if (audio.byteLength < 32 || audio.byteLength > 512 * 1024) throw new Error('Unexpected audio length');
    return new Response(request.method === 'HEAD' ? null : audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=86400', 'Content-Length': String(audio.byteLength), 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return Response.json({ error: 'pronunciation_unavailable', reason }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
