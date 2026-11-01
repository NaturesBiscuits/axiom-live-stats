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
const ordinary = url => response(url.includes("/ohlcv/") ? {...candlesBody([[1791924720, 10, 13, 8, 12, 500]]),
  ...(url.includes("token=quote") ? {meta: {base: {address: QUOTE}, quote: {address: MINT}}} : {})} : poolBody());

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

test("untyped routes, pool-base defaults and silent highest-liquidity selection cannot establish a selection", async () => {
  const h = harness(ordinary);
  await assert.rejects(() => h.collector.collect({blockchain: "solana", routeAddress: POOL}), /token.*address/);
  await assert.rejects(() => h.collector.collect({blockchain: "solana", mintAddress: MINT}), /Find pools/);
  await assert.rejects(() => h.collector.collect({blockchain: "solana", poolAddress: POOL}), /token.*address/);
  assert.equal(h.calls.length, 0);
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

test("successful refresh respects current provider gaps instead of resurrecting previously returned candles", async () => {
  let later = false;
  const h = harness(url => response(url.includes("/ohlcv/") ? candlesBody(later ?
    [[1791924720, 1, 3, 1, 2, 5]] : [[1791924780, 2, 4, 2, 3, 6]]) : poolBody()));
  const initial = await h.collector.collect(context);
  assert.equal(initial.candles[0].finalized, false);
  h.advance(61000); later = true;
  const updated = await h.collector.collect(context);
  assert.equal(updated.candles.length, 1);
  assert(updated.candles.every(row => row.finalized));
  assert.equal(updated.candles[0].close, 2, "Only the latest provider response supplies successful refresh results");
});

test("pool discovery returns verified candidates with liquidity zeros and missing values, without selecting a pool", async () => {
  const second = "11111111111111111111111111111111";
  const a = poolBody().data, b = poolBody(second).data; a.attributes.reserve_in_usd = "0"; b.attributes.reserve_in_usd = null;
  const h = harness(() => response({data: [a, b, a, {...poolBody().data, id: "eth_" + POOL}]}));
  const found = await h.collector.findPools(context);
  assert.equal(found.candidates.length, 2); assert.equal(found.candidates[0].liquidityUSD, 0); assert.equal(found.candidates[1].liquidityUSD, null);
  assert.equal(found.poolAddress, undefined); assert.equal(found.rejectedPools, 1);
  assert(h.calls[0].url.includes(`/tokens/${MINT}/pools`)); assert.equal((await h.collector.findPools(context)).cacheHit, true);
  assert.equal(h.calls.length, 1); assert.equal(h.saved.chartCache, undefined);
});
test("wrong-network pool IDs and token relationships fail verification", async () => {
  const badPool = poolBody(); badPool.data.id = "eth_" + POOL;
  await assert.rejects(() => harness(() => response(badPool)).collector.collect(context), /metadata could not verify/);
  const badToken = poolBody(); badToken.data.relationships.quote_token.data.id = "eth_" + QUOTE;
  await assert.rejects(() => harness(() => response(badToken)).collector.collect(context), /metadata could not verify/);
  await assert.rejects(() => harness(() => response(poolBody(POOL, MINT, MINT))).collector.collect(context), /metadata could not verify/);
});
test("null volume remains missing, zero remains zero and tiny OHLC prices retain full numeric precision", () => {
  const body = candlesBody([[1791924720, 1e-30, 3e-30, 0, 2e-30, null], [1791924780, 0, 2e-30, 0, 1e-30, 0]]);
  const result = Chart.normalizeCandles(body, 1791924810000);
  assert.equal(result.candles.length, 2); assert.equal(result.candles[0].volume, null); assert.equal(result.candles[1].volume, 0);
  assert.equal(result.candles[0].open, 1e-30); assert.equal(result.candles[1].finalized, false);
});
test("period summaries account for missing intervals, zero open, partial volume and incomplete candles", () => {
  const metadata = {fetchedAt: 1791924810000};
  const candles = Chart.normalizeCandles(candlesBody([[1791924720, 0, 3, 0, 2, null], [1791924780, 2, 4, 1, 3, 0]]), metadata.fetchedAt).candles;
  const s = Chart.summarize({metadata, candles}, 900);
  assert.equal(s.firstOpen, 0); assert.equal(s.latestClose, 3); assert.equal(s.changePercent, null);
  assert.equal(s.highest, 4); assert.equal(s.lowest, 0); assert.equal(s.volume, 0); assert.equal(s.missingVolumes, 1);
  assert.equal(s.missingIntervals, 13); assert.equal(s.incomplete, 1); assert.equal(s.complete, false);
  const empty = Chart.summarize({metadata, candles: []}, 3600); assert.equal(empty.volume, null); assert.equal(empty.missingIntervals, 60);
});
test("malformed JSON, malformed candidate lists and empty indexed history are distinct", async () => {
  await assert.rejects(() => harness(() => new Response("oops")).collector.findPools(context), /malformed JSON/);
  await assert.rejects(() => harness(() => response({data: null})).collector.findPools(context), /malformed candidate/);
  assert.deepEqual((await harness(() => response({data: []})).collector.findPools(context)).candidates, []);
});
test("explicit refresh bypasses the local candle TTL but still paces requests; aborted cached calls cannot succeed", async () => {
  const h = harness(ordinary); await h.collector.collect(context);
  await h.collector.collect(context, {force: true}); assert.equal(h.calls.length, 3);
  assert(h.calls[2].at - h.calls[1].at >= Chart.REQUEST_GAP);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => h.collector.collect(context, {signal: controller.signal}), /abort/i);
  await assert.rejects(() => h.collector.findPools(context, {signal: controller.signal}), /abort/i);
});
test("export includes exact UTC time, side, currency, selected period, stale state and missing-volume status", () => {
  const dataset = {stale: true, metadata: {quoteCurrency: "USD", volumeCurrency: "USD", tokenSide: "quote", selectedPeriodSeconds: 900},
    candles: [{timestamp: 60, open: 0, high: 2e-30, low: 0, close: 1e-30, volume: null, finalized: false}]};
  const row = Chart.records(dataset, true)[0]; assert.equal(row.timestampUTC, "1970-01-01T00:01:00.000Z");
  assert.equal(row.incomplete, true); assert.equal(row.intervalStatus, "incomplete"); assert.equal(row.tokenSide, "quote");
  assert.equal(row.stale, true); assert.equal(row.volume, null); assert.equal(row.volumeAvailable, false); assert.equal(row.selectedPeriodSeconds, 900);
});
test("EVM bytes32 pool IDs are accepted as pools without ever accepting them as token addresses", async () => {
  const mint = "0x" + "1".repeat(40), quote = "0x" + "2".repeat(40), pool = "0x" + "3".repeat(64);
  assert.equal(Chart.isPoolAddress(pool, "eth"), true); assert.equal(Chart.isAddress(pool, "eth"), false);
  const h = harness(url => response(url.includes("/ohlcv/") ? {data: {attributes: {ohlcv_list: []}}} : {data: {
    id: `eth_${pool}`, attributes: {address: pool}, relationships: {base_token: {data: {id: `eth_${mint}`}}, quote_token: {data: {id: `eth_${quote}`}}}}}));
  const data = await h.collector.collect({blockchain: "eth", mintAddress: mint, poolAddress: pool});
  assert.equal(data.metadata.poolAddress, pool); assert.equal(data.metadata.mintAddress, mint);
});
test("quote OHLCV metadata must identify the selected quote token in response base, not the original pool base", async () => {
  const h = harness(url => response(url.includes("/ohlcv/") ? candlesBody([[1791924720, 1, 3, 1, 2, 5]]) : poolBody()));
  await assert.rejects(() => h.collector.collect({...context, mintAddress: QUOTE}), /does not match the selected token/);
  const missing = harness(url => response(url.includes("/ohlcv/") ? {data: {attributes: {ohlcv_list: [[1791924720, 1, 3, 1, 2, 5]]}}} : poolBody()));
  await assert.rejects(() => missing.collector.collect(context), /metadata may be missing/);
});
test("optional provider valuations retain actual raw fields, pool-base identity and original metadata time through cache and failures", async () => {
  let failing = false;
  const h = harness(url => {
    if (failing) return new Response("{}", {status: 503});
    if (url.includes("/ohlcv/")) return ordinary(url);
    const body = poolBody(); body.data.attributes.market_cap_usd = "9007199254740993.01"; body.data.attributes.fdv_usd = null;
    return response(body);
  });
  const first = await h.collector.collect(context), source = first.metadata.providerValuations;
  assert.equal(source.fields.market_cap_usd, "9007199254740993.01"); assert.equal(source.fields.fdv_usd, null);
  assert.equal(source.mintAddress, MINT); assert(source.fetchedAt < first.metadata.fetchedAt);
  h.advance(61000); const quote = await h.collector.collect({...context, mintAddress: QUOTE});
  assert.equal(quote.metadata.providerValuations.mintAddress, MINT, "Pool-base valuation is never relabeled as a quote-token valuation");
  assert.equal(quote.metadata.providerValuations.fetchedAt, source.fetchedAt, "Fresh candles do not renew cached valuation timestamps");
  failing = true; h.advance(61000); await assert.rejects(() => h.collector.collect(context), /503/);
  assert.equal((await h.collector.cached(context)).metadata.providerValuations.fields.market_cap_usd, source.fields.market_cap_usd);
});
