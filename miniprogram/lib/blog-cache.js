(function expose(root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BrclioBlogCache = factory();
})(typeof window !== 'undefined' ? window : this, function factory() {
  'use strict';
  const DAY = 86400000;
  const POST = /^\/posts\/([A-Za-z0-9_-]{1,80})$/;
  const ACTION = /^\/posts\/([A-Za-z0-9_-]{1,80})\/(view|like|favorite)$/;
  const ADMIN = /^\/admin\/posts(?:\/[A-Za-z0-9_-]{1,80})?$/;
  function copy(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
  function byteLength(value) {
    let size = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code < 128) size += 1;
      else if (code < 2048) size += 2;
      else if (code >= 55296 && code <= 56319 && index + 1 < value.length && value.charCodeAt(index + 1) >= 56320 && value.charCodeAt(index + 1) <= 57343) { size += 4; index += 1; }
      else size += 3;
    }
    return size;
  }
  function location(path) {
    if (typeof path !== 'string') return { route: '', key: '', query: '' };
    const separator = path.indexOf('?'), route = separator < 0 ? path : path.slice(0, separator), query = separator < 0 ? '' : path.slice(separator + 1);
    try {
      // Keep duplicate keys in their original order: the API reads the first
      // value, so sorting duplicate values could merge different requests.
      const pairs = query.split('&').filter(Boolean).map((pair, index) => {
        const equal = pair.indexOf('='), decode = value => decodeURIComponent(value.replace(/\+/g, ' '));
        return { key: decode(equal < 0 ? pair : pair.slice(0, equal)), value: decode(equal < 0 ? '' : pair.slice(equal + 1)), index };
      });
      pairs.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index);
      const normalized = pairs.map(pair => encodeURIComponent(pair.key) + '=' + encodeURIComponent(pair.value)).join('&');
      return { route, key: route + (normalized ? '?' + normalized : ''), query: normalized };
    } catch (_) { return { route, key: path, query }; }
  }
  function readable(route) { return route === '/me' || route === '/posts' || route === '/admin/posts' || POST.test(route); }
  function list(route) { return route === '/posts' || route === '/admin/posts'; }
  function canceled() { const error = new Error('账号已变化，请重试。'); error.code = 'operation_canceled'; error.canceled = true; return error; }
  function createBlogCache(settings) {
    if (!settings || typeof settings.request !== 'function') throw new TypeError('A blog request function is required');
    const transport = settings.request, now = settings.now || Date.now;
    const ttl = Number.isFinite(settings.ttlMs) && settings.ttlMs >= 0 ? settings.ttlMs : 5 * 60 * 1000;
    const capacity = Number.isInteger(settings.maxEntries) && settings.maxEntries >= 0 ? settings.maxEntries : 60;
    const budget = Number.isFinite(settings.maxBytes) && settings.maxBytes >= 0 ? settings.maxBytes : 3 * 1024 * 1024;
    const entries = new Map(), reads = new Map(), views = new Map();
    let bytes = 0, epoch = 0, identityEpoch = 0;
    const getIdentity = () => typeof settings.getIdentity === 'function' ? String(settings.getIdentity() || '') : '';
    let identity = getIdentity();
    function remove(key) { const entry = entries.get(key); if (entry) { bytes -= entry.bytes; entries.delete(key); } }
    function clear() {
      entries.clear(); bytes = 0;
      reads.forEach(token => { token.active = false; }); reads.clear(); views.clear(); epoch += 1;
    }
    function syncIdentity() { const next = getIdentity(); if (next !== identity) { identity = next; identityEpoch += 1; clear(); } return identity; }
    function assertIdentity(expected) { syncIdentity(); if (identity !== expected.identity || identityEpoch !== expected.epoch) throw canceled(); }
    function reset() { const next = getIdentity(); if (next !== identity) identityEpoch += 1; identity = next; clear(); }
    function trim() { while (entries.size > capacity || bytes > budget) remove(entries.keys().next().value); }
    function save(key, value, at) {
      let json;
      try { json = JSON.stringify(value); } catch (_) { return; }
      if (json === undefined) return;
      const size = byteLength(json);
      remove(key);
      if (!capacity || !ttl || size > budget) return;
      entries.set(key, { json, bytes: size, at: at === undefined ? now() : at }); bytes += size; trim();
    }
    function cached(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.at >= ttl || now() < entry.at) { remove(key); return undefined; }
      entries.delete(key); entries.set(key, entry);
      return JSON.parse(entry.json);
    }
    function invalidate(predicate, keepEntries) {
      reads.forEach((token, key) => { if (predicate(location(key))) { token.active = false; reads.delete(key); } });
      if (!keepEntries) entries.forEach((entry, key) => { if (predicate(location(key))) remove(key); });
    }
    function related(id, address) { return list(address.route) || address.route === '/posts/' + id; }
    function invalidateWrite(address) {
      if (ADMIN.test(address.route)) { invalidate(item => item.route !== '/me'); return; }
      const action = ACTION.exec(address.route);
      if (!action) return;
      const id = action[1];
      invalidate(item => related(id, item));
    }
    function metrics(id, kind, result) {
      // Reads already in flight may contain pre-mutation counters. Never allow
      // them to replace these updated snapshots after their reply arrives.
      invalidate(item => related(id, item), true);
      if (kind === 'favorite') invalidate(item => list(item.route) && /(?:^|&)saved=1(?:&|$)/.test(item.query));
      const changes = [];
      entries.forEach((entry, key) => {
        const address = location(key);
        if (!related(id, address)) return;
        if (now() - entry.at >= ttl || now() < entry.at) { remove(key); return; }
        const value = JSON.parse(entry.json);
        function patch(post) {
          if (!post || post.id !== id || !result.counts) return;
          const counts = post.counts || {};
          // Only the operation's own counter may decrease. Other counters can
          // have newer values from another in-flight operation (especially view).
          const field = { like: 'likes', favorite: 'favorites' }[kind];
          if (field && Number.isFinite(result.counts[field])) counts[field] = result.counts[field];
          if (Number.isFinite(result.counts.views)) counts.views = Math.max(counts.views || 0, result.counts.views);
          post.counts = counts;
        }
        if (list(address.route)) (value.posts || []).forEach(patch);
        else {
          patch(value.post);
          if (result.interaction && (kind === 'like' || kind === 'favorite')) {
            const field = kind === 'like' ? 'liked' : 'favorited';
            value.interaction = Object.assign({}, value.interaction || {}, { [field]: !!result.interaction[field] });
          }
        }
        changes.push({ key, value, at: entry.at });
      });
      changes.forEach(change => save(change.key, change.value, change.at));
    }
    function succeeded(address, result) {
      if (ADMIN.test(address.route)) { invalidate(item => item.route !== '/me'); return; }
      const action = ACTION.exec(address.route);
      if (action) metrics(action[1], action[2], result || {});
    }
    async function deliver(promise, expected) {
      try { const result = await promise; assertIdentity(expected); return copy(result); }
      catch (error) { assertIdentity(expected); throw error; }
    }
    function read(path, address, fresh, expected) {
      if (!fresh) {
        const value = cached(address.key);
        if (value !== undefined) return deliver(Promise.resolve(value), expected);
        const pending = reads.get(address.key);
        if (pending) return deliver(pending.promise, expected);
      } else invalidate(item => item.key === address.key);
      const token = { active: true, epoch, promise: null };
      reads.set(address.key, token);
      token.promise = (async () => {
        try {
          const result = await transport(path, 'GET'); assertIdentity(expected);
          if (token.active && token.epoch === epoch) save(address.key, result);
          return result;
        } finally { if (reads.get(address.key) === token) reads.delete(address.key); }
      })();
      return deliver(token.promise, expected);
    }
    function write(path, method, data, address, expected) {
      const currentEpoch = epoch;
      return (async () => {
        try {
          const result = await transport(path, method, data); assertIdentity(expected);
          if (currentEpoch === epoch) succeeded(address, result); else invalidateWrite(address);
          return result;
        } catch (error) {
          assertIdentity(expected);
          // A lost response does not prove that the server rejected the write.
          // Re-read affected records next time instead of preserving false state.
          invalidateWrite(address); throw error;
        }
      })();
    }
    function recordView(path, method, data, address, expected) {
      const day = Math.floor(now() / DAY), key = day + ':' + address.route, existing = views.get(key);
      views.forEach((value, entryKey) => { if (value.day !== day) views.delete(entryKey); });
      if (existing) {
        views.delete(key); views.set(key, existing);
        return deliver(existing.promise, expected);
      }
      const token = { day, epoch, promise: null };
      views.set(key, token);
      token.promise = write(path, method, data, address, expected).then(result => {
        if (token.epoch !== epoch && views.get(key) === token) views.delete(key);
        return result;
      }, error => { if (views.get(key) === token) views.delete(key); throw error; });
      while (views.size > Math.max(1, capacity)) views.delete(views.keys().next().value);
      return deliver(token.promise, expected);
    }
    function request(path, method = 'GET', data, options = {}) {
      const expected = { identity: syncIdentity(), epoch: identityEpoch }, address = location(path);
      if (method === 'GET' && data === undefined && readable(address.route)) return read(path, address, !!options.fresh, expected);
      if (method === 'POST' && /^\/posts\/[A-Za-z0-9_-]{1,80}\/view$/.test(address.route)) return recordView(path, method, data, address, expected);
      return deliver(method === 'GET' ? Promise.resolve().then(() => transport(path, method, data)) : write(path, method, data, address, expected), expected);
    }
    function peek(path) { syncIdentity(); const address = location(path); return readable(address.route) ? cached(address.key) : undefined; }
    // Revision describes visit/account lifetime only. Writes repair or expire
    // relevant entries in place, allowing readers to preserve their pagination.
    return { request, peek, reset, revision() { syncIdentity(); return epoch; } };
  }
  return { createBlogCache };
});
