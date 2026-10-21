// Fixed account gateway. Brclio · CC BY-NC-SA 4.0.
const CENTRAL = 'https://tools.brclio.com';
const ORIGINS = new Set(['https://pocket.bornforthis.cn', 'https://pocket.brclio.com']);
const ROUTES = {
  session: ['GET'], code: ['POST'], register: ['POST'], login: ['POST'], logout: ['POST'],
  profile: ['PUT'], password: ['POST'], 'apps/miniapp/data': ['GET', 'PUT']
};
const MAX_BYTES = 128 * 1024;
function json(error, status) { return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } }); }
async function bounded(body) {
  if (!body) return new Uint8Array();
  const reader = body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > MAX_BYTES) throw new Error('oversize'); chunks.push(next.value); }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
export async function proxyAccount(request, fetcher = fetch) {
  const url = new URL(request.url), route = url.pathname.slice('/api/account/'.length);
  if (!Object.hasOwn(ROUTES, route) || url.search || !ROUTES[route].includes(request.method)) return json('账号接口不存在或方法无效', 404);
  const origin = request.headers.get('Origin');
  if (origin && (!ORIGINS.has(origin) || origin !== url.origin)) return json('请求来源无效', 403);
  // This gateway accepts native bearer sessions only. It never forwards cookies.
  if (request.headers.get('X-Brclio-Client') !== 'native') return json('请使用小程序账号入口', 403);
  const headers = { Accept: 'application/json', 'X-Brclio-Client': 'native' };
  const authorization = request.headers.get('Authorization');
  if (authorization) {
    if (!/^Bearer [\x21-\x7e]{16,4096}$/.test(authorization)) return json('会话无效', 401);
    headers.Authorization = authorization;
  }
  let body;
  if (request.method !== 'GET') {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json('需要 JSON 请求', 415);
    try { body = await bounded(request.body); JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
    catch { return json('账号请求无效或过大', 400); }
    headers['Content-Type'] = 'application/json';
  }
  try {
    const response = await fetcher(CENTRAL + url.pathname, { method: request.method, headers, body,
      redirect: 'manual', signal: AbortSignal.timeout(30000) });
    if (response.status >= 300 && response.status < 400 || !response.headers.get('Content-Type')?.includes('application/json')) {
      await response.body?.cancel(); return json('账号服务暂不可用', 502);
    }
    const bytes = await bounded(response.body);
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return new Response(bytes, { status: response.status, headers: {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', ...(response.headers.has('Retry-After') ? { 'Retry-After': response.headers.get('Retry-After') } : {})
    } });
  } catch { return json('账号服务暂不可用，请稍后重试', 502); }
}
