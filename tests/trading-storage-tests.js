globalThis.runTradingStorageChecks = async (phase, checks) => {
  const T = AxiomTrading, assert = (ok, message) => { if (!ok) throw new Error(message); };
  const address = n => "0x" + n.toString(16).padStart(40, "0"), now = Date.now();
  const context = T.sourceContext({sourceKey: "storage-trades", routeKey: "route", blockchain: "eth", mintAddress: address(10), poolAddress: address(20)}, "storage", 1);
  const other = T.sourceContext({...context, poolAddress: address(21)}, "storage", 2);
  const archive = AxiomTradingArchive.createArchive({databaseName: "trading-storage-fixture", maxRecords: 8});
  function event(key, at, source = context, maker = address(1), total = 10, age = "6s") {
    return T.makeEvent({eventKey: key, makerAddress: maker, makerCandidates: maker ? [maker] : [], identityStatus: maker ? "resolved" : "unresolved",
      traderDisplay: "Same name", direction: "buy", directionMarkers: ["text-increase"],
      total: {value: total, unit: "USD", displayText: total === null ? null : "$" + total, status: total === null ? "missing" : "valid"},
      tokenAmount: {value: null, status: "missing"}, rawAge: age, filters: {status: "unknown", controls: []}, transactionUrl: null}, source, at, "initial-sync");
  }
  try {
    if (phase === "write") {
      const base = now - 20000, a = event("signature-1-2-0", base), reread = event(a.eventKey, base + 1000, context, address(1), 10, "7s");
      const b = event("signature-1-3-0", base + 2000), zero = event("zero", base + 3000, context, null, 0);
      const missing = event("missing", base + 4000, context, address(2), null, null);
      const coverage = {tokenKey: context.tokenKey, recordingStartedAt: base, lastReadAt: now, status: "available", expectedEstimate: a.estimatedTradeAt};
      await archive.write([a, b, reread, zero, missing], coverage);
      await archive.write([event(a.eventKey, base + 5000, context, address(1), 10, "11s"), event(a.eventKey, base, other)]);
      const saved = await archive.read(context.tokenKey);
      assert(saved.events.length === 4 && saved.recordCount === 5, "Compound event identity deduplicates rereads and preserves distinct same-transaction keys"); checks.push("trade compound-key deduplication and distinct events");
      const first = saved.events.find(row => row.eventKey === a.eventKey);
      assert(first.firstSeenAt === base && first.lastReadAt === base + 5000 && first.estimatedTradeAt === a.estimatedTradeAt, "Archive freezes first-seen and first valid age across updates"); checks.push("trade immutable age estimate and original observation times");
      assert(saved.events.find(row => row.eventKey === "zero").totals.USD.value === 0 && saved.events.find(row => row.eventKey === "missing").estimatedTradeAt === null, "Zero and unavailable fields persist separately"); checks.push("trade zero and unavailable persistence");
      assert((await archive.read(other.tokenKey)).events.length === 1, "Different pool cannot share an event identity"); checks.push("trade pool/source isolation");
      assert(saved.deduplicationRetentionMs === 86400000, "Dedup retention is explicit"); checks.push("trade dedup retention metadata");
      await archive.write([], coverage, [{tokenKey: context.tokenKey, from: base, through: now, count: 1, reason: "pending-write-cap"}]);
      assert((await archive.read(context.tokenKey)).losses.some(loss => loss.reason === "pending-write-cap"), "Delivery loss is persisted"); checks.push("trade pending-loss persistence");
    } else {
      const saved = await archive.read(context.tokenKey);
      assert(saved.events.length === 4 && saved.events.find(row => row.eventKey === "signature-1-2-0").estimatedTradeAt === saved.coverage.expectedEstimate, "Separate browser process preserves dedup identity and original timing"); checks.push("trade browser restart identity and timing");
      await archive.write([event("signature-1-2-0", now, context, address(1), 10, "30s")]);
      const read = await archive.read(context.tokenKey);
      assert(read.events.length === 4 && read.events.find(row => row.eventKey === "signature-1-2-0").firstSeenAt === saved.coverage.recordingStartedAt, "Reread after restart is not a new event"); checks.push("trade deduplication after restart");
      assert(read.losses.some(loss => loss.reason === "pending-write-cap"), "Pending loss survives worker/browser lifetime"); checks.push("trade loss metadata after restart");
      await archive.write([event("expired", now - 90000000)]);
      assert(!(await archive.read(context.tokenKey)).events.some(row => row.eventKey === "expired"), "Expired events removed"); checks.push("trade 24h age retention");
      await archive.write(Array.from({length: 10}, (_, index) => event("cap-" + index, now - 1000 + index)));
      const capped = await archive.read(context.tokenKey);
      assert(capped.recordCount === 8 && capped.events.length === 8, "Archive global record limit enforced"); checks.push("trade bounded archive records");
      const summary = T.analyze(capped.events, {now: now + 100, losses: capped.losses});
      assert(summary.losses.some(loss => loss.reason === "archive-record-cap"), "Selected-window truncation exposed"); checks.push("trade selected-window archive truncation");
      const bad = {...event("invalid", now), eventKey: null}; await archive.write([bad]);
      assert((await archive.read(context.tokenKey)).recordCount === 8, "Malformed event cannot enter archive"); checks.push("trade archive validation");
    }
  } finally { archive.close(); }
};
