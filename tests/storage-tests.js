(async () => {
  "use strict";
  const archive = AxiomSampleArchive.createArchive({databaseName: "axiom-v2-restart-fixture"});
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const phase = new URL(location.href).searchParams.get("phase");
  const checks = [];
  const H = AxiomLiquidityHistory;
  const liquidity = AxiomSampleArchive.createArchive({databaseName: "axiom-liquidity-restart-fixture", valueTypes: ["liquidity"],
    source: H.SOURCE, defaults: {retentionHours: H.RETENTION_HOURS, maxRecords: H.MAX_RECORDS},
    maxTokenKeyLength: 4096, validateRow: H.isAttempt});
  const at = Math.floor(Date.now() / 1000);
  const row = (tokenKey, valueType, timestamp, value) => ({tokenKey, valueType, timestamp, unit: "USD", value,
    tokenIdentity: {blockchain: "solana", mintAddress: tokenKey}, source: "axiom-dom-sample",
    domReadAt: timestamp * 1000, valueChangedAt: timestamp * 1000, sampledAt: timestamp * 1000 + 20,
    deliveredAt: timestamp * 1000 + 30, sourceFreshness: "fresh", observedAt: timestamp * 1000,
    stale: false, gap: false});
  try {
    if (phase === "write") {
      const price = Array.from({length: 900}, (_, index) => row("token-a", "price", at - 899 + index, 0.00000123));
      const cap = Array.from({length: 50}, (_, index) => row("token-a", "marketCap", at - 49 + index, 1230000));
      const other = Array.from({length: 20}, (_, index) => row("token-b", "price", at - 19 + index, 2));
      await archive.write([...price, ...cap, ...other]);
      await archive.write([{...price.at(-1), value: 0.00000124, sampledAt: at * 1000 + 25}]);
      await archive.write([{...price.at(-1), value: 9, sampledAt: at * 1000 + 21}]);
      assert((await archive.stats()).count === 970, "Native IndexedDB upserts compound keys without duplicates"); checks.push("compound-key deduplication");
      await archive.write([{...price[0], timestamp: at + 1, gap: true, value: null, sampledAt: null}]);
      assert((await archive.stats()).count === 970, "Gap markers are not stored as observed data"); checks.push("no invented observations");
      const restored = await archive.readLatest("token-a", "price");
      assert(restored.samples.length === 900 && restored.samples.at(-1).value === 0.00000124, "900 precise samples persist"); checks.push("900-slot persistence");
      checks.push("older duplicate cannot overwrite newer sample");
      assert((await archive.readLatest("token-a", "marketCap")).samples[0].value === 1230000, "Market cap is independent"); checks.push("metric isolation");
      assert((await archive.readLatest("token-b", "price")).samples.length === 20, "Token isolation"); checks.push("token isolation");
      await archive.setMeta("restart-check", {at, count: 970});
      await archive.setSettings({retentionHours: 24, maxRecords: 1000});
      checks.push("retention settings saved");
    } else {
      const prior = await archive.getMeta("restart-check");
      assert(prior?.count === 970 && (await archive.stats()).count === 970, "Actual separate Chrome process reopens persisted data"); checks.push("browser restart persistence");
      const series = await archive.readLatest("token-a", "price");
      assert(series.samples.length === 900 && series.samples.at(-1).value === 0.00000124, "Precision survives browser restart"); checks.push("small-price precision after restart");
      assert((await archive.getSettings()).maxRecords === 1000, "Settings survive browser restart"); checks.push("settings persistence");
      const earlier = await archive.readLatest("token-a", "price", prior.at - 100);
      assert(earlier.samples.length === 800 && earlier.samples.at(-1).timestamp === prior.at - 100, "A recorded UTC window can be selected without backfilling unknown periods"); checks.push("historical window selection");
      const extra = Array.from({length: 100}, (_, index) => row("token-c", "price", at - 99 + index, 3));
      await archive.write(extra);
      assert((await archive.stats()).count === 1000, "Oldest actual records evicted at global limit"); checks.push("global record retention");
      await archive.setSettings({retentionHours: 0.25, maxRecords: 1000});
      const old = row("expired-token", "price", at - 10000, 1);
      await archive.write([old]);
      assert((await archive.readLatest("expired-token", "price")).samples.length === 0, "Expired observations are removed"); checks.push("age retention");
      assert(AxiomRollingChart.toJSONL(series).split("\n").length === 900, "Persisted numeric samples export without duplicates"); checks.push("persisted JSONL export");
    }
    if (phase === "write") {
      const recorder = H.createRecorder({sessionId: "storage-test"});
      recorder.setContext({sourceKey: "token-pool-a", blockchain: "solana", mintAddress: "mint", poolAddress: "pool-a"});
      const base = at * 1000 - 20000;
      const make = (index, text) => recorder.sample(() => ({displayText: text, domReadAt: base + index * 5000}), base + index * 5000);
      const rows = [make(0, "$5.56K"), make(1, "$5.56K"), make(2, null), make(3, "$bad"), make(4, "1 SOL")];
      recorder.setContext({sourceKey: "token-pool-b", blockchain: "solana", mintAddress: "mint", poolAddress: "pool-b"});
      const poolB = make(4, "$1.2M");
      await liquidity.write([...rows, poolB]);
      await liquidity.write([rows[0]]);
      assert((await liquidity.stats()).count === 6, "Liquidity records include unchanged, missing and invalid attempts, without duplicate keys");
      const saved = await liquidity.readLatest(rows[0].tokenKey, "liquidity", null, {windowSeconds: 86400, maxRows: 10000, allUnits: true});
      assert(saved.samples.length === 5 && saved.samples[2].status === "missing" && saved.samples[3].status === "invalid", "Missing/invalid remain null persisted attempts");
      assert(saved.samples[0].value === 5560 && saved.samples[0].displayText === "$5.56K" && saved.samples[0].observedAt === base, "Original text, value and exact time persist");
      assert(saved.samples.at(-1).unit === "SOL", "Currencies stay distinct in native storage");
      assert((await liquidity.readLatest(poolB.tokenKey, "liquidity")).samples.length === 1, "Migration uses its separate pool series");
      await liquidity.setMeta("restart-check", {tokenKey: rows[0].tokenKey, poolKey: poolB.tokenKey, base});
      assert((await liquidity.getSettings()).maxRecords === 10000, "Liquidity defaults to a separate 10,000-record archive");
      checks.push("liquidity attempts/text/timestamps/currency/pool persistence", "liquidity separate defaults");
    } else {
      const prior = await liquidity.getMeta("restart-check");
      const saved = await liquidity.readLatest(prior.tokenKey, "liquidity", null, {windowSeconds: 86400, maxRows: 10000, allUnits: true});
      assert(saved.samples.length === 5 && saved.samples[0].observedAt === prior.base && saved.samples[0].sampledAt === prior.base, "Separate browser restart preserves actual liquidity read times");
      assert(saved.samples[2].value === null && saved.samples[3].value === null, "Unavailable readings never become zero after restoration");
      const restored = saved.samples[0];
      const old = {...restored, sampledAt: restored.sampledAt - 500000000, domReadAt: restored.domReadAt - 500000000,
        observedAt: restored.observedAt - 500000000, timestamp: restored.timestamp - 500000, tokenKey: "expired-liquidity"};
      await liquidity.write([old]);
      assert((await liquidity.readLatest("expired-liquidity", "liquidity")).samples.length === 0, "Liquidity age retention removes expired observations");
      await liquidity.setSettings({retentionHours: 24, maxRecords: 1000});
      const extra = Array.from({length: 1100}, (_, index) => {
        const sampledAt = at * 1000 - index * 5000;
        return {...restored, tokenKey: "limit-liquidity", sampledAt, domReadAt: sampledAt, observedAt: sampledAt, timestamp: sampledAt / 1000};
      });
      await liquidity.write(extra);
      assert((await liquidity.stats()).count === 1000, "Liquidity global record cap evicts oldest records");
      const retained = await liquidity.readLatest("limit-liquidity", "liquidity", null, {windowSeconds: 86400, maxRows: 10000, allUnits: true});
      assert(retained.samples[0].sampledAt > extra.at(-1).sampledAt, "Count retention removes older liquidity attempts first");
      assert((await archive.readLatest("token-a", "price")).samples.length > 0, "Liquidity pruning preserves the existing price archive");
      checks.push("liquidity browser restart timestamps", "liquidity null restoration", "liquidity age/count retention", "price archive preserved");
    }
    await runTradingStorageChecks(phase, checks);
    await runLiquidityAlertStorageChecks(phase, checks, liquidity);
    liquidity.close(); archive.close();
    document.body.dataset.testStatus = "passed";
    document.getElementById("results").textContent = JSON.stringify({phase, passed: checks.length, checks});
  } catch (error) {
    liquidity.close(); archive.close(); document.body.dataset.testStatus = "failed";
    document.getElementById("results").textContent = JSON.stringify({phase, passed: checks.length, error: error.stack});
  }
})();
