"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const S = require("../supplyValuation.js");
const now = 1700000000000, context = {sourceKey: "source-a", blockchain: "eth", mintAddress: "0x" + "1".repeat(40), poolAddress: "0x" + "2".repeat(40)};
const field = (key, raw, options = {}) => S.observation(key, raw, {context, observedAt: now, ...options});
const analyze = fields => S.analyze({fields}, now).calculations;
test("generic Supply remains unspecified and supports only the specifically named generic valuation", () => {
  const fields = {price: field("price", "$2"), displayedSupply: field("displayedSupply", "1B")};
  const rows = analyze(fields);
  assert.equal(fields.displayedSupply.supplyType, "unspecified"); assert(rows.slice(0, 3).every(row => row.status === "unavailable"));
  assert.equal(rows[3].name, "Valuation using Axiom-displayed supply"); assert.equal(rows[3].normalizedValue, "2000000000");
  assert.equal(rows[3].source, "Calculated estimate"); assert.equal(rows[3].approximate, true);
});
test("circulating, total and maximum supply are distinct valuation bases", () => {
  const rows = analyze({price: field("price", "$2"), circulatingSupply: field("circulatingSupply", "100"), totalSupply: field("totalSupply", "150"), maximumSupply: field("maximumSupply", "200")});
  assert.deepEqual(rows.slice(0, 3).map(row => row.normalizedValue), ["200", "300", "400"]);
  assert(rows[2].supplyBasis.includes("maximum")); assert.equal(rows[3].status, "unavailable");
});
test("total supply and reported FDV cannot establish a finite maximum or substitute a diluted supply basis", () => {
  for (const raw of [null, "Unlimited", "∞", "Uncapped", "No maximum supply"]) {
    const max = field("maximumSupply", raw);
    const rows = analyze({price: field("price", "$1"), totalSupply: field("totalSupply", "100"), maximumSupply: max, reportedFDV: field("reportedFDV", "$100")});
    assert.equal(rows[1].normalizedValue, "100"); assert.equal(rows[2].status, "unavailable"); assert.equal(max.normalizedValue, null);
  }
});
test("display suffixes normalize exact decimal strings while retaining rounded/abbreviated quality", () => {
  for (const [raw, expected] of [["1.001K", "1001"], ["12.34M", "12340000"], ["0.01B", "10000000"], ["1.2T", "1200000000000"], ["1,234,567.890", "1234567.89"]]) {
    assert.equal(S.parse(raw).normalizedValue, expected);
  }
  assert.equal(field("totalSupply", "1B").abbreviated, true); assert(field("totalSupply", "1B").approximationStatus.includes("Rounded"));
  assert.equal(S.parse("$0.0₅123", "money").normalizedValue, "0.00000123");
});
test("large quantities retain integer precision and products do not pass through binary floating point", () => {
  const raw = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
  assert.equal(S.parse(raw).normalizedValue, raw);
  assert.equal(S.parse(Number.MAX_SAFE_INTEGER + 2), null);
  assert.equal(S.multiply("9007199254740993", "0.1"), "900719925474099.3");
  assert.equal(S.multiply("0.000000000000000000000000000001", "1000000000000000000000000000000"), "1");
  assert.doesNotThrow(() => JSON.stringify(field("totalSupply", raw)));
});
test("explicit base units apply decimals once; displayed quantities never inherit another decimal conversion", () => {
  const converted = S.fromBaseUnits("1000000000000000001", 18);
  assert.equal(converted.normalizedValue, "1.000000000000000001"); assert.equal(converted.normalization, "base-units-divided-once");
  assert.throws(() => S.fromBaseUnits(converted, 18)); assert.throws(() => S.fromBaseUnits(1000000000000000001, 18));
  assert.throws(() => S.fromBaseUnits("1.2", 18)); assert.throws(() => S.fromBaseUnits("100", null)); assert.throws(() => S.fromBaseUnits("100", 256));
  const rows = analyze({price: field("price", "$0.5"), totalSupply: field("totalSupply", "1B", {context: {...context, decimals: 18}})});
  assert.equal(rows[1].normalizedValue, "500000000");
});
test("zero supply and zero price remain distinct from missing and malformed inputs", () => {
  const rows = analyze({price: field("price", "$0"), circulatingSupply: field("circulatingSupply", "100"), totalSupply: field("totalSupply", "0"), maximumSupply: field("maximumSupply", "0")});
  assert(rows.slice(0, 3).every(row => row.normalizedValue === "0"));
  for (const raw of [null, "", "—", "N/A", "-1", "1,2K", "NaN", "Infinity", "1e999999"]) assert.equal(field("totalSupply", raw).normalizedValue, null);
  assert.equal(field("totalSupply", null).status, "missing"); assert.equal(field("totalSupply", "oops").status, "malformed");
});
test("price currency is explicit, quantities are not currency, and unrelated reported currencies do not get mixed", () => {
  assert.equal(S.parse("$1 ETH", "money"), null); assert.equal(S.parse("1 USD"), null);
  assert.equal(S.parse("2SOL", "money").currency, "SOL");
  const noUnit = analyze({price: field("price", "2"), circulatingSupply: field("circulatingSupply", "10")}); assert.match(noUnit[0].reason, /currency is unresolved/);
  const fields = {price: field("price", "2 SOL"), circulatingSupply: field("circulatingSupply", "10"), marketCap: field("marketCap", "$100")};
  const rows = analyze(fields); assert.equal(rows[0].normalizedValue, "20"); assert.equal(rows[0].currency, "SOL"); assert.equal(fields.marketCap.currency, "USD");
  const moneySupply = {...field("circulatingSupply", "10"), currency: "USD"};
  assert.match(S.calculate(fields.price, moneySupply, {now, expectedType: "circulating"}).reason, /not a monetary value/);
});
test("token, source and network mismatches block only the affected calculation", () => {
  const price = field("price", "$1"), valid = field("circulatingSupply", "10");
  for (const next of [{...context, sourceKey: "other"}, {...context, blockchain: "bsc"}, {...context, mintAddress: "other"}, {...context, mintAddress: 123}, {...context, blockchain: null}, {...context, conflict: "ambiguous"}]) {
    const changed = {...valid, context: next}; assert.equal(S.calculate(price, changed, {now, expectedType: "circulating"}).status, "unavailable");
    assert.equal(analyze({price, circulatingSupply: changed, totalSupply: field("totalSupply", "20")})[1].normalizedValue, "20");
  }
});
test("stale, future and skewed input times cannot become current by republishing a snapshot", () => {
  const price = field("price", "$1"), supply = field("totalSupply", "10");
  assert.equal(S.calculate(price, supply, {now: now + 10000, expectedType: "total"}).status, "available");
  assert.match(S.calculate(price, supply, {now: now + 10001, expectedType: "total"}).reason, /stale/);
  assert.match(S.calculate(price, {...supply, observedAt: now - 5001}, {now, expectedType: "total"}).reason, /5s apart/);
  assert.match(S.calculate(price, {...supply, observedAt: now + 1001}, {now, expectedType: "total"}).reason, /stale/);
});
test("reported Market Cap and historical observation records are never mutated into calculated valuations", () => {
  const packet = {fields: {price: field("price", "$2"), marketCap: field("marketCap", "$900"), totalSupply: field("totalSupply", "100")}};
  const before = JSON.stringify(packet); const analysis = S.analyze(packet, now);
  assert.equal(analysis.calculations[1].normalizedValue, "200"); assert.equal(packet.fields.marketCap.normalizedValue, "900");
  assert.equal(JSON.stringify(packet), before);
  const R = require("../rollingChartCollector.js"), store = R.createStore({now: () => now}); store.setToken(context);
  store.observe("marketCap", {value: 900, unit: "USD"}, now); const observed = JSON.stringify(store.tick(now));
  S.analyze(packet, now); assert.equal(JSON.stringify(store.snapshot()[0].series.marketCap.samples[0].value), "900"); assert(observed.includes('"value":900'));
});
test("provider fields keep actual names, global scope, missing values, zero and unverified diluted basis", () => {
  const fields = S.providerFields({fields: {market_cap_usd: "0", fdv_usd: null}, fetchedAt: now, ...context});
  assert.equal(fields[0].sourceField, "data.attributes.market_cap_usd"); assert.equal(fields[0].normalizedValue, "0"); assert(fields[0].scope.includes("cross-chain"));
  assert.equal(fields[1].status, "provider-null"); assert(fields[1].definition.includes("does not establish"));
  assert(S.providerFields({fields: {}}).every(field => field.status === "absent"));
  assert(S.providerFields({fields: {market_cap_usd: "oops"}})[0].status === "malformed");
  assert.equal(S.providerFields({fields: {market_cap_usd: "2 EUR"}})[0].normalizedValue, null);
});
