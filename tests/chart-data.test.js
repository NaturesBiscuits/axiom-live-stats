"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const Chart = require("../chartDataCollector.js");
const POOL = "AnrCHvfJUzMtos8DGjpT2XKurVPPYAVLDturASNwXcd4";
const MINT = "CQCDTp8rsFV3PhaPeYjcCW5LdGTxi6jFx7eC3UXnpump";
const QUOTE = "So11111111111111111111111111111111111111112";
const poolBody = (pool = POOL, base = MINT, quote = QUOTE) => ({data: {
  attributes: {address: pool, reserve_in_usd: "1000"},
  relationships: {base_token: {data: {id: "solana_" + base}}, quote_token: {data: {id: "solana_" + quote}}}
}});
const candlesBody = rows => ({data: {attributes: {ohlcv_list: rows}}, meta: {base: {address: MINT}, quote: {address: QUOTE}}});
const context = {sourceKey: "token-a", blockchain: "solana", poolAddress: POOL, mintAddress: MINT};
function harness(responder, saved = {}) {
  let clock = 1791924810000;
  const calls = [];
  const storage = {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, saved[key]])),
    set: async values => Object.assign(saved, structuredClone(values))
  };
  const options = {storage, now: () => clock, sleep: async ms => { clock += ms; },
    fetchImpl: async (url, options) => {
      calls.push({url, options, at: clock});
      return responder(url, calls.length);
    }};
  return {collector: Chart.createCollector(options), options, calls, saved, advance: ms => { clock += ms; }};
}
const response = body => new Response(JSON.stringify(body), {status: 200, headers: {"Content-Type": "application/json"}});
const ordinary = url => response(url.includes("/ohlcv/") ? candlesBody([[1791924720, 10, 13, 8, 12, 500]]) : poolBody());

test("normalization validates documented OHLCV ordering, sort, duplicates, UTC seconds and interval state", () => {
  const rows = [[1791924780, 10, 13, 8, 12, 5], [1791924720, 20, 23, 18, 22, 6],
    [1791924720, 21, 24, 19, 23, 7], [1791924600, 10, 2, 8, 12, 5],
    [1791924600000, 10, 13, 8, 12, 5], [1791924660, "10", 13, 8, 12, 5],
    [1791924540, 10, 13, 8, 12, -1]];
  const normalized = Chart.normalizeCandles(candlesBody(rows), 1791924810000);
  assert.equal(normalized.rejectedRows, 4);
  assert.deepEqual(normalized.candles, [
    {timestamp: 1791924720, open: 21, high: 24, low: 19, close: 23, volume: 7, finalized: true},
    {timestamp: 1791924780, open: 10, high: 13, low: 8, close: 12, volume: 5, finalized: false}
  ]);
  assert.throws(() => Chart.normalizeCandles({}), /no OHLCV/);
});

test("collector verifies separate mint/pool, requests price USD with correct token side, caches and persists", async () => {
  const h = harness(ordinary);
  const dataset = await h.collector.collect(context);
  assert.equal(dataset.metadata.mintAddress, MINT);
  assert.equal(dataset.metadata.poolAddress, POOL);
  assert.equal(dataset.metadata.valueType, "price");
  assert.equal(dataset.metadata.quoteCurrency, "USD");
  assert.equal(dataset.metadata.volumeCurrency, "USD");
  const url = new URL(h.calls[1].url);
  assert.equal(url.searchParams.get("token"), "base");
  assert.equal(url.searchParams.get("aggregate"), "1");
  assert.equal(h.calls[1].options.credentials, "omit");
  assert(h.calls[1].at - h.calls[0].at >= 6500);
  assert.equal((await h.collector.collect(context)).cacheHit, true);
  assert.equal(h.calls.length, 2);
  const restarted = Chart.createCollector(h.options);
  assert.equal((await restarted.collect(context)).cacheHit, true);
  h.advance(61000);
  await restarted.collect(context);
  assert.equal(h.calls.length, 4, "Restart validates metadata once before stale OHLCV fetch");
});

test("quote-token selection requests quote OHLCV; unrelated and identical token/pool addresses rejected", async () => {
  const h = harness(ordinary);
  const result = await h.collector.collect({...context, mintAddress: QUOTE});
  assert.equal(result.metadata.tokenSide, "quote");
  assert(h.calls.at(-1).url.includes("token=quote"));
  await assert.rejects(() => h.collector.collect({...context, mintAddress: "11111111111111111111111111111111"}), /not a token/);
  await assert.rejects(() => h.collector.collect({...context, mintAddress: POOL}), /must be different/);
});

test("untyped Axiom route is verified as pool; mint routes discover a labeled API fallback", async () => {
  const routePool = harness(ordinary);
  const result = await routePool.collector.collect({sourceKey: "route", blockchain: "solana", routeAddress: POOL});
  assert.equal(result.metadata.poolSelection, "axiom-route-verified-pool");
  assert.equal(result.metadata.mintAddress, MINT);
  const routeMint = harness(url => {
    if (url.includes(`/pools/${MINT}?`)) return new Response("{}", {status: 404});
    if (url.includes(`/tokens/${MINT}/pools`)) return response({data: [poolBody().data]});
    return ordinary(url);
  });
  const fallback = await routeMint.collector.collect({sourceKey: "mint-route", blockchain: "solana", routeAddress: MINT});
  assert.equal(fallback.metadata.mintAddress, MINT);
  assert.equal(fallback.metadata.poolAddress, POOL);
  assert.equal(fallback.metadata.poolSelection, "geckoterminal-top-pool-fallback");
  assert.equal(fallback.metadata.tokenSelection, "axiom-route-verified-mint");
});

test("1-second requests and conflicting metadata fail without fabricated data", async () => {
  const h = harness(ordinary);
  await assert.rejects(() => h.collector.collect(context, {timeframe: "1s"}), /1-second.*unsupported/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(() => h.collector.collect({...context, conflict: "Identity mismatch"}), /Identity mismatch/);
  assert.equal(h.calls.length, 0);
  const inconsistent = harness(url => response(url.includes("/ohlcv/") ? {...candlesBody([[1791924720, 1, 3, 1, 2, 5]]), meta: {base: {address: QUOTE}}} : poolBody()));
  await assert.rejects(() => inconsistent.collector.collect(context), /does not match/);
  assert.equal(inconsistent.saved.chartCache, undefined);
});

test("429 Retry-After cooldown survives worker restart and cached data is retained", async () => {
  let limited = false;
  const h = harness(url => limited ? new Response("{}", {status: 429, headers: {"Retry-After": "120"}}) : ordinary(url));
  await h.collector.collect(context);
  h.advance(61000); limited = true;
  let error;
  try { await h.collector.collect(context); } catch (caught) { error = caught; }
  assert.equal(error.status, 429);
  const requests = h.calls.length;
  const restarted = Chart.createCollector(h.options);
  await assert.rejects(() => restarted.collect(context), /cooling down/);
  assert.equal(h.calls.length, requests);
  assert.equal(h.saved.chartApiBudget.cooldownUntil, error.retryAt);
  assert.equal((await restarted.cached(context)).candles.length, 1);
});

test("empty pool responses are valid; malformed OHLCV and inaccessible API are explicit errors", async () => {
  const empty = harness(url => response(url.includes("/ohlcv/") ? candlesBody([]) : poolBody()));
  assert.equal((await empty.collector.collect(context)).candles.length, 0);
  const invalid = harness(url => response(url.includes("/ohlcv/") ? candlesBody([[1791924720, 10, 1, 8, 12, 5]]) : poolBody()));
  await assert.rejects(() => invalid.collector.collect(context), /All returned OHLCV/);
  const denied = harness(() => new Response("{}", {status: 403}));
  await assert.rejects(() => denied.collector.collect(context), /HTTP 403/);
  assert.equal(denied.calls.length, 1, "No alternate access path or bypass attempt");
});

test("JSONL/CSV keep numeric candles, metadata and interval state; unfinished candles excluded by default", () => {
  const dataset = {metadata: {blockchain: "solana", mintAddress: MINT, poolAddress: POOL,
    timeframe: "1m", intervalSeconds: 60, quoteCurrency: "USD", valueType: "price", dataSource: 'Source, "quoted"'},
    candles: [{timestamp: 60, open: 1, high: 3, low: 1, close: 2, volume: 5, finalized: true},
      {timestamp: 120, open: 2, high: 4, low: 2, close: 3, volume: 6, finalized: false}]};
  const rows = Chart.toJSONL(dataset).split("\n").map(JSON.parse);
  assert.equal(rows.length, 1); assert.equal(rows[0].open, 1); assert.equal(rows[0].valueType, "price");
  assert.equal(Chart.toJSONL(dataset, true).split("\n").length, 2);
  const csv = Chart.toCSV(dataset, true);
  assert(csv.startsWith("timestamp,open,high,low,close,volume,finalized,"));
  assert(csv.includes('"Source, ""quoted"""'));
});

test("persistent cache retains only four datasets and 500 chronologically sorted candles each", async () => {
  const rows = Array.from({length: 700}, (_, index) => [1791924720 - index * 60, 1, 3, 1, 2, 5]);
  const h = harness(url => response(url.includes("/ohlcv/") ? candlesBody(rows) : poolBody()));
  for (let index = 0; index < 6; index++) await h.collector.collect({...context, sourceKey: "token-" + index});
  assert.equal(h.saved.chartCache.length, 4);
  assert(h.saved.chartCache.every(dataset => dataset.candles.length === 500));
  assert(h.saved.chartCache.every(dataset => dataset.candles.every((row, index, rows) => !index || row.timestamp > rows[index - 1].timestamp)));
});

test("retained incomplete intervals become closed after a successful later fetch, even across response gaps", async () => {
  let later = false;
  const h = harness(url => response(url.includes("/ohlcv/") ? candlesBody(later ?
    [[1791924720, 1, 3, 1, 2, 5]] : [[1791924780, 2, 4, 2, 3, 6]]) : poolBody()));
  const initial = await h.collector.collect(context);
  assert.equal(initial.candles[0].finalized, false);
  h.advance(61000); later = true;
  const updated = await h.collector.collect(context);
  assert.equal(updated.candles.length, 2);
  assert(updated.candles.every(row => row.finalized));
  assert.equal(updated.candles[1].close, 3, "Retained prices remain provider observations");
});
