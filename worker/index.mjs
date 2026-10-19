const MAX_BODY_BYTES = 8192;
const MAX_MATCHES = 20;
const WRITE_INTERVAL_MS = 10000;
const TOKEN_PATTERN = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...extraHeaders
    }
  });
}

function bytesToBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function base64ToBytes(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
function base64url(bytes) { return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromBase64url(value) { return base64ToBytes(value.replace(/-/g, '+').replace(/_/g, '/') + '='); }

function syncConfigured(env) {
  return env.SYNC_ENABLED === 'true' && typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.length > 0 &&
    typeof env.DATA_HMAC_KEY === 'string' && env.DATA_HMAC_KEY.length >= 32 &&
    /^[A-Za-z0-9_.-]+$/.test(env.GITHUB_OWNER || '') && /^[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO || '') &&
    !!allowedOrigins(env) && !!env.API_RATE_LIMITER?.limit &&
    !!env.SESSION_RATE_LIMITER?.limit && !!env.WRITE_RATE_LIMITER?.limit;
}

function allowedOrigins(env) {
  if (!env.PUBLIC_ORIGIN) return null;
  const values = [env.PUBLIC_ORIGIN, env.EXTRA_ALLOWED_ORIGIN].filter(Boolean);
  try {
    for (const value of values) {
      const parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.origin !== value) return null;
    }
    return new Set(values);
  } catch { return null; }
}

function approvedOrigin(request, env) {
  const configured = allowedOrigins(env);
  if (!configured) throw new ApiError(503, 'sync_unavailable');
  const origin = request.headers.get('Origin');
  const referer = request.headers.get('Referer');
  let sourceOrigin = origin;
  if (!sourceOrigin && referer) {
    try { sourceOrigin = new URL(referer).origin; } catch { /* Invalid referrers fail below. */ }
  }
  if (!sourceOrigin && !origin && !referer) return null;
  if (!configured.has(sourceOrigin)) throw new ApiError(403, 'origin_not_allowed');
  return sourceOrigin;
}

function withCors(response, origin) {
  response.headers.set('Vary', 'Origin');
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
}

function preflight(request, origin) {
  if (!origin) throw new ApiError(403, 'origin_not_allowed');
  if (!['GET', 'POST', 'DELETE', 'OPTIONS'].includes(request.headers.get('Access-Control-Request-Method') || '')) {
    throw new ApiError(403, 'preflight_not_allowed');
  }
  const requestedHeaders = (request.headers.get('Access-Control-Request-Headers') || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (requestedHeaders.some((header) => !['authorization', 'content-type'].includes(header))) throw new ApiError(403, 'preflight_not_allowed');
  return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600'
  } });
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) {
    throw new ApiError(415, 'json_required');
  }
  if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_json');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, 'body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const result = JSON.parse(decoder.decode(bytes));
    if (!result || Array.isArray(result) || typeof result !== 'object') throw new Error();
    return result;
  } catch { throw new ApiError(400, 'invalid_json'); }
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', encoder.encode(env.DATA_HMAC_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(key, value) {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function devicePath(request, key) {
  const authorization = request.headers.get('Authorization') || '';
  const match = /^Bearer (.+)$/.exec(authorization);
  const token = match && TOKEN_PATTERN.exec(match[1]);
  if (!token) throw new ApiError(401, 'invalid_session');
  let valid = false;
  try { valid = await crypto.subtle.verify('HMAC', key, fromBase64url(token[2]), encoder.encode(`session:v1:${token[1]}`)); } catch { /* Invalid signatures fail closed. */ }
  if (!valid) throw new ApiError(401, 'invalid_session');
  const digest = await sign(key, `history:v1:${token[1]}`);
  const filename = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `pocket/v1/devices/${filename}.json`;
}

function validateMatches(matches, now) {
  if (!Array.isArray(matches) || matches.length > MAX_MATCHES) throw new ApiError(400, 'invalid_matches');
  const seen = new Set();
  return matches.map((match) => {
    if (!match || typeof match !== 'object' || Array.isArray(match) ||
      typeof match.id !== 'string' || !/^[A-Za-z0-9._:-]{1,80}$/.test(match.id) || seen.has(match.id) ||
      !Number.isSafeInteger(match.at) || match.at < 1577836800000 || match.at > now + 300000 ||
      ![0, 1].includes(match.winner) || !Array.isArray(match.scores) || match.scores.length !== 2 ||
      !match.scores.every((score) => Number.isInteger(score) && score >= 0 && score <= 5) ||
      ![1, 3, 5].includes(match.scores[match.winner]) || match.scores[1 - match.winner] >= match.scores[match.winner] ||
      !(match.bestMs === null || Number.isFinite(match.bestMs) && match.bestMs >= 0 && match.bestMs <= 5000) ||
      !Array.isArray(match.names) || match.names.length !== 2 ||
      !match.names.every((name) => typeof name === 'string' && name.trim().length > 0 && name.length <= 16 && !/[\u0000-\u001f\u007f]/.test(name))) {
      throw new ApiError(400, 'invalid_matches');
    }
    seen.add(match.id);
    // Keep a fixed schema: never copy client-supplied paths or unrelated private data.
    return { id: match.id, at: match.at, names: match.names.map((name) => name.trim()), winner: match.winner,
      scores: match.scores.slice(), bestMs: match.bestMs };
  });
}

function githubUrl(env, path) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/${path}`;
}

async function github(fetcher, env, path, method, body) {
  const url = new URL(githubUrl(env, path));
  if (method === 'GET') url.searchParams.set('ref', env.GITHUB_BRANCH || 'main');
  return fetcher(url.toString(), {
    method,
    headers: { 'Authorization': `Bearer ${env.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Brclio-Pocket-Worker', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    // Workers supports only follow/manual. Never forward the repository bearer
    // to a redirect target; callers reject every non-2xx response below.
    redirect: 'manual', signal: AbortSignal.timeout(10000)
  });
}

async function loadHistory(fetcher, env, path, now) {
  const response = await github(fetcher, env, path, 'GET');
  if (response.status === 404) return { matches: [], updatedAt: null, sha: null };
  if (!response.ok) throw new ApiError(503, 'storage_unavailable');
  try {
    const file = await response.json();
    if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 32768 ||
      !/^[a-f0-9]{40}$/.test(file.sha)) throw new Error();
    const record = JSON.parse(decoder.decode(base64ToBytes(file.content.replace(/\s/g, ''))));
    if (record.version !== 1 || !Number.isSafeInteger(record.updatedAt) || record.updatedAt > now + 300000 || record.updatedAt < 1577836800000) throw new Error();
    return { matches: validateMatches(record.matches, now), updatedAt: record.updatedAt, sha: file.sha };
  } catch { throw new ApiError(503, 'storage_unavailable'); }
}

async function saveHistory(fetcher, env, path, matches, now) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadHistory(fetcher, env, path, now);
    // Existing IDs are immutable; retries cannot rewrite a previously saved result.
    const byId = new Map(matches.map((match) => [match.id, match]));
    for (const match of stored.matches) byId.set(match.id, match);
    const merged = Array.from(byId.values()).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)).slice(0, MAX_MATCHES);
    if (JSON.stringify(merged) === JSON.stringify(stored.matches)) return { matches: merged, updatedAt: stored.updatedAt };
    if (stored.updatedAt && now - stored.updatedAt < WRITE_INTERVAL_MS) throw new ApiError(429, 'write_too_frequent');
    const record = { version: 1, updatedAt: now, matches: merged };
    const body = { message: 'Update pocket device history', branch: env.GITHUB_BRANCH || 'main',
      content: bytesToBase64(encoder.encode(JSON.stringify(record))), ...(stored.sha ? { sha: stored.sha } : {}) };
    const response = await github(fetcher, env, path, 'PUT', body);
    if (response.ok) return { matches: merged, updatedAt: now };
    if (response.status !== 409 && response.status !== 422) throw new ApiError(503, 'storage_unavailable');
  }
  throw new ApiError(409, 'sync_conflict');
}

async function deleteHistory(fetcher, env, path, now) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await loadHistory(fetcher, env, path, now);
    if (!stored.sha) return { deleted: true };
    const response = await github(fetcher, env, path, 'DELETE', {
      message: 'Delete pocket device history', branch: env.GITHUB_BRANCH || 'main', sha: stored.sha
    });
    if (response.ok || response.status === 404) return { deleted: true };
    if (response.status !== 409 && response.status !== 422) throw new ApiError(503, 'storage_unavailable');
  }
  throw new ApiError(409, 'sync_conflict');
}

export function createWorker({ fetcher = (...args) => fetch(...args), now = Date.now } = {}) {
  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (!pathname.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
      let origin = null;
      const respond = (response) => withCors(response, origin);
      try {
        origin = approvedOrigin(request, env);
        if (request.method === 'OPTIONS') return respond(preflight(request, origin));
        if (pathname === '/api/health' && request.method === 'GET') return respond(json({ ok: true, service: 'brclio-pocket', syncAvailable: syncConfigured(env) }));
        const sessionRoute = pathname === '/api/v1/session' && request.method === 'POST';
        const historyRoute = pathname === '/api/v1/history' && ['GET', 'POST', 'DELETE'].includes(request.method);
        if (!sessionRoute && !historyRoute) return respond(json({ error: 'not_found' }, 404));
        if (!syncConfigured(env)) throw new ApiError(503, 'sync_unavailable');
        if (!origin) throw new ApiError(403, 'origin_not_allowed');
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const key = await hmacKey(env);
        // Raw IP addresses are never persisted, returned, or used as GitHub filenames.
        const rateKey = base64url(await sign(key, `rate:v1:${ip}`));
        if (!(await env.API_RATE_LIMITER.limit({ key: rateKey })).success) throw new ApiError(429, 'rate_limited');
        if (sessionRoute) {
          if (!(await env.SESSION_RATE_LIMITER.limit({ key: rateKey })).success) throw new ApiError(429, 'rate_limited');
          const body = await readJson(request);
          if (Object.keys(body).length) throw new ApiError(400, 'invalid_session_request');
          const id = base64url(crypto.getRandomValues(new Uint8Array(32)));
          const token = `v1.${id}.${base64url(await sign(key, `session:v1:${id}`))}`;
          return respond(json({ token, historyLimit: MAX_MATCHES }, 201));
        }
        const path = await devicePath(request, key);
        const time = now();
        if (request.method === 'GET') {
          const stored = await loadHistory(fetcher, env, path, time);
          return respond(json({ matches: stored.matches, updatedAt: stored.updatedAt }));
        }
        if (request.method === 'DELETE') {
          if (!(await env.WRITE_RATE_LIMITER.limit({ key: 'pocket-history-writes-v1' })).success) throw new ApiError(429, 'rate_limited');
          return respond(json(await deleteHistory(fetcher, env, path, time)));
        }
        const body = await readJson(request);
        if (Object.keys(body).some((field) => field !== 'matches')) throw new ApiError(400, 'invalid_matches');
        const matches = validateMatches(body.matches, time);
        // Shared write budget limits anonymous session churn, independent of token/IP.
        if (!(await env.WRITE_RATE_LIMITER.limit({ key: 'pocket-history-writes-v1' })).success) throw new ApiError(429, 'rate_limited');
        return respond(json(await saveHistory(fetcher, env, path, matches, time)));
      } catch (error) {
        const known = error instanceof ApiError;
        const status = known ? error.status : 503;
        return respond(json({ error: known ? error.code : 'service_unavailable' }, status,
          status === 429 ? { 'Retry-After': '60' } : {}));
      }
    }
  };
}

export default createWorker();
