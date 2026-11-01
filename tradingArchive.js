// Separate, bounded IndexedDB event archive. Identity is context + full opaque key.
(() => {
  "use strict";
  function createArchive({indexedDB = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange, now = Date.now,
    databaseName = "axiom-trading-participation-v1", maxRecords = AxiomTrading.MAX_RECORDS, retentionMs = AxiomTrading.RETENTION_MS} = {}) {
    let opening = null, handle = null;
    const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const completed = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Trading archive transaction failed")); });
    function open() {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        if (!indexedDB) { reject(new Error("Trading IndexedDB unavailable; collection continues in bounded memory")); return; }
        const req = indexedDB.open(databaseName, 1);
        req.onupgradeneeded = () => {
          const events = req.result.createObjectStore("events", {keyPath: ["tokenKey", "eventKey"]});
          events.createIndex("firstSeen", "firstSeenAt"); events.createIndex("tokenSeen", ["tokenKey", "firstSeenAt"]);
          req.result.createObjectStore("meta", {keyPath: "key"});
        };
        req.onsuccess = () => { handle = req.result; handle.onversionchange = () => { handle.close(); handle = null; opening = null; }; resolve(handle); };
        req.onerror = () => reject(req.error); req.onblocked = () => reject(new Error("Trading archive upgrade blocked by another extension page"));
      }).catch(error => { opening = null; throw error; });
      return opening;
    }
    async function prune() {
      const db = await open(), tx = db.transaction(["events", "meta"], "readwrite"), done = completed(tx);
      const events = tx.objectStore("events"), meta = tx.objectStore("meta");
      const expired = events.index("firstSeen").openCursor(keyRange.upperBound(now() - retentionMs, true));
      expired.onsuccess = () => { const cursor = expired.result; if (cursor) { cursor.delete(); cursor.continue(); } };
      const metaReq = meta.getAll();
      metaReq.onsuccess = () => {
        const contexts = metaReq.result.filter(row => row.key.startsWith("context:"));
        contexts.sort((a, b) => (b.value.lastReadAt ?? 0) - (a.value.lastReadAt ?? 0));
        for (const [index, row] of contexts.entries()) if (index >= 64 || row.value.lastReadAt < now() - retentionMs) meta.delete(row.key);
      };
      await done;
      const countTx = db.transaction("events", "readonly"), countDone = completed(countTx);
      const count = await request(countTx.objectStore("events").count()); await countDone;
      if (count > maxRecords) {
        const capTx = db.transaction(["events", "meta"], "readwrite"), capDone = completed(capTx);
        const lossReq = capTx.objectStore("meta").get("losses");
        lossReq.onsuccess = () => {
          const saved = lossReq.result?.value ?? {sources: [], global: null};
          const losses = new Map(saved.sources); let globalLoss = saved.global;
          let removed = 0;
          const cursorReq = capTx.objectStore("events").index("firstSeen").openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor && removed < count - maxRecords) {
              const row = cursor.value;
              losses.set(row.tokenKey, AxiomTrading.mergeLoss(losses.get(row.tokenKey), AxiomTrading.lossFor(row, "archive-record-cap")));
              cursor.delete(); removed++; cursor.continue();
            } else {
              for (const [key, loss] of losses) if (loss.through < now() - retentionMs) losses.delete(key);
              while (losses.size > 64) { const key = losses.keys().next().value; globalLoss = AxiomTrading.mergeLoss(globalLoss, losses.get(key)); losses.delete(key); }
              if (globalLoss?.through < now() - retentionMs) globalLoss = null;
              capTx.objectStore("meta").put({key: "losses", value: {sources: [...losses], global: globalLoss}});
            }
          };
        };
        await capDone;
      }
    }
    return {open, prune,
      async write(rows, coverage = null, deliveryLosses = []) {
        const db = await open(), tx = db.transaction(["events", "meta"], "readwrite"), done = completed(tx), store = tx.objectStore("events");
        for (const row of AxiomTrading.mergeRows(rows.filter(row => AxiomTrading.isEvent(row, now())))) {
          const req = store.get([row.tokenKey, row.eventKey]);
          req.onsuccess = () => store.put(AxiomTrading.mergeEvent(req.result, row));
        }
        if (deliveryLosses.length) {
          const meta = tx.objectStore("meta"), req = meta.get("deliveryLosses");
          req.onsuccess = () => {
            const bySource = new Map((req.result?.value ?? []).map(loss => [loss.tokenKey, loss]));
            for (const loss of deliveryLosses) {
              const old = bySource.get(loss.tokenKey);
              bySource.set(loss.tokenKey, old ? {...loss, from: Math.min(old.from, loss.from), through: Math.max(old.through, loss.through), count: Math.max(old.count, loss.count)} : loss);
            }
            for (const [key, loss] of bySource) if (loss.through < now() - retentionMs) bySource.delete(key);
            while (bySource.size > 65) {
              const key = [...bySource.keys()].find(key => key !== "*");
              bySource.set("*", {...AxiomTrading.mergeLoss(bySource.get("*"), bySource.get(key)), tokenKey: "*"}); bySource.delete(key);
            }
            meta.put({key: "deliveryLosses", value: [...bySource.values()]});
          };
        }
        if (typeof coverage?.tokenKey === "string" && coverage.tokenKey.length <= 4096) {
          const meta = tx.objectStore("meta"), key = "context:" + coverage.tokenKey, req = meta.get(key);
          req.onsuccess = () => {
            const old = req.result?.value;
            meta.put({key, value: AxiomTrading.mergeCoverage(old, coverage)});
          };
        }
        await done; await prune();
      },
      async read(tokenKey) {
        await prune(); const db = await open(), tx = db.transaction(["events", "meta"], "readonly"), done = completed(tx);
        const events = request(tx.objectStore("events").index("tokenSeen").getAll(keyRange.bound([tokenKey, 0], [tokenKey, Number.MAX_SAFE_INTEGER])));
        const coverage = request(tx.objectStore("meta").get("context:" + tokenKey));
        const losses = request(tx.objectStore("meta").get("losses"));
        const count = request(tx.objectStore("events").count());
        const deliveryLosses = request(tx.objectStore("meta").get("deliveryLosses"));
        const values = await Promise.all([events, coverage, losses, count, deliveryLosses]); await done;
        return {events: values[0], coverage: values[1]?.value ?? null,
          losses: [new Map(values[2]?.value?.sources).get(tokenKey), values[2]?.value?.global,
            ...(values[4]?.value ?? []).filter(loss => loss.tokenKey === tokenKey || loss.tokenKey === "*")].filter(Boolean),
          recordCount: values[3], maxRecords, retentionMs, deduplicationRetentionMs: retentionMs};
      },
      close() { handle?.close(); handle = null; opening = null; }
    };
  }
  const api = {createArchive}; globalThis.AxiomTradingArchive = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
