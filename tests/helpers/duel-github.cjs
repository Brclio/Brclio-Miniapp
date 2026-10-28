'use strict';
const { generateKeyPairSync, createHash } = require('node:crypto');
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'pem', type: 'pkcs8' });
let sequence = 4000;
const sha = value => createHash('sha1').update(String(value)).digest('hex');
function duelGitHubFixture(initial = {}) {
  const calls = [], versions = new Map(), trees = new Map();
  let serial = 0, head = sha('duel-fixture-' + sequence++);
  versions.set(head, structuredClone(initial));
  let failure = false;
  async function github(request) {
    const url = new URL(request.url), method = request.method, body = ['POST', 'PATCH', 'PUT'].includes(method) ? await request.json() : null;
    const path = url.pathname;
    calls.push({ path, method });
    if (failure) return Response.json({ message: 'private upstream diagnostics' }, { status: 503 });
    const reply = (data, status = 200) => Response.json(data, { status });
    if (path === '/repos/BrclioData/Brclio-Miniapp-Data') return reply({ private: true });
    if (path.endsWith('/installation')) return reply({ id: 7 });
    if (path === '/app/installations/7/access_tokens') return reply({ token: 'fixture-installation-token', expires_at: new Date(Date.now() + 3600000).toISOString() }, 201);
    if (path.includes('/git/ref/heads/')) return reply({ object: { type: 'commit', sha: head } });
    if (path.includes('/contents/')) {
      const file = decodeURIComponent(path.split('/contents/')[1]), files = versions.get(url.searchParams.get('ref'));
      if (!files || !Object.hasOwn(files, file)) return reply({}, 404);
      const bytes = Buffer.from(JSON.stringify(files[file]));
      return reply({ type: 'file', encoding: 'base64', size: bytes.length, content: bytes.toString('base64') });
    }
    if (path.includes('/git/commits/') && method === 'GET') return reply({ tree: { sha: sha('tree-' + path.split('/').at(-1)) } });
    if (path.endsWith('/git/trees')) {
      const parent = [...versions.keys()].find(id => sha('tree-' + id) === body.base_tree);
      const files = structuredClone(versions.get(parent));
      for (const entry of body.tree) { if (entry.sha === null) delete files[entry.path]; else files[entry.path] = JSON.parse(entry.content); }
      const id = sha('tree-created-' + ++serial); trees.set(id, files); return reply({ sha: id }, 201);
    }
    if (path.endsWith('/git/commits') && method === 'POST') {
      const id = sha('commit-created-' + ++serial); versions.set(id, structuredClone(trees.get(body.tree))); return reply({ sha: id }, 201);
    }
    if (path.includes('/git/refs/heads/') && method === 'PATCH') { head = body.sha; return reply({ object: { sha: head } }); }
    throw Error('Unexpected private test GitHub API route: ' + method + ' ' + path);
  }
  return { calls, bindings: { GITHUB_APP_ID: String(sequence++), GITHUB_APP_PRIVATE_KEY: pem, GITHUB_APP_INSTALLATION_ID: '7', GITHUB_DATA_BRANCH: 'main' },
    serviceBindings: { GITHUB_API: github }, fetchImpl: (input, init) => github(new Request(input, init)),
    get files() { return versions.get(head); }, fail(value) { failure = value; } };
}
module.exports = { duelGitHubFixture };
