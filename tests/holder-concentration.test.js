"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const C = require("../holderConcentration.js");
const now = 1700000000000;
const address = index => `0x${index.toString(16).padStart(40, "0")}`;
const context = {sourceKey: "eth:token:pool", blockchain: "eth", mintAddress: address(100), poolAddress: address(200)};
function state(count = 10) {
  return {tokenKey: "route", context, extractedAt: now, extractionId: "batch", tableStatus: "available",
    activeTable: {kind: "holders"}, sort: {column: "remaining", direction: "descending", source: "aria-sort"},
    unsupportedRows: 0, renderedLimitReached: false, totalReported: count, observedHolders: 1000, cacheTruncated: true,
    rows: Array.from({length: count}, (_, index) => ({rank: String(index + 1), walletAddress: address(index + 1), identityStatus: "resolved",
      observedAt: now, extractionId: "batch", tokenContext: context, nativeBalance: "9999 ETH", remainingTokenValue: "$123",
      tokenQuantity: null, remainingPercentage: `${count - index}%`, classification: {category: "unknown", source: "axiom-dom", verificationStatus: "unverified", evidence: []}}))};
}
const analyze = (s, options = {}) => C.analyze(s, {now, ...options});
test("Holders versus Top Traders and unknown views never share concentration", () => {
  for (const kind of ["top-traders", "unknown"]) {
    const s = state(); s.activeTable.kind = kind;
    assert(analyze(s).results.every(result => result.kind === "unavailable"));
  }
});
test("unknown, ascending, native balance and trade sorting only support an observed subset", () => {
  for (const sort of [{}, {column: "remaining", direction: "ascending", source: "aria-sort"},
    {column: "balance", direction: "descending", source: "aria-sort"}, {column: "bought", direction: "descending", source: "aria-sort"}]) {
    const s = state(); s.sort = sort;
    for (const result of analyze(s).results) { assert.equal(result.kind, "observed"); assert.match(result.label, /partial coverage/); }
  }
});
test("explicit descending Remaining with a valid leading set proves only Axiom table rankings", () => {
  const result = analyze(state());
  assert.deepEqual(result.results.map(item => item.kind), ["top", "top", "top"]);
  assert.deepEqual(result.results.map(item => item.percentage), [10, 40, 55]);
  assert(result.results.every(item => item.label.includes("Axiom table order") && item.reason.includes("not independently verified")));
});
test("incomplete ranks, virtualized offsets and inconsistent percentages cannot prove largest holders", () => {
  const offset = state(); offset.rows.forEach(row => row.rank = String(Number(row.rank) + 20));
  assert(analyze(offset).results.every(item => item.kind === "observed"));
  const gap = state(11); gap.rows.splice(2, 1);
  assert.equal(analyze(gap).results[1].kind, "observed");
  const wrong = state(); wrong.rows[8].remainingPercentage = "12%";
  assert.equal(analyze(wrong).results[0].kind, "observed", "A later contradictory value cannot be labeled Top 1");
  for (const key of ["unsupportedRows", "renderedLimitReached"]) {
    const s = state(); s[key] = 1;
    assert(analyze(s).results.every(item => item.kind === "observed"));
  }
});
test("fewer than the required identifiable wallets explains unavailable results", () => {
  const result = analyze(state(4));
  assert.equal(result.results[1].percentage, null); assert.match(result.results[1].reason, /only 4 available/);
  assert.equal(result.results[2].percentage, null);
});
test("identical full-address DOM duplicates are deduplicated and EVM casing is canonical", () => {
  const s = state(); s.rows.push({...s.rows[9], walletAddress: s.rows[9].walletAddress.toUpperCase().replace("0X", "0x")});
  const result = analyze(s);
  assert.equal(result.identifiableWallets, 10); assert.equal(result.duplicateRows, 1);
  assert.equal(result.results[2].percentage, 55);
});
test("conflicting duplicate holdings are unavailable and never summed as token-account aggregation", () => {
  const s = state(); s.rows.push({...s.rows[0], remainingPercentage: "20%"});
  assert(analyze(s).results.every(item => item.percentage === null));
  assert.equal(analyze(s).conflictingDuplicates, 1);
  const accounts = state(); accounts.rows.push({...accounts.rows[0], rank: "11"});
  assert.equal(analyze(accounts).results[0].kind, "observed");
});
test("shortened addresses and identical display names are unresolved, never merged or ranked as full identities", () => {
  const s = state(2);
  s.rows.forEach(row => { row.walletAddress = null; row.walletDisplay = "0x123...abc"; row.identityStatus = "unresolved"; });
  const result = analyze(s);
  assert.equal(result.identifiableWallets, 0); assert.equal(result.unresolvedRows, 2);
  assert(result.results.every(item => item.percentage === null));
});
test("rounded displayed percentages sum approximately without requiring token decimals or dollar conversion", () => {
  assert.equal(C.sumPercentages([C.percentage("33.3%"), C.percentage("33.3%"), C.percentage("33.3%")]), 99.9);
  assert.equal(C.sumPercentages([C.percentage("99.999999999998%"), C.percentage("0.000000000002%")]), 100);
  const s = state(); s.rows[0].nativeBalance = "0 ETH"; s.rows[0].remainingTokenValue = "$99999999";
  assert.equal(analyze(s).results[0].percentage, 10); assert.equal(s.rows[0].tokenQuantity, null);
});
test("invalid, missing, negative and impossible total percentages remain unavailable", () => {
  for (const raw of [null, "", "—", "-1%", "101%", "100.00000000000000000001%", "NaN%", "1.2.3%", "$5", "1e2%", "0.1% 0.2%", "50%oops"]) {
    assert.equal(C.percentage(raw), null);
    const s = state(); s.rows[0].remainingPercentage = raw;
    assert(analyze(s).results.every(item => item.percentage === null));
  }
  assert.equal(C.percentage("0%").value, 0);
  const total = state(2); total.rows[0].remainingPercentage = "70%"; total.rows[1].remainingPercentage = "40%";
  assert(analyze(total).results.every(item => item.percentage === null));
  assert.equal(C.sumPercentages([C.percentage("50.01%"), C.percentage("50%")]), null);
});
test("supported pool exclusions expose addresses/reasons and retain the original supply denominator", () => {
  const s = state(11);
  s.rows[0].classification = {category: "pool", source: "axiom-reported", verificationStatus: "axiom-reported",
    evidence: [{kind: "explicit-wallet-classification", text: "Pool"}]};
  const result = analyze(s, {excludePools: true});
  assert.equal(result.excluded.length, 1); assert.equal(result.excluded[0].address, s.rows[0].walletAddress);
  assert.match(result.excluded[0].reason, /not independently verified/);
  assert.match(result.denominator, /unchanged by exclusions/);
  assert.equal(result.results[1].percentage, 40); assert.equal(result.results[2].kind, "top");
  const shorter = state(); shorter.rows[0].classification = s.rows[0].classification;
  assert.match(analyze(shorter, {excludePools: true}).results[2].reason, /only 9 available/);
});
test("pool-like names, icons and unsupported classifications are never sufficient exclusions", () => {
  const s = state(); s.rows[0].walletDisplay = "LIQUIDITY POOL";
  s.rows[0].classification = {category: "pool", verificationStatus: "unverified", evidence: [{kind: "display-label-only", text: "POOL"}]};
  assert.equal(analyze(s, {excludePools: true}).excluded.length, 0);
});
test("contradictory classifications on duplicate addresses cannot support a pool exclusion", () => {
  const s = state();
  s.rows[0].classification = {category: "pool", source: "axiom-reported", verificationStatus: "axiom-reported", evidence: [{kind: "explicit-wallet-classification", text: "Pool"}]};
  s.rows.push({...s.rows[0], classification: {...s.rows[0].classification, category: "locker", evidence: [{kind: "explicit-wallet-classification", text: "Locker"}]}});
  const result = analyze(s, {excludePools: true});
  assert.equal(result.excluded.length, 0); assert(result.results.every(item => item.percentage === null));
});
test("an unresolved leading pool cannot be silently excluded to establish a top ranking", () => {
  const s = state(11); s.rows[0].walletAddress = null;
  const result = analyze(s, {excludePools: true});
  assert.equal(result.excluded.length, 0); assert.equal(result.results[2].kind, "observed");
});
test("mixed-age, mixed-batch and different-token observations are rejected", () => {
  for (const change of [row => row.observedAt--, row => row.extractionId = "old-batch", row => row.tokenContext = {...context, sourceKey: "other-token"},
    row => row.tokenContext = {...context, blockchain: "solana"}, row => row.tokenContext = {...context, mintAddress: address(999)}]) {
    const s = state(); change(s.rows[0]);
    assert(analyze(s).results.every(item => item.percentage === null));
  }
  const s = state(); s.context = {...context, conflict: "ambiguous identity"};
  assert(analyze(s).results.every(item => item.percentage === null));
});
test("stale extractions are unavailable even if a snapshot was just republished", () => {
  const s = state(); s.capturedAt = now + 20000;
  assert(C.analyze(s, {now: now + 10001}).results.every(item => item.percentage === null));
  assert.equal(C.analyze(s, {now: now + 10000}).results[0].percentage, 10);
});
test("old session rows, truncation and matching holder count do not supply current ranking evidence", () => {
  const s = state(4); s.sessionRows = state(10).rows;
  s.totalReported = 4; s.sort = {};
  const result = analyze(s);
  assert.equal(result.identifiableWallets, 4); assert.equal(result.results[0].kind, "observed");
  assert.equal(result.results[1].percentage, null);
});
test("Axiom-reported Top 10 never substitutes for a calculated result", () => {
  const s = state(1); s.axiomReportedTop10 = "85%";
  assert.equal(analyze(s).results[2].percentage, null);
});

test("duplicate displayed ranks cannot prove Top 1 even when percentages are descending", () => {
  const s = state(); s.rows[1].rank = "1";
  assert(analyze(s).results.every(result => result.kind === "observed"));
  assert.equal(analyze(s).results[0].percentage, 10, "Only the qualified observed-subset value remains available");
  s.rows[1].walletAddress = null;
  assert.equal(analyze(s).results[0].kind, "observed", "An unresolved duplicate rank still invalidates a Top 1 claim");
});
test("pool evidence must name this address and match the current explicit pool context", () => {
  const s = state();
  const row = s.rows[0];
  row.classification = {category: "pool", source: "axiom-reported", verificationStatus: "axiom-reported", evidence: [{kind: "pool-address-match", address: row.walletAddress}]};
  assert.equal(C.supportedPool(row), false, "The current token pool is a different address");
  row.tokenContext = {...context, poolAddress: row.walletAddress};
  assert.equal(C.supportedPool(row), true);
  row.classification.evidence[0].address = address(999);
  assert.equal(C.supportedPool(row), false, "An evidence tag cannot stand in for the actual address");
  for (const text of [undefined, "Locker", "POOL-like name"]) {
    row.classification.evidence = [{kind: "explicit-wallet-classification", text}];
    assert.equal(C.supportedPool(row), false);
  }
  row.classification.evidence = [{kind: "explicit-wallet-classification", text: "Pool"}];
  assert.equal(C.supportedPool(row), true);
});
