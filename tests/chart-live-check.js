// Opt-in real public API validation; no Axiom credentials or session access.
"use strict";
const assert = require("node:assert/strict");
const {createCollector, normalizeCandles, API} = require("../chartDataCollector.js");
const blockchain = process.env.GECKO_TEST_NETWORK || "eth";
const poolAddress = process.env.GECKO_TEST_POOL || "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640";
const mintAddress = process.env.GECKO_TEST_MINT || "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
(async () => {
  const observed = [];
  const requests = [];
  const collector = createCollector({fetchImpl: async (url, options) => {
    const response = await fetch(url, options);
    requests.push({url, status: response.status});
    if (response.ok && url.includes("/ohlcv/")) observed.push(await response.clone().json());
    return response;
  }});
  const candidates = await collector.findPools({blockchain, mintAddress});
  assert(candidates.candidates.length > 0, "Actual token-pools endpoint must return verified candidates");
  // An explicit known pool is supplied; discovery never chooses one on the user's behalf.
  const dataset = await collector.collect({sourceKey: "live-validation", blockchain, poolAddress, mintAddress});
  assert(dataset.candles.length > 0, "Real pool must return candles");
  assert.notEqual(dataset.metadata.mintAddress, dataset.metadata.poolAddress);
  const raw = observed[0].data.attributes.ohlcv_list;
  assert(raw.every(row => Array.isArray(row) && row.length === 6), "Six API fields in each candle");
  const checked = normalizeCandles(observed[0], dataset.metadata.fetchedAt);
  assert.equal(checked.rejectedRows, 0, "All real candle rows validate");
  for (const row of dataset.candles) {
    const source = raw.find(item => item[0] === row.timestamp);
    assert.deepEqual([row.timestamp, row.open, row.high, row.low, row.close, row.volume], source,
      "Exact documented [timestamp, open, high, low, close, volume] mapping");
  }
  assert(dataset.candles.every((row, index, rows) => !index || rows[index - 1].timestamp < row.timestamp));
  const otherToken = dataset.metadata.tokenSide === "base" ? dataset.metadata.pairQuoteAddress : dataset.metadata.pairBaseAddress;
  const opposite = await collector.collect({sourceKey: "live-opposite-side", blockchain, poolAddress, mintAddress: otherToken});
  assert.notEqual(opposite.metadata.tokenSide, dataset.metadata.tokenSide);
  assert(opposite.candles.length > 0, "Other explicitly selected pool token must return candles");
  for (const row of opposite.candles) {
    const source = observed[1].data.attributes.ohlcv_list.find(item => item[0] === row.timestamp);
    assert.deepEqual([row.timestamp, row.open, row.high, row.low, row.close, row.volume], source);
  }
  console.log(JSON.stringify({validatedAt: new Date(dataset.metadata.fetchedAt).toISOString(),
    api: API, metadata: dataset.metadata, candleCount: dataset.candles.length,
    requests, candidateCount: candidates.candidates.length,
    oppositeSide: {token: opposite.metadata.mintAddress, side: opposite.metadata.tokenSide, candleCount: opposite.candles.length},
    incomplete: dataset.candles.filter(row => !row.finalized).length,
    newestRaw: raw[0], newestNormalized: dataset.candles.at(-1)}, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
