// Store only opaque hashes + action metadata and user-named filter combinations.
// IndexedDB transactions serialize changes across tabs. No message/card body is saved.
export function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ember-signal-log-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('items');
      request.result.createObjectStore('views');
    };
    request.onerror = () => reject(new Error('Device storage is unavailable. Changes remain in this tab.'));
    request.onsuccess = () => {
      const db = request.result;
      const transact = (store, mode, op) => new Promise((res, rej) => {
        const tx = db.transaction(store, mode), req = op(tx.objectStore(store));
        tx.oncomplete = () => res(req?.result);
        tx.onerror = tx.onabort = () => rej(new Error('Could not save on this device. Keep this tab open and retry.'));
      });
      resolve({
        get: (key) => transact('items', 'readonly', s => s.get(key)),
        update: (key, patch, expectedRevision) => new Promise((res, rej) => {
          const tx = db.transaction('items', 'readwrite'), store = tx.objectStore('items'), req = store.get(key);
          let result, conflict = false;
          req.onsuccess = () => {
            const before = req.result || {};
            if (expectedRevision && before.revision !== expectedRevision) { conflict = true; tx.abort(); return; }
            const merged = { ...before, ...patch };
            const after = { read: merged.read === true, status: merged.status || 'open', snoozeUntil: merged.snoozeUntil || null, updatedAt: merged.updatedAt, observedAt: merged.observedAt, revision: crypto.randomUUID() };
            store.put(after, key); result = { before, after };
          };
          tx.oncomplete = () => res(result);
          tx.onerror = tx.onabort = () => rej(new Error(conflict ? 'This signal changed in another tab. Refresh its state before undoing.' : 'Could not save on this device. Keep this tab open and retry.'));
        }),
        views: () => transact('views', 'readonly', s => s.getAll()),
        saveView: value => transact('views', 'readwrite', s => s.put(value, value.id)),
        deleteView: id => transact('views', 'readwrite', s => s.delete(id)),
      });
    };
  });
}
