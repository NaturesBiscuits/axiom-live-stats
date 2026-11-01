"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const R = require("../analysisRecorder.js"), S = require("../supplyValuation.js");
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
  assert.deepEqual(JSON.parse(text.split("ENTRIES — one JSON object per line\n")[1].split("\n")[0]), row);
  original.supplyValuation.fields.totalSupply.normalizedValue = "1";
  assert.equal(row.supplyAndValuation.observations.totalSupply.normalizedValue, "150", "Recorded input values are immutable snapshots");
});
test("Supply-only scope omits unrelated summaries and context-mismatched supply cannot calculate", () => {
  const data = snapshot(); data.supplyValuation.fields.price.context = {...context, sourceKey: "other"};
  const session = R.createSession(data, {...options, scope: "supply"}, start);
  const row = R.consider(session, data, 42, start, () => { throw new Error("Unused summaries should not run"); });
  assert.equal(row.market, undefined); assert.equal(row.holders, undefined); assert(row.supplyAndValuation.calculations.every(value => value.status === "unavailable"));
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
test("Worker restart preserves entries but marks an active recording interrupted at the last persisted log", async () => {
  const archive = disk(), service = R.createService({archive, now: () => start}); await service.start(snapshot(), options);
  const restarted = R.createService({archive, now: () => start + 50000}), result = await restarted.report();
  assert.equal(result.session.state, "stopped"); assert.equal(result.session.endedAt, start); assert.match(result.session.stopReason, /interrupted/); assert.match(result.text, /\"sequence\":1/);
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
  assert.match((await service.report()).text, /Disk full/); assert.match((await service.report()).text, /\"sequence\":2/);
  archive.save = originalSave; await service.stop(); assert.equal((await archive.load()).rows.length, 2);
});
test("Source closure and silent-source expiry produce bounded stopped reports", async () => {
  let clock = start; const service = R.createService({archive: disk(), now: () => clock}); await service.start(snapshot(), options);
  assert.equal(await service.sourceClosed(99), null); assert.equal((await service.sourceClosed(42)).session.stopReason, "source-tab-closed");
  await service.start(snapshot(), options); clock += R.MAX_DURATION_MS + 60000;
  const result = await service.expire(); assert.equal(result.session.endedAt, start + R.MAX_DURATION_MS); assert.equal(result.session.count, 1);
});
