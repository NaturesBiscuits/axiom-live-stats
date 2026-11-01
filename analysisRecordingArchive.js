// Separate manual recording archive: one latest recording, atomic metadata + entry writes.
(() => {
  "use strict";
  function createArchive({indexedDB = globalThis.indexedDB, databaseName = "axiom-analysis-recording-v1"} = {}) {
    let opening = null, handle = null;
    const done = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Recording transaction failed")); });
    const result = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    function open() {
      return opening ||= new Promise((resolve, reject) => {
        if (!indexedDB) { reject(new Error("Local recording storage is unavailable")); return; }
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => { request.result.createObjectStore("meta"); request.result.createObjectStore("entries", {keyPath: "sequence"}); };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("Local recording storage is blocked by another page"));
        request.onsuccess = () => { handle = request.result; handle.onversionchange = () => { handle.close(); handle = opening = null; }; resolve(handle); };
      }).catch(error => { opening = null; throw error; });
    }
    async function write(session, rows, replace) {
      const db = await open(), tx = db.transaction(["meta", "entries"], "readwrite"), completed = done(tx);
      const entries = tx.objectStore("entries"); if (replace) entries.clear();
      tx.objectStore("meta").put(session, "session"); for (const row of rows) entries.put(row); await completed;
    }
    return {
      async load() {
        const db = await open(), tx = db.transaction(["meta", "entries"], "readonly"), completed = done(tx);
        const values = await Promise.all([result(tx.objectStore("meta").get("session")), result(tx.objectStore("entries").getAll()), completed]);
        return {session: values[0] ?? null, rows: values[1]};
      },
      replace: (session, rows) => write(session, rows, true), save: (session, row) => write(session, row ? [row] : [], false),
      close() { handle?.close(); handle = opening = null; }
    };
  }
  const api = {createArchive}; globalThis.AxiomAnalysisRecordingArchive = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
