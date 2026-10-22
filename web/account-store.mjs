// Server-only GitHub App storage. Account records and app data have separate,
// fixed repositories. No credentials or repository URLs enter client responses.
const API = 'https://api.github.com';
const OWNER = 'BrclioData';
const REPOSITORIES = Object.freeze({ users: 'Brclio-Miniapp-UserData', data: 'Brclio-Miniapp-Data' });
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TRANSACTION_DOCUMENTS = 100;
const MAX_TRANSACTION_BYTES = 4 * 1024 * 1024;
const tokenCache = new Map();
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MISSING = Symbol('missing');

export class AccountStoreError extends Error {
  constructor(status, safeCode) {
    super(safeCode);
    this.name = 'AccountStoreError';
    this.status = status;
    this.safeCode = safeCode;
  }
}

function fail(status, code) { throw new AccountStoreError(status, code); }

function validPath(path) {
  if (typeof path !== 'string' || path.length > 512 || !path.endsWith('.json') ||
      path.split('/').some(part => !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(part) || part.includes('..'))) {
    fail(400, 'store_path_invalid');
  }
  return path;
}

function validBranch(value) {
  const branch = value || 'main';
  if (typeof branch !== 'string' || branch.length > 200 || branch.endsWith('.') ||
      branch.endsWith('.lock') || branch.includes('..') || branch.includes('@{') ||
      branch.split('/').some(part => !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part) || part.endsWith('.lock'))) {
    fail(503, 'store_configuration_invalid');
  }
  return branch;
}

function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
function validSha(sha) {
  if (typeof sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(sha)) fail(503, 'store_response_invalid');
  return sha;
}
function bytesBase64(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}
function base64Bytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function base64url(bytes) { return bytesBase64(bytes).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function concat(...chunks) {
  const result = new Uint8Array(chunks.reduce((size, item) => size + item.length, 0));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function der(tag, value) {
  let length = value.length;
  const encodedLength = [];
  do { encodedLength.unshift(length & 255); length = Math.floor(length / 256); } while (length > 0);
  return concat(Uint8Array.of(tag), Uint8Array.from(value.length < 128 ? [value.length] : [128 | encodedLength.length, ...encodedLength]), value);
}
async function signingKey(privateKey) {
  try {
    const pem = privateKey.replace(/\\n/g, '\n').trim();
    const match = /^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s+([A-Za-z0-9+/=\s]+)\s+-----END \1-----$/.exec(pem);
    if (!match) fail(503, 'store_configuration_invalid');
    let bytes = base64Bytes(match[2].replace(/\s/g, ''));
    if (match[1] === 'RSA PRIVATE KEY') {
      // GitHub downloads PKCS#1 RSA keys. WebCrypto accepts PKCS#8, whose
      // PrivateKeyInfo wraps the unchanged PKCS#1 bytes with rsaEncryption.
      const rsaAlgorithm = Uint8Array.from([48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1, 5, 0]);
      bytes = der(48, concat(Uint8Array.of(2, 1, 0), rsaAlgorithm, der(4, bytes)));
    }
    return await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch { fail(503, 'store_configuration_invalid'); }
}
async function appJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))) + '.' +
    base64url(encoder.encode(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId })));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(privateKey), encoder.encode(unsigned));
  return unsigned + '.' + base64url(new Uint8Array(signature));
}

async function responseJson(response) {
  if (Number(response.headers.get('Content-Length')) > MAX_RESPONSE_BYTES) fail(503, 'store_response_invalid');
  const reader = response.body?.getReader();
  if (!reader) fail(503, 'store_response_invalid');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail(503, 'store_response_invalid');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(decoder.decode(bytes));
  } catch { fail(503, 'store_response_invalid'); }
  finally { reader.releaseLock(); }
}

function serialize(value) {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) fail(400, 'store_document_invalid');
    const content = json + '\n';
    if (encoder.encode(content).length > MAX_DOCUMENT_BYTES) fail(413, 'store_document_too_large');
    return content;
  } catch (error) {
    if (error instanceof AccountStoreError) throw error;
    fail(400, 'store_document_invalid');
  }
}

/**
 * Callbacks may run again after concurrent writes. Keep all effects inside tx.
 * tx.get() observes the pinned HEAD and earlier tx.put()/tx.delete() operations.
 * put/delete are synchronous; awaiting them is also safe. Paths are JSON files.
 */
export function createGitHubStore(env, { fetchImpl = fetch, repository = 'users' } = {}) {
  if (!Object.hasOwn(REPOSITORIES, repository)) fail(503, 'store_configuration_invalid');
  const repo = REPOSITORIES[repository];
  const prefix = '/repos/' + OWNER + '/' + repo;
  const branch = validBranch(env?.[repository === 'users' ? 'GITHUB_USERDATA_BRANCH' : 'GITHUB_DATA_BRANCH']);
  const refPath = 'heads/' + encodePath(branch);
  const appId = String(env?.GITHUB_APP_CLIENT_ID || env?.GITHUB_APP_ID || '');
  const privateKey = env?.GITHUB_APP_PRIVATE_KEY;
  const installationId = String(env?.GITHUB_APP_INSTALLATION_ID || '');
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(appId) || typeof privateKey !== 'string' || privateKey.length > 20000 || !privateKey ||
      (installationId && !/^[1-9][0-9]{0,19}$/.test(installationId))) fail(503, 'store_configuration_invalid');
  let cacheKeyPromise;
  const cacheKey = () => cacheKeyPromise ||= crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify([appId, privateKey, installationId, OWNER, repo])))
    .then(value => base64url(new Uint8Array(value)));

  async function rawRequest(path, bearer, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchImpl(API + path, {
        method, redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + bearer,
          'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'Brclio-Miniapp-Account',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { fail(503, 'store_upstream_unavailable'); }
    // Never parse or echo an upstream error body: it may contain credentials,
    // submitted user data or diagnostic details unsuitable for a client.
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* Discard diagnostics. */ }
      return { status: response.status, value: null };
    }
    return { status: response.status, value: await responseJson(response) };
  }

  async function mintToken() {
    const jwt = await appJwt(appId, privateKey);
    let id = installationId;
    if (!id) {
      const result = await rawRequest(prefix + '/installation', jwt);
      if (result.status !== 200 || !Number.isSafeInteger(result.value?.id) || result.value.id <= 0) fail(503, 'store_installation_unavailable');
      id = String(result.value.id);
    }
    const result = await rawRequest('/app/installations/' + id + '/access_tokens', jwt, {
      method: 'POST', body: { repositories: [repo], permissions: { contents: 'write' } }
    });
    const token = result.value?.token;
    const expires = Date.parse(result.value?.expires_at);
    if (result.status !== 201 || typeof token !== 'string' || !token || token.length > 16384 || /\s/.test(token) ||
        !Number.isFinite(expires) || expires < Date.now() + 60000) fail(503, 'store_installation_unavailable');
    const metadata = await rawRequest(prefix, token);
    if (metadata.status !== 200) fail(503, 'store_access_unavailable');
    if (metadata.value?.private !== true) fail(503, 'store_repository_not_private');
    return { token, expires };
  }
  async function token() {
    const key = await cacheKey();
    const current = tokenCache.get(key);
    if (current) {
      const value = await current;
      if (value.expires > Date.now() + 60000) return value.token;
      tokenCache.delete(key);
    }
    if (tokenCache.size >= 32) tokenCache.delete(tokenCache.keys().next().value);
    const pending = mintToken();
    tokenCache.set(key, pending);
    try { return (await pending).token; }
    catch (error) { if (tokenCache.get(key) === pending) tokenCache.delete(key); throw error; }
  }
  async function request(path, options, allowedStatuses = []) {
    let result = await rawRequest(path, await token(), options);
    if (result.status === 401) {
      tokenCache.delete(await cacheKey());
      result = await rawRequest(path, await token(), options);
    }
    if ((result.status < 200 || result.status >= 300) && !allowedStatuses.includes(result.status)) {
      fail(503, result.status === 403 || result.status === 404 ? 'store_access_unavailable' : 'store_upstream_unavailable');
    }
    return result;
  }

  async function snapshot() {
    const result = await request(prefix + '/git/ref/' + refPath, undefined, [404, 409]);
    if (result.status === 404 || result.status === 409) {
      // A missing branch must not be mistaken for a missing user document.
      const commits = await request(prefix + '/commits?per_page=1', undefined, [409]);
      if (commits.status === 409) return null;
      fail(503, 'store_branch_missing');
    }
    if (result.value?.object?.type !== 'commit') fail(503, 'store_response_invalid');
    return validSha(result.value.object.sha);
  }

  async function readAt(path, head) {
    if (!head) return MISSING;
    const result = await request(prefix + '/contents/' + encodePath(path) + '?ref=' + head, undefined, [404]);
    if (result.status === 404) return MISSING;
    const file = result.value;
    if (file?.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_DOCUMENT_BYTES ||
        file.content.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 + 30000) fail(503, 'store_document_invalid');
    try {
      const bytes = base64Bytes(file.content.replace(/\s/g, ''));
      if (bytes.length > MAX_DOCUMENT_BYTES) fail(503, 'store_document_invalid');
      return JSON.parse(decoder.decode(bytes));
    } catch { fail(503, 'store_document_invalid'); }
  }

  async function initialize() {
    const result = await request(prefix + '/contents/.brclio-store.json', {
      method: 'PUT', body: {
        message: 'Initialize Brclio account storage', branch,
        content: bytesBase64(encoder.encode(JSON.stringify({ schemaVersion: 1, repository }) + '\n'))
      }
    }, [409, 422]);
    if (![200, 201, 409, 422].includes(result.status)) fail(503, 'store_upstream_unavailable');
  }

  return Object.freeze({
    async read(path) {
      validPath(path);
      const value = await readAt(path, await snapshot());
      return value === MISSING ? null : value;
    },
    async transaction(callback) {
      if (typeof callback !== 'function') fail(400, 'store_transaction_invalid');
      let initialized = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const head = await snapshot();
        const staged = new Map();
        const reads = new Map();
        let active = true;
        const checkActive = () => { if (!active) fail(400, 'store_transaction_closed'); };
        const tx = Object.freeze({
          async get(path) {
            checkActive(); validPath(path);
            if (staged.has(path)) return staged.get(path) === null ? null : JSON.parse(staged.get(path));
            if (!reads.has(path)) reads.set(path, readAt(path, head));
            const value = await reads.get(path);
            return value === MISSING ? null : structuredClone(value);
          },
          put(path, value) { checkActive(); validPath(path); staged.set(path, serialize(value)); },
          delete(path) { checkActive(); validPath(path); staged.set(path, null); }
        });
        let result;
        try { result = await callback(tx); } finally { active = false; }
        if (!staged.size) return result;
        if (staged.size > MAX_TRANSACTION_DOCUMENTS || [...staged.values()].reduce((size, value) => size + (value ? encoder.encode(value).length : 0), 0) > MAX_TRANSACTION_BYTES) {
          fail(413, 'store_transaction_too_large');
        }
        // Recheck at each write boundary even when the installation token is
        // cached: a visibility change must not accept another private record.
        const metadata = await request(prefix);
        if (metadata.value?.private !== true) fail(503, 'store_repository_not_private');
        if (!head) {
          // GitHub cannot create branch refs in an entirely empty repository.
          // Seed metadata through Contents, then replay the account transaction.
          if (initialized) fail(503, 'store_initialization_failed');
          await initialize();
          initialized = true;
          attempt -= 1;
          continue;
        }
        const entries = [];
        for (const [path, content] of staged) {
          if (content === null) {
            if (!reads.has(path)) reads.set(path, readAt(path, head));
            if (await reads.get(path) !== MISSING) entries.push({ path, mode: '100644', type: 'blob', sha: null });
          } else entries.push({ path, mode: '100644', type: 'blob', content });
        }
        if (!entries.length) return result;
        const base = await request(prefix + '/git/commits/' + head);
        const baseTree = validSha(base.value?.tree?.sha);
        const tree = await request(prefix + '/git/trees', { method: 'POST', body: { base_tree: baseTree, tree: entries } });
        const treeSha = validSha(tree.value?.sha);
        const commit = await request(prefix + '/git/commits', {
          method: 'POST', body: { message: 'Update Brclio account records', tree: treeSha, parents: [head] }
        });
        const commitSha = validSha(commit.value?.sha);
        const update = await request(prefix + '/git/refs/' + refPath, {
          method: 'PATCH', body: { sha: commitSha, force: false }
        }, [409, 422]);
        if (update.status === 200) return result;
        // The new commit only descends from our pinned HEAD. A non-fast-forward
        // response means the entire callback must re-read and revalidate.
      }
      fail(409, 'store_conflict');
    }
  });
}
