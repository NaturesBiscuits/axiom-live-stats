// Same native IndexedDB transaction pattern as the manual recorder; independent lifecycle.
(() => {
  "use strict";
  function createArchive({indexedDB = globalThis.indexedDB, databaseName = "axiom-live-signals-v1"} = {}) {
    let opening, handle, known = new Set();
    const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Signal transaction failed")); });
    const get = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const open = () => opening ||= new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error("Signal storage unavailable")); return; }
      const req = indexedDB.open(databaseName, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore("meta"); req.result.createObjectStore("journal", {keyPath: "id"}); };
      req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error("Signal storage blocked"));
      req.onsuccess = () => { handle = req.result; handle.onversionchange = () => { handle.close(); handle = opening = null; }; resolve(handle); };
    }).catch(error => { opening = null; throw error; });
    return {async load() {
      const db = await open(), tx = db.transaction(["meta", "journal"], "readonly"), completed = done(tx);
      const [saved, journal] = await Promise.all([get(tx.objectStore("meta").get("state")), get(tx.objectStore("journal").getAll()), completed]);
      known = new Set(journal.map(row => row.id));
      return saved ? {...saved, engine: {...saved.engine, journal: journal.sort((a, b) => a.evaluatedAt - b.evaluatedAt)}} : null;
    }, async save(saved) {
      const {journal, ...engine} = saved.engine, db = await open(), tx = db.transaction(["meta", "journal"], "readwrite"), completed = done(tx);
      const store = tx.objectStore("journal"), retained = new Set(journal.map(row => row.id));
      for (const id of known) if (!retained.has(id)) store.delete(id);
      for (const row of journal) if (!known.has(row.id)) store.put(row);
      tx.objectStore("meta").put({...saved, engine}, "state"); await completed; known = retained;
    }, close() { handle?.close(); opening = handle = null; known.clear(); }};
  }
  const api = {createArchive}; globalThis.AxiomLiveSignalArchive = Object.freeze(api); if (typeof module !== "undefined") module.exports = api;
})();
