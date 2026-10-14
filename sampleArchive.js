// Free extension-origin IndexedDB. Only actual sampling attempts are recorded.
(() => {
  "use strict";
  const DEFAULTS = {retentionHours: 24, maxRecords: 25000};
  function settings(value = {}) {
    return {retentionHours: [0.25, 24, 72, 168].includes(Number(value.retentionHours)) ? Number(value.retentionHours) : DEFAULTS.retentionHours,
      maxRecords: Number.isInteger(Number(value.maxRecords)) ? Math.min(100000, Math.max(1000, Number(value.maxRecords))) : DEFAULTS.maxRecords};
  }
  function createArchive({databaseName = "axiom-free-chart-v2", indexedDB = globalThis.indexedDB,
    keyRange = globalThis.IDBKeyRange, now = Date.now} = {}) {
    let opening = null;
    let handle = null;
    const request = req => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    const completed = tx => new Promise((resolve, reject) => {
      tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed."));
    });
    function open() {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        if (!indexedDB) { reject(new Error("IndexedDB is unavailable; live collection continues in memory.")); return; }
        const req = indexedDB.open(databaseName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          const store = db.createObjectStore("samples", {keyPath: ["tokenKey", "valueType", "unit", "timestamp"]});
          store.createIndex("timestamp", "timestamp");
          store.createIndex("tokenMetric", ["tokenKey", "valueType", "timestamp"]);
          db.createObjectStore("meta", {keyPath: "key"});
        };
        req.onsuccess = () => {
          handle = req.result;
          handle.onversionchange = () => { handle.close(); handle = null; opening = null; };
          resolve(handle);
        };
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another extension page."));
      }).catch(error => { opening = null; throw error; });
      return opening;
    }
    async function getMeta(key) {
      const db = await open(), tx = db.transaction("meta", "readonly"), done = completed(tx);
      const row = await request(tx.objectStore("meta").get(key)); await done; return row?.value;
    }
    async function setMeta(key, value) {
      const db = await open(), tx = db.transaction("meta", "readwrite"), done = completed(tx);
      tx.objectStore("meta").put({key, value}); await done;
    }
    async function prune() {
      const config = settings(await getMeta("settings"));
      const db = await open(), tx = db.transaction("samples", "readwrite"), done = completed(tx);
      const store = tx.objectStore("samples"), cutoff = Math.floor(now() / 1000 - config.retentionHours * 3600);
      const expired = store.index("timestamp").openCursor(keyRange.upperBound(cutoff, true));
      expired.onsuccess = () => { const cursor = expired.result; if (cursor) { cursor.delete(); cursor.continue(); } };
      await done;
      const countTx = db.transaction("samples", "readonly"), countDone = completed(countTx);
      const count = await request(countTx.objectStore("samples").count()); await countDone;
      const excess = count - config.maxRecords;
      if (excess > 0) {
        const removeTx = db.transaction("samples", "readwrite"), removeDone = completed(removeTx);
        let removed = 0;
        const req = removeTx.objectStore("samples").index("timestamp").openCursor();
        req.onsuccess = () => { const cursor = req.result; if (cursor && removed < excess) { cursor.delete(); removed++; cursor.continue(); } };
        await removeDone;
      }
      return config;
    }
    return {
      open, getMeta, setMeta,
      getSettings: async () => settings(await getMeta("settings")),
      async setSettings(value) { const config = settings(value); await setMeta("settings", config); await prune(); return config; },
      async write(rows) {
        const valid = rows.filter(row => row && !row.gap && Number.isFinite(row.sampledAt) &&
          typeof row.tokenKey === "string" && row.tokenKey.length <= 2048 && ["price", "marketCap"].includes(row.valueType) &&
          typeof row.unit === "string" && row.unit.length <= 24 && row.source === "axiom-dom-sample" &&
          Number.isSafeInteger(row.timestamp) && row.timestamp >= 0 && row.timestamp * 1000 <= now() + 1000 &&
          (row.value === null || (Number.isFinite(row.value) && row.value >= 0)));
        if (valid.length) {
          const db = await open(), tx = db.transaction("samples", "readwrite"), done = completed(tx), store = tx.objectStore("samples");
          for (const row of valid) {
            const old = store.get([row.tokenKey, row.valueType, row.unit, row.timestamp]);
            old.onsuccess = () => { if (!old.result || old.result.sampledAt <= row.sampledAt) store.put(row); };
          }
          await done;
        }
        await prune();
      },
      async readLatest(tokenKey, valueType, requestedEnd = null) {
        await prune();
        const db = await open(), tx = db.transaction("samples", "readonly"), done = completed(tx);
        const chosenEnd = Number.isSafeInteger(requestedEnd) && requestedEnd >= 0 ? Math.min(requestedEnd, Math.floor(now() / 1000)) : null;
        const range = keyRange.bound([tokenKey, valueType, 0], [tokenKey, valueType, chosenEnd ?? Number.MAX_SAFE_INTEGER]);
        const req = tx.objectStore("samples").index("tokenMetric").openCursor(range, "prev");
        const rows = [];
        let end = chosenEnd, unit = null;
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) return;
          const row = cursor.value;
          if (unit === null) { end ??= row.timestamp; unit = row.unit; }
          if (row.timestamp <= end - 900 || rows.length >= 900) return;
          if (row.unit === unit) rows.push(row);
          cursor.continue();
        };
        await done;
        return {unit, end, samples: rows.sort((a, b) => a.timestamp - b.timestamp)};
      },
      async stats() {
        const db = await open(), tx = db.transaction("samples", "readonly"), done = completed(tx);
        const store = tx.objectStore("samples");
        const results = await Promise.all([request(store.count()), request(store.index("timestamp").openCursor()), request(store.index("timestamp").openCursor(null, "prev"))]);
        await done;
        return {count: results[0], firstTimestamp: results[1]?.value.timestamp ?? null, lastTimestamp: results[2]?.value.timestamp ?? null};
      },
      close() { handle?.close(); handle = null; opening = null; }
    };
  }
  const api = {createArchive, settings, DEFAULTS};
  globalThis.AxiomSampleArchive = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
