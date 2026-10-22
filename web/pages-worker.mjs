// One Pages project serves the portal and its registered modules.
// Native miniapp accounts use their own private GitHub repositories.
import { proxyAccount } from './account-proxy.mjs';
import { pronounceWord } from './lingotiles-audio.mjs';
export function createPagesWorker({ activeProjectIds = [], firstsightAssetPaths = [], version = 'unknown' } = {}) {
const active = new Set(activeProjectIds);
const firstsightAssets = new Set(firstsightAssetPaths);
return {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/account' || path.startsWith('/api/account/')) return proxyAccount(request, env);
    if (path === '/api/lingotiles/pronounce' && active.has('lingotiles')) return pronounceWord(request);
    if (path === '/api/health' && request.method === 'GET') {
      return Response.json({ ok: true, service: 'brclio-pocket', version, syncAvailable: false }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path.startsWith('/api/')) {
      return Response.json({ error: path.startsWith('/api/v1/') ? 'sync_unavailable' : 'not_found' }, { status: path.startsWith('/api/v1/') ? 503 : 404, headers: { 'Cache-Control': 'no-store' } });
    }
    if (path.startsWith('/projects/')) {
      const match = path.match(/^\/projects\/([a-z][a-z0-9-]{0,47})\//);
      if (!match || !active.has(match[1])) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      // The former replacement-photo directory is retired, including stale CDN assets.
      if (path.startsWith('/projects/firstsight/media/')) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      // ASSETS can retain a formerly published image after its source is removed.
      // Only this build's imported photos may reach that binding.
      let decodedPath;
      try { decodedPath = decodeURIComponent(path); } catch { return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
      if (decodedPath.startsWith('/projects/firstsight/assets/original/') && !firstsightAssets.has(path)) {
        return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
      }
    }
    return env.ASSETS.fetch(request);
  }
};
}

export default createPagesWorker({
  activeProjectIds: typeof __BRCLIO_ACTIVE_PROJECTS__ === 'undefined' ? [] : __BRCLIO_ACTIVE_PROJECTS__,
  firstsightAssetPaths: typeof __BRCLIO_FIRSTSIGHT_ASSETS__ === 'undefined' ? [] : __BRCLIO_FIRSTSIGHT_ASSETS__,
  version: typeof __BRCLIO_VERSION__ === 'undefined' ? 'unknown' : __BRCLIO_VERSION__
});
