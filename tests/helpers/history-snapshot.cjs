'use strict';

// Small event-driven IDB fixture: only readonly key enumeration is supported.
function historyFactory(keys = [], options = {}) {
  const calls = [], pending = [];
  let closed = 0, aborted = 0, created = 0;
  const factory = { open(...args) {
    calls.push({ operation: 'open', args });
    const request = {};
    queueMicrotask(() => {
      if (options.missing) {
        request.transaction = { abort() { aborted++; } };
        request.onupgradeneeded?.({ oldVersion: 0 });
        if (!aborted) created++;
        request.onerror?.(); return;
      }
      request.result = {
        objectStoreNames: { contains: name => name === 'completions' }, close() { closed++; },
        transaction(name, mode) {
          calls.push({ operation: 'transaction', name, mode });
          const transaction = { objectStore(store) {
            calls.push({ operation: 'objectStore', store });
            return { getAllKeys() {
              calls.push({ operation: 'getAllKeys' });
              const read = {};
              const complete = () => { read.result = typeof keys === 'function' ? keys() : keys; read.onsuccess?.(); transaction.oncomplete?.(); };
              if (options.delay) pending.push(complete); else queueMicrotask(complete);
              return read;
            } };
          } };
          return transaction;
        }
      };
      request.onsuccess?.();
    });
    return request;
  } };
  return { factory, calls, get closed() { return closed; }, get aborted() { return aborted; }, get created() { return created; }, release() { pending.splice(0).forEach(fn => fn()); } };
}
module.exports = { historyFactory };
