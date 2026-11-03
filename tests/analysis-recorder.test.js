"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const R = require("../analysisRecorder.js"), S = require("../supplyValuation.js");
const {readReport} = require("./recording-report-helpers.js");
const start = 1700000000000, context = {sourceKey: "a", routeKey: "a", blockchain: "eth", mintAddress: "0x" + "1".repeat(40), poolAddress: null};
function snapshot(at = start) {
  const fields = Object.fromEntries([["price", "$2"], ["marketCap", "$999"], ["displayedSupply", "9007199254740993"], ["totalSupply", "150"], ["circulatingSupply", "0"]]
    .map(([key, raw]) => [key, S.observation(key, raw, {context, observedAt: at})]));
  return {title: "Token <script>untrusted</script>", chartContext: context, marketObservedAt: at, stats: {price: "$2", marketCap: "$999", supply: "9007199254740993"}, supplyValuation: {fields}};
}
const options = {sourceTabId: 42, intervalMs: 5000, scope: "all"};
function disk() { let saved = {session: null, rows: []}; return {
  load: async () => structuredClone(saved), replace: async (session, rows) => { saved = structuredClone({session, rows}); },
  save: async (session, row) => { saved.session = structuredClone(session); if (row) saved.rows.push(structuredClone(row)); }
}; }
test("Start requires an actual recent consistent source observation and valid recording options", () => {
  for (const data of [null, {...snapshot(), marketObservedAt: start - 10001}, {...snapshot(), chartContext: {...context, conflict: "conflict"}}]) assert.throws(() => R.createSession(data, options, start));
  assert.throws(() => R.createSession(snapshot(), {...options, intervalMs: 1}, start));
  assert.throws(() => R.createSession(snapshot(), {...options, scope: "anything"}, start));
});
test("Cadence records actual times, ignores snapshot republishes and never fills missed samples", () => {
  const session = R.createSession(snapshot(), options, start);
  assert(R.consider(session, snapshot(), 42, start));
  assert.equal(R.consider(session, snapshot(start + 1000), 42, start + 1000), null);
  assert.equal(R.consider(session, snapshot(), 42, start + 5000), null);
  assert.equal(R.consider(session, {...snapshot(), capturedAt: start + 20000}, 42, start + 20000), null);
  const next = R.consider(session, snapshot(start + 21000), 42, start + 21010);
  assert.equal(session.count, 2); assert.equal(next.loggedAt, start + 21010); assert.equal(next.observedAt, start + 21000); assert.equal(next.gapBeforeMs, 21010);
});
test("Other tabs are ignored, while source identity changes stop rather than mixing contexts", () => {
  const session = R.createSession(snapshot(), options, start); R.consider(session, snapshot(), 42, start);
  assert.equal(R.consider(session, snapshot(start + 5000), 99, start + 5000), null); assert.equal(session.state, "recording");
  const other = {...snapshot(start + 5000), chartContext: {...context, blockchain: "bsc"}};
  assert.equal(R.consider(session, other, 42, start + 5000), null); assert.equal(session.stopReason, "source-token-or-network-changed"); assert.equal(session.count, 1);
});
test("Report preserves exact large quantities, zero/missing distinctions and independent observed Market Cap", () => {
  const original = snapshot(), before = JSON.stringify(original), session = R.createSession(original, options, start);
  const row = R.consider(session, original, 42, start); R.stop(session, start + 6000);
  const field = row.supplyAndValuation.observations;
  assert.equal(field.displayedSupply.normalizedValue, "9007199254740993"); assert.equal(field.circulatingSupply.normalizedValue, "0"); assert.equal(field.maximumSupply.normalizedValue, null);
  assert.equal(row.market.values.marketCap, "$999"); assert.equal(row.supplyAndValuation.calculations[1].normalizedValue, "300");
  assert.equal(row.supplyAndValuation.calculations[1].inputs.supply, "supplyAndValuation.observations.totalSupply");
  assert.equal(JSON.stringify(original), before); const text = R.report(session, [row]);
  assert.match(text, /Recorded duration: 00:00:06/); assert.match(text, /Ended \(UTC\): 2023-11-14T22:13:26.000Z/);
  assert.match(text, /not verified market\/on-chain occurrence time/); assert.match(text, /untrusted source data/); assert.match(text, /2023-11-14T22:13:20.000Z/);
  assert.deepEqual(readReport(text).rows, [row]);
  original.supplyValuation.fields.totalSupply.normalizedValue = "1";
  assert.equal(row.supplyAndValuation.observations.totalSupply.normalizedValue, "150", "Recorded input values are immutable snapshots");
});
test("Supply-only scope omits unrelated summaries and context-mismatched supply cannot calculate", () => {
  const data = snapshot(); data.supplyValuation.fields.price.context = {...context, sourceKey: "other"};
  const session = R.createSession(data, {...options, scope: "supply"}, start);
  const row = R.consider(session, data, 42, start, () => { throw new Error("Unused summaries should not run"); });
  assert.equal(row.market, undefined); assert.equal(row.holders, undefined); assert(row.supplyAndValuation.calculations.every(value => value.status === "unavailable"));
});

test("Compact reports reconstruct every recorded field and reduce repeated multi-sample data", t => {
  for (const scope of ["all", "supply"]) {
    const session = R.createSession(snapshot(), {...options, scope}, start), rows = [];
    for (let index = 0; index < 60; index++) {
      const at = start + index * 5000 + (index >= 20 ? 20000 : 0), data = snapshot(at);
      data.stats.price = index % 2 ? "$0.000000123456789" : "$2";
      data.supplyValuation.fields.price = S.observation("price", data.stats.price, {context, observedAt: at - 100});
      data.supplyValuation.fields.maximumSupply = S.observation("maximumSupply", index >= 30 ? "0" : null, {context, observedAt: at - 500});
      data.tokenInfo = {source: "Axiom", observedAt: at - 250, status: "partial", tiles: {tax: {rawText: "0%", status: "available"}}};
      rows.push(R.consider(session, data, 42, at, () => ({
        holders: {status: "partial", observations: index < 15 ? [] : [{label: 'literal ["absent"] / ~', count: index % 3}],
          coverage: {valid: index < 40, observedAt: at - 5000}},
        liquidity: {value: index, unit: index < 40 ? "USD" : "SOL", sampledAt: at - 3000, attempts: [{value: 0}, {value: null}]},
        trading: {coverage: index < 10 ? null : {status: "partial", reason: "Filtered feed"}, buys: index, volume: "9007199254740993.123"}
      })));
    }
    R.stop(session, rows.at(-1).loggedAt + 1000);
    const before = JSON.stringify(rows), text = R.report(session, rows), decoded = readReport(text);
    assert.deepEqual(decoded.rows, rows, `${scope}: every value, source, status, time, gap, array and exact decimal survives`);
    assert.equal(JSON.stringify(rows), before, "Formatting never changes archived entries");
    assert.equal(decoded.header.format, "axiom-analysis-log-v2");
    assert(text.length < before.length * 0.4, "Representative report is at least 60% smaller than raw entry JSON alone");
    t.diagnostic(`${scope}: ${before.length.toLocaleString()} raw-entry characters -> ${text.length.toLocaleString()} report characters (${Math.round((1 - text.length / before.length) * 100)}% smaller)`);
  }
});

test("Compact timelines preserve structural changes, escaped keys, absent/null/zero, and literal marker arrays", () => {
  const session = R.createSession(snapshot(), options, start), baseline = R.consider(session, snapshot(), 42, start);
  const samples = [
    JSON.parse('{"a/b~c":{"__proto__":null,"zero":0,"empty":[],"object":{},"literal":["absent"]}}'),
    {"a/b~c": [null, 0, {value: ["object"]}]},
    {"a/b~c": null},
    {newField: {value: ["array"]}},
    {"a/b~c": {zero: "0", literal: ["absent"]}},
    {}
  ];
  const rows = samples.map((extra, index) => {
    const at = start + index * 5000;
    return {...structuredClone(baseline), sequence: index + 1, loggedAt: at, observedAt: at - 123,
      loggedAtUTC: new Date(at).toISOString(), observedAtUTC: new Date(at - 123).toISOString(), elapsedMs: index * 5000, extra};
  });
  R.stop(session, start + 30000);
  assert.deepEqual(readReport(R.report(session, rows)).rows, rows);
});

test("Compact reports handle no entries and a single supply-only baseline, including legacy sessions", () => {
  const session = R.createSession(snapshot(), {...options, scope: "supply"}, start);
  const row = R.consider(session, snapshot(), 42, start);
  R.stop(session, start + 1000); delete session.startPrice; delete session.endPrice;
  assert.deepEqual(readReport(R.report(session, [])).rows, []);
  assert.deepEqual(readReport(R.report(session, [row])).rows, [row]);
  assert.equal(readReport(R.report(session, [row])).header.startPrice, null);
});
test("Duration, count and byte limits stop without silently truncating or manufacturing extra entries", () => {
  let session = R.createSession(snapshot(), options, start); R.consider(session, snapshot(), 42, start);
  assert.equal(R.consider(session, snapshot(start + R.MAX_DURATION_MS + 1), 42, start + R.MAX_DURATION_MS + 1), null);
  assert.equal(session.endedAt, start + R.MAX_DURATION_MS);
  session = R.createSession(snapshot(), options, start); session.count = R.MAX_RECORDS; assert.equal(R.consider(session, snapshot(), 42, start), null); assert.equal(session.stopReason, "recording-size-limit");
  session = R.createSession(snapshot(), options, start); session.bytes = R.MAX_BYTES; assert.equal(R.consider(session, snapshot(), 42, start), null); assert.equal(session.count, 0);
});
test("Serialized service makes Start/Stop races deterministic and keeps stopped reports stable", async () => {
  let clock = start; const archive = disk(), service = R.createService({archive, now: () => clock});
  await service.start(snapshot(), options); clock += 5000;
  const [, stopped] = await Promise.all([service.observe(snapshot(clock), 42, clock), service.stop()]);
  assert.equal(stopped.session.count, 2); assert.equal(stopped.session.state, "stopped");
  clock += 5000; assert.equal(await service.observe(snapshot(clock), 42, clock), null); assert.equal((await service.report()).text, stopped.text);
  assert.equal((await archive.load()).rows.length, 2);
});

test("Starting price stays fixed across price updates, Stop, and archive restoration", async () => {
  let clock = start;
  const archive = disk(), service = R.createService({archive, now: () => clock});
  assert.equal((await service.start(snapshot(), options)).session.startPrice, "$2");
  clock += 5000;
  const next = snapshot(clock); next.stats.price = "$3";
  await service.observe(next, 42, clock);
  assert.equal((await service.stop()).session.startPrice, "$2");
  const restored = R.createService({archive, now: () => clock + 60000});
  const saved = (await restored.status()).session;
  assert.equal(saved.startPrice, "$2");
  assert.equal(saved.endPrice, "$3");
  assert.equal(saved.endedAt - saved.startedAt, 5000);
});

test("Ending price uses observations between log intervals and never takes another token's price", async () => {
  let clock = start;
  const service = R.createService({archive: disk(), now: () => clock});
  await service.start(snapshot(), options);
  clock += 1000;
  const next = snapshot(clock); next.stats.price = "$4";
  await service.observe(next, 42, clock);
  const stopped = await service.stop();
  assert.equal(stopped.session.count, 1);
  assert.equal(stopped.session.endPrice, "$4");
  clock += 1000; await service.start(snapshot(clock), options);
  const other = snapshot(clock); other.chartContext = {...context, sourceKey: "other"}; other.stats.price = "$99";
  assert.equal((await service.observe(other, 42, clock)).session.endPrice, "$2");
  await service.start(snapshot(clock), options); clock += 11000;
  assert.equal((await service.stop()).session.endPrice, null);
});
test("Worker restart preserves entries but marks an active recording interrupted at the last persisted log", async () => {
  const archive = disk(), service = R.createService({archive, now: () => start}); await service.start(snapshot(), options);
  const restarted = R.createService({archive, now: () => start + 50000}), result = await restarted.report();
  assert.equal(result.session.state, "stopped"); assert.equal(result.session.endedAt, start); assert.match(result.session.stopReason, /interrupted/); assert.equal(readReport(result.text).rows[0].sequence, 1);
});
test("Failed reads cannot replace the saved report, and a failed Start does not discard it", async () => {
  const archive = disk(), service = R.createService({archive, now: () => start}); await service.start(snapshot(), options); await service.stop();
  const text = (await service.report()).text; archive.replace = async () => { throw new Error("Disk full"); };
  await assert.rejects(service.start(snapshot(), options), /Disk full/); assert.equal((await service.report()).text, text);
  const broken = R.createService({archive: {...archive, load: async () => { throw new Error("Read failed"); }}});
  await assert.rejects(broken.start(snapshot(), options), /Read failed/);
});
test("Write failure stops recording, retains copyable in-memory entries, and retries atomically on Stop", async () => {
  let clock = start; const archive = disk(), originalSave = archive.save, service = R.createService({archive, now: () => clock});
  await service.start(snapshot(), options); archive.save = async () => { throw new Error("Disk full"); }; clock += 5000;
  const failed = await service.observe(snapshot(clock), 42, clock); assert.equal(failed.session.stopReason, "storage-error");
  assert.match((await service.report()).text, /Disk full/); assert.equal(readReport((await service.report()).text).rows.at(-1).sequence, 2);
  archive.save = originalSave; await service.stop(); assert.equal((await archive.load()).rows.length, 2);
});
test("Source closure and silent-source expiry produce bounded stopped reports", async () => {
  let clock = start; const service = R.createService({archive: disk(), now: () => clock}); await service.start(snapshot(), options);
  assert.equal(await service.sourceClosed(99), null); assert.equal((await service.sourceClosed(42)).session.stopReason, "source-tab-closed");
  await service.start(snapshot(), options); clock += R.MAX_DURATION_MS + 60000;
  const result = await service.expire(); assert.equal(result.session.endedAt, start + R.MAX_DURATION_MS); assert.equal(result.session.count, 1);
});
