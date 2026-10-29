"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const H = require("../liquidityHistory.js");
const start = 1700000000000;
const context = {sourceKey: "solana:mint:pool-a", blockchain: "solana", mintAddress: "mint", poolAddress: "pool-a", routeKey: "route"};
function recorder(ctx = context, sessionId = "test") {
  const r = H.createRecorder({sessionId}); r.setContext(ctx); return r;
}
function sample(r, seconds, text = "$5.56K", status = "read") {
  const at = start + seconds * 1000;
  return r.sample(() => ({displayText: text, domReadAt: at, status}), at);
}
test("liquidity amounts preserve text/currency and accurately parse displayed suffixes", () => {
  for (const [raw, value, unit] of [["$5.56K", 5560, "USD"], ["$1.2M", 1200000, "USD"], ["1,234.56 USD", 1234.56, "USD"],
    ["0 SOL", 0, "SOL"], ["€2.5K", 2500, "EUR"], ["£1B", 1e9, "GBP"], ["1.5 ETH", 1.5, "ETH"], ["20", 20, "unspecified"],
    ["$1.001K", 1001, "USD"], ["1.001K ETH", 1001, "ETH"]]) {
    assert.deepEqual(H.parseAmount(raw), {displayText: raw, value, unit, status: "valid"});
  }
  assert.equal(H.parseAmount("$bad").unit, "USD");
  assert.equal(H.parseAmount("$1M SOL").status, "invalid");
  assert.equal(H.parseAmount("$-5K").value, null);
});
test("missing and invalid attempts stay distinct from valid zero", () => {
  for (const text of [null, "", "—", "N/A"]) assert.equal(H.parseAmount(text).status, "missing");
  for (const text of ["loading", "$oops", "$1,2K", "$1e999", "$1e-999"]) assert.equal(H.parseAmount(text).status, "invalid");
  assert.equal(H.parseAmount("$0").status, "valid");
});
test("young coins record immediately with no age gate or API and unchanged reads remain observations", () => {
  const r = recorder({...context, tokenAgeSeconds: 2});
  const a = sample(r, 0), b = sample(r, 5);
  assert.equal(a.value, 5560); assert.equal(b.value, a.value);
  assert.equal(b.observedAt - a.observedAt, 5000);
  assert.equal(b.displayText, "$5.56K"); assert.equal(b.tokenIdentity.poolAddress, "pool-a");
  const summary = H.analyze([a, b], start + 5000);
  assert.equal(summary.durationMs, 5000); assert.equal(summary.sinceStart, 0); assert.equal(summary.coverage, 1);
});
test("fresh reads execute only when due; snapshots and capturedAt cannot create observations", () => {
  const r = recorder(); let reads = 0;
  const read = () => { reads++; return {displayText: "$1K", domReadAt: start}; };
  assert(r.sample(read, start));
  for (let ms = 1; ms < 5000; ms += 100) assert.equal(r.sample(read, start + ms), null);
  assert.equal(reads, 1);
  assert.equal(r.delay(start + 4990), 50);
  assert.equal(r.delay(start + 1000), 4000);
  assert.equal(H.isAttempt({capturedAt: start, stats: {liquidity: "$1K"}}, start), false);
});
test("delayed timers produce one actual attempt and reduced coverage, never replay missed intervals", () => {
  const r = recorder(), rows = [sample(r, 0), sample(r, 5), sample(r, 26)];
  assert.deepEqual(rows.map(row => row.sampledAt - start), [0, 5000, 26000]);
  assert.equal(sample(r, 27), null);
  assert.equal(H.analyze(rows, start + 26000).coverage, 3 / 6);
  assert.deepEqual(H.segments(rows).map(group => group.length), [2, 1]);
});
test("missing/invalid attempts break lines and never replace unavailable values with zero", () => {
  const r = recorder(), rows = [sample(r, 0), sample(r, 5, null), sample(r, 10, "$bad"), sample(r, 15)];
  assert.deepEqual(rows.map(row => row.status), ["valid", "missing", "invalid", "valid"]);
  assert.equal(rows[1].value, null); assert.equal(rows[1].observedAt, null);
  assert.equal(rows[2].unit, "USD"); assert.equal(H.segments(rows).length, 2);
  assert.equal(H.analyze(rows.filter(row => row.unit === "USD"), start + 15000).observations, 2);
});
test("short recordings never claim complete 30s, 1m, 5m or 15m changes", () => {
  const r = recorder(), rows = [sample(r, 0), sample(r, 5), sample(r, 10)];
  const result = H.analyze(rows, start + 10000);
  for (const seconds of [30, 60, 300, 900]) {
    assert.equal(result.windows[seconds].status, "Collecting history");
    assert.equal(result.windows[seconds].change, null);
  }
  rows.push(sample(r, 30));
  assert.equal(H.analyze(rows, start + 30000).windows[30].change, 0);
  assert.equal(H.analyze(rows, start + 30000).windows[300].status, "Collecting history");
});
test("baseline tolerance is inclusive ±2.5s with a full recording and excludes values outside it", () => {
  assert.equal(H.TOLERANCE_MS, 2500);
  for (const [baselineSecond, available] of [[27.5, true], [32.5, true], [27.499, false], [32.501, false]]) {
    const r = recorder(), rows = [sample(r, 0, "$100"), sample(r, baselineSecond, "$100"), sample(r, 60, "$110")];
    const window = H.analyze(rows, start + 60000).windows[30];
    assert.equal(window.status, available ? "available" : "Insufficient data");
    if (available) assert(Math.abs(window.change - 10) < 1e-10);
  }
  const r = recorder();
  assert.equal(H.analyze([sample(r, 0), sample(r, 27.5)], start + 27500).windows[30].status, "Collecting history");
});
test("all four windows use their own valid baseline and reject zero denominators", () => {
  const r = recorder(), rows = [];
  for (let second = 0; second <= 900; second += 5) rows.push(sample(r, second, `$${100 + second}`));
  const result = H.analyze(rows, start + 900000);
  for (const second of [30, 60, 300, 900]) {
    assert.equal(result.windows[second].baseline.sampledAt, start + (900 - second) * 1000);
    assert.equal(result.windows[second].status, "available");
  }
  const zero = recorder(), summary = H.analyze([sample(zero, 0, "$0"), sample(zero, 30, "$10")], start + 30000);
  assert.equal(summary.sinceStart, null); assert.equal(summary.windows[30].change, null);
  assert.equal(summary.windows[30].status, "Insufficient data");
});
test("network/token/pool changes isolate series, including same-route migrations", () => {
  const r = recorder(), first = sample(r, 0);
  for (const next of [{...context, sourceKey: "new-pool", poolAddress: "pool-b"}, {...context, sourceKey: "network", blockchain: "eth"},
    {...context, sourceKey: "new-token", mintAddress: "mint-b"}]) {
    r.setContext(next); const row = sample(r, 1);
    assert.notEqual(row.tokenKey, first.tokenKey); assert.equal(row.tokenIdentity.poolAddress, next.poolAddress);
    assert.equal(H.segments([first, row]).length, 2);
  }
  const a = recorder(), usd = sample(a, 0), sol = sample(a, 5, "1 SOL");
  assert.notEqual(H.seriesKey(usd), H.seriesKey(sol));
  assert.throws(() => H.analyze([usd, sol]), /one token\/pool\/currency/);
});
test("unresolved pools remain explicit and isolated across page sessions; conflicts cannot become observations", () => {
  const unresolved = {...context, poolAddress: null};
  const a = recorder(unresolved, "page-a"), b = recorder(unresolved, "page-b");
  assert.notEqual(a.context().tokenKey, b.context().tokenKey);
  assert.equal(a.context().identityStatus, "unresolved"); assert.equal(sample(a, 0).tokenIdentity.poolAddress, null);
  const conflict = recorder({...context, conflict: "ambiguous"});
  assert.equal(sample(conflict, 0).status, "identity-conflict");
  assert.equal(sample(conflict, 5).value, null);
});
test("waiting on stale previous-token DOM cannot produce a valid observation", () => {
  const r = recorder();
  const row = sample(r, 0, "$5.56K", "awaiting-token");
  assert.equal(row.status, "awaiting-token"); assert.equal(row.value, null); assert.equal(row.observedAt, null);
});
test("merged persistence preserves original timestamps and never lets older duplicates overwrite newer reads", () => {
  const r = recorder(), a = sample(r, 0), b = sample(r, 5);
  const restored = JSON.parse(JSON.stringify([a, b]));
  assert.deepEqual(H.mergeRows(restored, [a]), [a, b]);
  assert.equal(H.mergeRows(restored, [{...b, sampledAt: b.sampledAt - 1, value: 9}]).at(-1).value, 5560);
  assert.equal(H.mergeRows(restored).at(-1).observedAt, start + 5000);
  assert.equal(H.analyze(restored, start + 600000).coverage, 1, "Recorded-period coverage does not imply current connection");
});
test("record validation rejects stale reads, impossible timestamps and invalid zero conversions", () => {
  const row = sample(recorder(), 0);
  assert(H.isAttempt(row, start));
  assert(!H.isAttempt({...row, domReadAt: start - 5000}, start));
  assert(!H.isAttempt({...row, status: "missing", value: 0}, start));
  assert(!H.isAttempt({...row, status: "valid", value: null, observedAt: null}, start));
  assert(!H.isAttempt({...row, tokenIdentity: null}, start));
  assert(!H.isAttempt({...row, sampledAt: start + 5000}, start));
  assert(!H.isAttempt({...row, timestamp: row.timestamp + 1}, start));
});
