// One Pages project serves the portal and its registered modules.
// This version is read-only; legacy record storage remains disabled.
export function createPagesWorker({ activeProjectIds = [], version = 'unknown' } = {}) {
const active = new Set(activeProjectIds);
return {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'brclio-pocket', version, syncAvailable: false }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path.startsWith('/api/')) {
      return Response.json({ error: path.startsWith('/api/v1/') ? 'sync_unavailable' : 'not_found' }, { status: path.startsWith('/api/v1/') ? 503 : 404, headers: { 'Cache-Control': 'no-store' } });
    }
    if (path.startsWith('/projects/')) {
      const match = path.match(/^\/projects\/([a-z][a-z0-9-]{0,47})\//);
      if (!match || !active.has(match[1])) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    return env.ASSETS.fetch(request);
  }
};
}

export default createPagesWorker({
  activeProjectIds: typeof __BRCLIO_ACTIVE_PROJECTS__ === 'undefined' ? [] : __BRCLIO_ACTIVE_PROJECTS__,
  version: typeof __BRCLIO_VERSION__ === 'undefined' ? 'unknown' : __BRCLIO_VERSION__
});
