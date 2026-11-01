"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const T = require("../tradingParticipation.js");
const now = 1700000000000, address = n => "0x" + n.toString(16).padStart(40, "0");
const context = T.sourceContext({sourceKey: "ctx", routeKey: "route", blockchain: "eth", mintAddress: address(100), poolAddress: address(200)}, "test", 1);
function event(key, maker = address(1), side = "buy", value = 10, unit = "USD", rawAge = "6s", at = now) {
  const markers = side === "buy" ? ["text-increase"] : side === "sell" ? ["text-decrease"] : [];
  return T.makeEvent({eventKey: key, makerAddress: maker, makerCandidates: maker ? [maker] : [], identityStatus: maker ? "resolved" : "unresolved",
    traderDisplay: "Same name", direction: side, directionMarkers: markers, total: {value, unit, status: value === null ? "missing" : "valid", displayText: value === null ? null : String(value)},
    tokenAmount: {value: null, status: "missing"}, rawAge, filters: {status: "unknown", controls: []}, transactionUrl: null}, context, at, "initial-sync");
}
const analyze = (rows, options = {}) => T.analyze(rows, {now, ...options});
test("Relative ages have frozen approximate intervals and explicit rounding; unsupported ages remain untimed", () => {
  const timing = T.ageTiming("6s", now); assert.equal(timing.estimatedTradeAt, now - 6000);
  assert.equal(timing.earliestAt, now - 7000); assert.equal(timing.latestAt, now - 5000); assert.equal(timing.confidence, "approximate");
  assert.equal(T.ageTiming("1.5m", now).precisionMs, 6000);
  for (const raw of [null, "", "9mo", "yesterday", "-1s", "NaN", "1e2s"]) assert.equal(T.ageTiming(raw, now), null);
  const first = event("key"), reread = event("key", address(1), "buy", 10, "USD", "9s", now + 4000);
  const merged = T.mergeEvent(first, reread);
  assert.equal(merged.estimatedTradeAt, first.estimatedTradeAt); assert.equal(merged.firstSeenAt, now); assert.equal(merged.lastReadAt, now + 4000); assert.equal(merged.rawAge, "9s");
});
test("Complete opaque keys deduplicate across rereads while distinct events in one transaction survive", () => {
  const rows = T.mergeRows([event("signature-1-2-0"), event("signature-1-3-0")], [event("signature-1-2-0")]);
  assert.equal(rows.length, 2); assert.equal(analyze(rows).buys, 2); assert.equal(analyze(rows).repeatBuyers, 1);
  assert.throws(() => T.mergeEvent(rows[0], event("different")), /different/);
  assert.equal(T.opaqueKey(""), false); assert.equal(T.opaqueKey("opaque suffix - keep it"), true);
});
test("Unique wallets use full maker identities, including same display name/different address and both sides", () => {
  const rows = [event("a"), event("b"), event("c", address(2)), event("d", address(1), "sell"), event("e", address(1), "sell")];
  const result = analyze(rows);
  assert.equal(result.buys, 3); assert.equal(result.sells, 2); assert.equal(result.buyers, 2); assert.equal(result.sellers, 1);
  assert.equal(result.bothSides, 1); assert.equal(result.repeatBuyers, 1); assert.equal(result.repeatSellers, 1);
  assert.equal(result.wallets.find(row => row.address === address(1)).events, 4);
});
test("Missing identities, directions and volume preserve independently supported counts and explicit denominators", () => {
  const result = analyze([event("a", address(1), "buy", 40), event("b", null, "sell", 30), event("c", address(2), "unknown", 20), event("d", address(3), "buy", null)]);
  assert.equal(result.events, 4); assert.equal(result.buys, 2); assert.equal(result.sells, 1); assert.equal(result.unknownDirection, 1);
  assert.equal(result.unresolvedEvents, 1); assert.equal(result.totalVolume, 90); assert.equal(result.unresolvedVolume, 30); assert.equal(result.unknownDirectionVolume, 20);
  assert.equal(result.missingVolumeEvents, 1); assert.equal(result.shares[0].percentage, 40 / 90 * 100);
  assert.equal(result.wallets.find(row => row.address === address(3)).share, null);
  assert.match(result.denominator, /including unresolved addresses and unknown directions/);
});
test("Different displayed currencies are stored separately without changing event counts or converting amounts", () => {
  const usd = event("a", address(1), "buy", 100), sol = event("a", address(1), "buy", 1, "SOL");
  const merged = T.mergeEvent(usd, sol);
  assert.equal(merged.totals.USD.value, 100); assert.equal(merged.totals.SOL.value, 1);
  assert.equal(analyze([merged], {currency: "SOL"}).totalVolume, 1);
  assert.equal(analyze([merged]).events, 1);
  const multi = analyze([usd, event("b", address(2), "sell", 5, "SOL")], {currency: "USD"});
  assert.equal(multi.totalVolume, 100); assert.equal(multi.otherCurrencyEvents, 1); assert.equal(multi.events, 2);
});
test("Zero observed volume is valid while zero denominators and insufficient wallet sets have unavailable shares", () => {
  const result = analyze([event("a", address(1), "buy", 0)]);
  assert.equal(result.totalVolume, 0); assert.equal(result.volumeEvents, 1); assert(result.shares.every(share => share.percentage === null));
  assert.equal(analyze([event("a")]).shares[1].percentage, null);
});
test("Initial sync uses relative trade times; fallback is explicitly an observation-time window", () => {
  const old = event("old", address(1), "buy", 100, "USD", "10m"), recent = event("recent", address(1), "buy", 10, "USD", "5s");
  assert.equal(analyze([old, recent]).events, 1); assert.equal(analyze([old, recent], {seconds: 300}).events, 1); assert.equal(analyze([old, recent], {seconds: 900}).events, 2);
  const unknownAge = event("unknown-age", address(1), "buy", 5, "USD", null);
  assert.equal(analyze([unknownAge]).basis, "observation-time");
  const mixed = analyze([old, recent, unknownAge]); assert.equal(mixed.excludedUntimed, 1); assert.equal(mixed.initialSyncEvents, 1);
  assert.equal(analyze([old, recent, unknownAge], {basis: "observation-time"}).events, 3);
  const coverage = {recordingStartedAt: now - 1000};
  assert.equal(analyze([recent], {coverage}).recordingCoversWindow, false); assert.equal(analyze([recent], {coverage}).partialCoverage, true);
});
test("Rounded age intervals crossing a window boundary remain explicit and estimates never drift on reread", () => {
  const a = event("a", address(1), "buy", 1, "USD", "1m");
  const result = analyze([a]); assert.equal(result.boundaryUncertain, 1);
  const boundary = event("b", address(1), "buy", 1, "USD", "0m");
  assert.equal(analyze([boundary], {now: now + 2000}).boundaryUncertain, 1);
});
test("Conflicting maker, side and same-currency amounts stay unavailable rather than selecting the newest hint", () => {
  const merged = T.mergeEvent(event("a"), event("a", address(2), "sell", 20));
  assert.equal(merged.makerAddress, null); assert.equal(merged.identityStatus, "conflicting"); assert.equal(merged.direction, "unknown"); assert.equal(merged.totals.USD.value, null);
  const result = analyze([merged]); assert.equal(result.events, 1); assert.equal(result.unresolvedEvents, 1); assert.equal(result.totalVolume, null);
});
test("Bounded memory and retention expose source-specific loss over the selected window", () => {
  const store = T.createStore({now: () => now, maxRecords: 2, retentionMs: 86400000});
  store.ingest([event("a"), event("b"), event("c")]);
  assert.equal(store.rows(context.tokenKey).length, 2); assert.equal(store.status(context.tokenKey).losses.length, 1);
  assert.equal(analyze(store.rows(context.tokenKey), {losses: store.status(context.tokenKey).losses}).losses.length, 1);
  store.ingest([event("expired", address(1), "buy", 5, "USD", "6s", now - 90000000)]);
  assert.equal(store.rows(context.tokenKey).length, 2);
});
test("Resolved context keys are stable; unknown pools and conflicts stay explicitly session isolated", () => {
  assert.equal(T.sourceContext(context, "other", 99).tokenKey, context.tokenKey);
  const incomplete = {...context, poolAddress: null};
  assert.notEqual(T.sourceContext(incomplete, "session-a", 1).tokenKey, T.sourceContext(incomplete, "session-b", 1).tokenKey);
  assert.equal(T.sourceContext({...context, conflict: "mismatch"}, "test", 1).identityStatus, "conflict");
  assert.throws(() => analyze([event("a"), {...event("b"), tokenKey: "other"}]), /one source/);
});
test("Invalid identities and timing cannot enter the event store", () => {
  const row = event("valid"); assert.equal(T.isEvent(row, now), true);
  for (const edit of [row => row.eventKey = null, row => row.makerAddress = "name", row => row.firstSeenAt = now + 1,
    row => row.estimatedTradeAt = now + 1, row => row.timing = null, row => row.context = {...context, tokenKey: "other"}, row => row.totals.USD.value = -1]) {
    const bad = structuredClone(row); edit(bad); assert.equal(T.isEvent(bad, now), false);
  }
});
test("Coverage merges session starts without resetting on heartbeats and distinguishes gaps from full history", () => {
  const a = {tokenKey: context.tokenKey, recordingStartedAt: now - 100000, lastReadAt: now - 1000, recordingSessionId: "a"};
  const b = {tokenKey: context.tokenKey, recordingStartedAt: now - 1000, lastReadAt: now, recordingSessionId: "b"};
  const merged = T.mergeCoverage(a, b);
  assert.equal(merged.recordingStartedAt, a.recordingStartedAt); assert.equal(merged.lastReadAt, now); assert.equal(merged.multipleRecordingSessions, true);
  assert.equal(analyze([event("a")], {coverage: merged}).partialCoverage, true);
  assert.equal(analyze([], {coverage: {...merged, recordingStartedAt: now - 1000000000}}).recordingDurationMs, T.RETENTION_MS);
});
module.exports = {event, context, now, address};
