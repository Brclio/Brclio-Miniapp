'use strict';

// Freeze legacy guest IndexedDB identities before the first account claim.
// No record bodies, credentials, or cloud data are read here.
const HISTORY_DB = 'lingotiles.history.v1';
const SNAPSHOT_KEY = 'brclio.lingotiles.web-history-claim.v1';
function validId(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value); }
function validSnapshot(value) {
  return value && value.version === 1 && (value.owner === null || typeof value.owner === 'string') && Array.isArray(value.ids) && value.ids.every(validId) && typeof value.complete === 'boolean';
}
function createHistorySnapshot(options) {
  const host = options.window, storage = options.storage;
  const owner = options.getGuestOwner || (() => null), principal = options.getPrincipal || (() => null);
  const schedule = options.setTimeout || host.setTimeout.bind(host), cancel = options.clearTimeout || host.clearTimeout.bind(host);
  const timeoutMs = Math.min(900, Math.max(1, Number(options.timeoutMs) || 900));
  let pending;
  function snapshot() {
    if (pending) return pending;
    pending = new Promise(resolve => {
      let initial, database, completed = false, timer;
      const finish = result => {
        if (completed) return;
        completed = true;
        if (timer !== undefined) cancel(timer);
        if (database) { try { database.close(); } catch (_) {} }
        resolve(result);
      };
      function save(ids) {
        if (completed) return;
        try {
          if (owner() || principal() !== initial) { finish(false); return; }
          // An intervening module snapshot is authoritative; never replace it.
          const existing = storage.getItem(SNAPSHOT_KEY);
          if (existing !== null) { finish(validSnapshot(JSON.parse(existing))); return; }
          storage.setItem(SNAPSHOT_KEY, JSON.stringify({ version: 1, owner: null, ids: [...new Set(ids.filter(validId))], complete: false }));
          finish(true);
        } catch (_) { finish(false); }
      }
      try {
        if (owner()) { finish(true); return; }
        initial = principal();
        const existing = storage.getItem(SNAPSHOT_KEY);
        if (existing !== null) { finish(validSnapshot(JSON.parse(existing))); return; }
        const factory = host.indexedDB;
        if (!factory || typeof factory.open !== 'function') { finish(false); return; }
        timer = schedule(() => finish(false), timeoutMs);
        // Omitting a version opens an existing DB without requesting an upgrade.
        const request = factory.open(HISTORY_DB);
        request.onupgradeneeded = () => {
          // A missing DB causes an upgrade transaction. Abort rather than create.
          try { request.transaction.abort(); } catch (_) { finish(false); return; }
          save([]);
        };
        request.onerror = request.onblocked = () => finish(false);
        request.onsuccess = () => {
          database = request.result;
          if (completed) { try { database.close(); } catch (_) {} return; }
          try {
            if (!database.objectStoreNames.contains('completions')) { finish(false); return; }
            const transaction = database.transaction('completions', 'readonly');
            const keys = transaction.objectStore('completions').getAllKeys();
            let ids;
            keys.onsuccess = () => { ids = keys.result; };
            keys.onerror = transaction.onerror = transaction.onabort = () => finish(false);
            transaction.oncomplete = () => { if (Array.isArray(ids)) save(ids); else finish(false); };
          } catch (_) { finish(false); }
        };
      } catch (_) { finish(false); }
    }).finally(() => { pending = null; });
    return pending;
  }
  return snapshot;
}
module.exports = { createHistorySnapshot, HISTORY_DB, SNAPSHOT_KEY };
