// Opt-in real public API validation; no Axiom credentials or session access.
"use strict";
const assert = require("node:assert/strict");
const {createCollector, normalizeCandles, API} = require("../chartDataCollector.js");
const poolAddress = process.env.GECKO_TEST_POOL || "AnrCHvfJUzMtos8DGjpT2XKurVPPYAVLDturASNwXcd4";
(async () => {
  const observed = [];
  const collector = createCollector({fetchImpl: async (url, options) => {
    const response = await fetch(url, options);
    if (response.ok && url.includes("/ohlcv/")) observed.push(await response.clone().json());
    return response;
  }});
  const dataset = await collector.collect({sourceKey: "live-validation", blockchain: "solana", poolAddress});
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
  console.log(JSON.stringify({validatedAt: new Date(dataset.metadata.fetchedAt).toISOString(),
    api: API, metadata: dataset.metadata, candleCount: dataset.candles.length,
    incomplete: dataset.candles.filter(row => !row.finalized).length,
    newestRaw: raw[0], newestNormalized: dataset.candles.at(-1)}, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
