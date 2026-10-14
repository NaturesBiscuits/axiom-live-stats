"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const Chart = require("../rollingChartCollector.js");
const context = key => ({sourceKey: key, routeKey: "https://axiom.trade/meme/" + key, blockchain: "solana", mintAddress: key});
function harness() {
  let time = 100000;
  const store = Chart.createStore({now: () => time});
  store.setToken(context("token-a"));
  return {store, set: value => { time = value; }, now: () => time};
}
test("display values parse numeric suffixes and units without inventing currencies", () => {
  assert.deepEqual(Chart.parseValue("$1,234.50"), {value: 1234.5, unit: "USD"});
  assert.deepEqual(Chart.parseValue("2.5M USD"), {value: 2500000, unit: "USD"});
  assert.deepEqual(Chart.parseValue("1e-6 SOL"), {value: 0.000001, unit: "SOL"});
  assert.deepEqual(Chart.parseValue("0"), {value: 0, unit: "unspecified"});
  assert.deepEqual(Chart.parseValue("$0.0₅123"), {value: 0.00000123, unit: "USD"});
  assert.deepEqual(Chart.parseValue("$0.0₁₂45"), {value: 0.00000000000045, unit: "USD"});
  assert.deepEqual(Chart.parseValue("0.0₄789 SOL"), {value: 0.0000789, unit: "SOL"});
  for (const raw of ["$1 +5%", "NaN", "1,23", "$3 SOL", "$0.0₀123", "-1", "1e999", "1e-999"]) assert.equal(Chart.parseValue(raw), null);
});
test("one sample per aligned second carries identity, value, unit and observation freshness", () => {
  const h = harness();
  h.store.observe("price", {value: 1.25, unit: "USD"}, 100000);
  const packet = h.store.tick(100175);
  const row = packet.series.price.samples[0];
  assert.equal(row.timestamp, 100);
  assert.equal(row.value, 1.25); assert.equal(row.sourceAgeMs, 175);
  assert.equal(row.samplingDelayMs, 175); assert.equal(row.source, "axiom-dom-sample");
  assert.equal(row.tokenIdentity.mintAddress, "token-a");
  assert.equal(row.stale, false); assert.equal(row.gap, false);
  assert.equal(h.store.tick(100900), null, "Duplicate timer calls do not create duplicate slots");
  assert(!("high" in row) && !("volume" in row), "DOM samples never pretend to be OHLCV");
});
test("values become null after five seconds without an observation; repeated values can be observed honestly", () => {
  const h = harness();
  h.store.observe("price", {value: 1, unit: "USD"});
  h.store.tick(100000);
  const stale = h.store.tick(106000).series.price.samples.at(-1);
  assert.equal(stale.value, null); assert.equal(stale.sourceFreshness, "stale");
  h.store.observe("price", {value: 1, unit: "USD"}, 107000);
  assert.equal(h.store.tick(107000).series.price.samples[0].value, 1);
  h.store.invalidate("price");
  assert.equal(h.store.tick(108000).series.price.samples[0].sourceFreshness, "missing");
});
test("timer throttling produces null gap slots and measured delay, never backward-filled movement", () => {
  const h = harness();
  h.store.observe("price", {value: 1, unit: "USD"}); h.store.tick(100000);
  h.store.observe("price", {value: 2, unit: "USD"}, 106100);
  const rows = h.store.tick(106175, true).series.price.samples;
  assert.equal(rows.length, 6);
  assert(rows.slice(0, -1).every(row => row.gap && row.value === null && row.observedAt === null));
  assert.equal(rows.at(-1).value, 2); assert.equal(rows.at(-1).samplingDelayMs, 5175);
  assert.equal(rows.at(-1).sourceHidden, true);
});
test("15-minute window is exactly 900 time slots and long sleeps stay bounded", () => {
  const h = harness();
  for (let index = 0; index < 1800; index++) {
    const at = 100000 + index * 1000;
    h.store.observe("price", {value: index, unit: "USD"}, at); h.store.tick(at);
  }
  let history = h.store.get("token-a", 1899000);
  assert.equal(history.series.price.samples.length, 900);
  assert.equal(history.series.price.samples[0].timestamp, 1000);
  h.store.tick(1000000000);
  history = h.store.get("token-a", 1000000000);
  assert.equal(history.series.price.samples.length, 900);
  assert.equal(history.series.price.samples.filter(row => row.gap).length, 899);
});
test("tokens, price/market-cap and units remain isolated; returning to a token preserves its history", () => {
  const h = harness();
  h.store.observe("price", {value: 1, unit: "USD"});
  h.store.observe("marketCap", {value: 100, unit: "USD"}); h.store.tick(100000);
  h.store.setToken(context("token-b"));
  h.store.observe("price", {value: 2, unit: "USD"}, 101000); h.store.tick(101000);
  assert.equal(h.store.get("token-a").series.price.samples[0].value, 1);
  assert.equal(h.store.get("token-a").series.marketCap.samples[0].value, 100);
  h.store.setToken(context("token-a"));
  const returning = h.store.tick(102000).series.price.samples.at(-1);
  assert.equal(returning.value, null, "Old token observations cannot seed a live value on return");
  h.store.observe("price", {value: 3, unit: "SOL"}, 103000); h.store.tick(103000);
  assert.equal(h.store.get("token-a", 103000).series.price.samples.length, 1, "New unit starts a clean series");
  for (let index = 0; index < 10; index++) h.store.setToken(context("token-" + index));
  assert.equal(h.store.snapshot().length, 4, "Bounded retained token histories");
});
test("compact persistence restores history without restoring live freshness; merge is ordered and idempotent", () => {
  const h = harness();
  h.store.observe("price", {value: 1, unit: "USD"});
  const packet = h.store.tick(100000);
  const saved = h.store.serialize(100000);
  assert.equal(saved[0].series.price.samples[0].tokenIdentity, undefined);
  const restored = Chart.createStore({now: () => 101000});
  restored.restore(saved);
  assert.equal(restored.get("token-a").series.price.samples[0].tokenIdentity.mintAddress, "token-a");
  assert.equal(restored.get("token-a").lastReceivedAt, 100000);
  assert.equal(restored.get("token-a").restored, true);
  restored.setToken(context("token-a"));
  assert.equal(restored.tick(101000).series.price.samples[0].value, null);
  const merged = Chart.createStore({now: () => 100000});
  merged.merge(packet); merged.merge(packet);
  assert.equal(merged.get("token-a").series.price.samples.length, 1);
});
test("sample exports retain null gaps and freshness metadata with no fabricated candle fields", () => {
  const h = harness(); h.store.observe("price", {value: 1, unit: "USD"}); h.store.tick(100000); h.store.tick(103000);
  const series = h.store.get("token-a", 103000).series.price;
  const records = Chart.toJSONL(series).split("\n").map(JSON.parse);
  assert.equal(records.length, 4); assert.equal(records[1].value, null); assert.equal(records[1].gap, true);
  assert.equal(records[0].mintAddress, "token-a"); assert.equal(records[0].unit, "USD");
  assert(!("volume" in records[0])); assert(Chart.toCSV(series).startsWith("timestamp,tokenKey,blockchain,"));
});

test("missing deliveries across separate content scripts are explicit null slots", () => {
  const producer = harness(), receiver = Chart.createStore({now: () => 103000});
  producer.store.observe("price", {value: 1, unit: "USD"});
  receiver.merge(producer.store.tick(100000), 100000);
  const restarted = Chart.createStore({now: () => 103000}); restarted.setToken(context("token-a"));
  restarted.observe("price", {value: 2, unit: "USD"});
  receiver.merge(restarted.tick(103000), 103000);
  const rows = receiver.get("token-a").series.price.samples;
  assert.equal(rows.length, 4);
  assert(rows.slice(1, 3).every(row => row.value === null && row.gap && row.reason === "no-sample-received"));
});

test("successful unchanged DOM reads keep source freshness separate from numeric changes", () => {
  const h = harness();
  h.store.observe("price", {value: 0.00000123, unit: "USD"}, 100000);
  h.store.tick(100000);
  h.store.observe("price", {value: 0.00000123, unit: "USD"}, 110000, {domUpdatedAt: 109900});
  const row = h.store.tick(110175).series.price.samples.at(-1);
  assert.equal(row.value, 0.00000123); assert.equal(row.sourceFreshness, "fresh");
  assert.equal(row.domReadAt, 110000); assert.equal(row.valueChangedAt, 100000);
  assert.equal(row.domUpdatedAt, 109900); assert.equal(row.sampledAt, 110175); assert.equal(row.deliveredAt, null);
  h.store.observe("price", null, 111000);
  h.store.observe("price", {value: 0.00000123, unit: "USD"}, 112000);
  assert.equal(h.store.tick(112000).series.price.samples.at(-1).valueChangedAt, 100000, "Unavailable reads do not invent a numeric change on recovery");
  h.store.observe("price", {value: 0.00000124, unit: "USD"}, 113000);
  assert.equal(h.store.tick(113000).series.price.samples.at(-1).valueChangedAt, 113000);
});
