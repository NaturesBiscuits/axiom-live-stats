"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const D = require("../bundlerDetection.js"), R = require("../analysisRecorder.js");
const {readReport} = require("./recording-report-helpers.js");
const now = 1700000000000, address = n => "0x" + n.toString(16).padStart(40, "0");
const context = {sourceKey: "bundler-a", blockchain: "eth", mintAddress: address(900), poolAddress: address(901), routeKey: "route-a"};
function row(n, extra = {}) {
  return {rank: String(n), walletAddress: address(n), walletDisplay: `Wallet ${n}`, identityStatus: "resolved", nativeBalance: "0.03",
    balanceCurrency: "ETH", boughtAmount: "$25", remainingPercentage: "1%", axiomBundler: false,
    observedAt: now, extractionId: "extract-a", tokenContext: context, ...extra};
}
function snapshot(rows = Array.from({length: 10}, (_, i) => row(i + 1))) {
  return {title: "Bundle fixture", tokenKey: "route-a", url: "https://axiom.trade/meme/a", stats: {bundlers: "22.5%"},
    marketObservedAt: now, chartContext: context, tradingContext: {...context, tokenKey: "trade-a"},
    holdersIntelligence: {tokenKey: "route-a", context, extractedAt: now, extractionId: "extract-a", activeTable: {kind: "holders"},
      tableStatus: "available", totalReported: 1000, rows}};
}
const analyze = (rows, extra = {}) => D.analyze({snapshot: snapshot(rows), now, sourceTabId: 42, ...extra});
const signal = (result, id) => result.signals.find(item => item.id === id);
function trade(n, extra = {}) {
  return {source: "axiom-trade-dom", sourceTabId: 42, context: {...context, tokenKey: "trade-a"}, tokenKey: "trade-a", eventKey: `trade-${n}`,
    makerAddress: address(n), identityStatus: "resolved", direction: "buy", appearance: "newly-observed", firstSeenAt: now - 1000,
    timing: {earliestAt: now - 3000, latestAt: now - 1000}, filters: {status: "unrestricted"},
    totals: {ETH: {status: "valid", value: 0.03, displayText: "0.03 ETH"}}, ...extra};
}

test("Exact displayed amount grouping normalizes decimals/suffixes without combining currencies", () => {
  for (const [raw, unit, expected] of [["0.0300", "ETH", "0.03 ETH"], ["$1K", null, "1000 USD"], ["1,000 USD", null, "1000 USD"],
    ["$9007199254740993.123", null, "9007199254740993.123 USD"], ["0.0000000000000010 SOL", null, "0.000000000000001 SOL"]]) {
    assert.equal(D.amount(raw, unit).key, expected);
  }
  for (const [raw, unit] of [["0.03", null], ["0.03 SOL", "ETH"], ["$0.03 ETH", null], ["2m", "ETH"], ["—", "ETH"]]) assert.equal(D.amount(raw, unit), null);
  const result = analyze([row(1), row(2), row(3, {balanceCurrency: "SOL"}), row(4, {balanceCurrency: "SOL"})]);
  assert.deepEqual(signal(result, "balances").groups.map(group => group.value).sort(), ["0.03 ETH", "0.03 SOL"]);
  assert.equal(signal(result, "balances").contribution, 0, "Pairs shown but 3+ support needed to score");
});

test("Repeated values expose exact ratios, values, full member addresses and cumulative Bought limitations", () => {
  const result = analyze();
  for (const id of ["balances", "bought", "holdings"]) {
    assert.equal(signal(result, id).percentage, 100); assert.equal(signal(result, id).numerator, 10); assert.equal(signal(result, id).denominator, 10);
    assert.equal(signal(result, id).groups[0].members[0].address, address(1));
  }
  assert.equal(signal(result, "balances").groups[0].value, "0.03 ETH");
  assert.equal(signal(result, "holdings").groups[0].combinedHoldingPercentage, 10);
  assert.equal(result.score, 35); assert.equal(signal(result, "axiomReported").reportedPercentage, 22.5);
  assert.match(signal(result, "bought").reason, /cumulative/);
});

test("Zero balances and trade totals do not create repetition signals; missing inputs stay unavailable", () => {
  const rows = Array.from({length: 10}, (_, i) => row(i + 1, {nativeBalance: "0", boughtAmount: "$0", remainingPercentage: "0%"}));
  const result = analyze(rows);
  for (const id of ["balances", "bought", "holdings"]) { assert.equal(signal(result, id).percentage, null); assert.equal(signal(result, id).contribution, 0); }
  assert.equal(result.score, 0); assert.equal(result.evidenceCoveragePercentage, 5);
  const absent = analyze(rows.map(row => ({...row, axiomBundler: null})));
  assert.equal(absent.score, null); assert.equal(absent.status, "insufficient-data");
});

test("Full-address duplicates count once and conflicting duplicates cannot inflate risk", () => {
  const first = row(1), result = analyze(Array.from({length: 10}, () => ({...first})));
  assert.equal(result.coverage.analyzedRows, 1); assert.equal(result.coverage.duplicateRows, 9); assert.equal(result.score, 0);
  assert.equal(result.duplicateAddresses[0].occurrences, 10); assert.equal(result.duplicateAddresses[0].percentageOfRawRows, 100);
  const conflict = analyze([first, {...first, nativeBalance: "0.15"}, row(2), row(3)]);
  assert.equal(conflict.coverage.conflictingWallets, 1); assert.equal(conflict.coverage.analyzedRows, 2);
  assert.equal(conflict.duplicateAddresses[0].conflicting, true);
});

test("Shortened labels are not merged into identities and cannot produce high confidence", () => {
  const rows = Array.from({length: 10}, (_, i) => row(i + 1, {walletAddress: null, walletDisplay: "0x123...abc", identityStatus: "unresolved",
    fundingSourceAddress: address(800), fundingSourceIdentityStatus: "resolved", axiomBundler: true}));
  const result = analyze(rows);
  assert.equal(result.coverage.analyzedRows, 10); assert.equal(result.coverage.identifiedWallets, 0); assert.equal(result.duplicateAddresses.length, 0);
  assert.equal(result.identityCap, 45); assert.equal(result.score, 45);
  assert(signal(result, "balances").groups[0].members.every(member => member.address === null));
});

test("Shared funding labels stay weak; full funding addresses and displayed DA matches stay separate", () => {
  let rows = Array.from({length: 10}, (_, i) => row(i + 1, {fundingSourceLabel: "Binance"}));
  assert.equal(signal(analyze(rows), "fundingLabels").contribution, 0);
  rows = rows.map(row => ({...row, fundingSourceLabel: "0xbae5...4d81"}));
  let result = analyze(rows);
  assert.equal(signal(result, "fundingLabels").percentage, 100); assert.equal(signal(result, "fundingLabels").contribution, 5);
  assert.equal(signal(result, "funding").percentage, null);
  rows = rows.map(row => ({...row, fundingSourceAddress: address(800), fundingSourceIdentityStatus: "resolved"}));
  const snap = snapshot(rows); snap.tokenInfo = {status: "observed", observedAt: now, developer: {status: "resolved", address: address(800)}};
  result = analyze(rows, {snapshot: snap});
  assert.equal(signal(result, "funding").contribution, 25); assert.equal(signal(result, "developerFunding").contribution, 10);
  assert.equal(result.score, 70); assert.match(signal(result, "developerFunding").reason, /verification/);
  const exchange = analyze(rows.map(row => ({...row, fundingSourceLabel: "Binance Hot Wallet"})));
  assert.equal(signal(exchange, "funding").contribution, 0); assert.equal(signal(exchange, "funding").groups[0].exchangeLabel, true);
  for (const id of ["prelaunch", "slots", "transfers", "relayExits"]) assert.equal(signal(result, id).status, "unavailable");
});

test("Native Bought amounts require a displayed unit and impossible supply sums cannot score holdings", () => {
  const rows = Array.from({length: 30}, (_, i) => row(i + 1, {boughtAmount: "0.03", boughtCurrency: "SOL", remainingPercentage: "4%"}));
  const result = analyze(rows);
  assert.equal(signal(result, "bought").groups[0].value, "0.03 SOL");
  assert.equal(signal(result, "holdings").contribution, 0); assert.equal(signal(result, "holdings").groups[0].combinedHoldingPercentage, null);
});

test("Stale, hidden, mixed-context and mixed-extraction rows never enter current pattern ratios", () => {
  for (const modify of [snap => { snap.holdersIntelligence.tableStatus = "hidden"; }, snap => { snap.holdersIntelligence.context = {...context, sourceKey: "other"}; },
    snap => { snap.holdersIntelligence.extractedAt -= 10001; }, snap => { snap.marketObservedAt -= 10001; },
    snap => { snap.holdersIntelligence.activeTable.kind = "top-traders"; }]) {
    const snap = snapshot(); modify(snap); const result = analyze(undefined, {snapshot: snap});
    assert.equal(result.score, null); assert.equal(result.coverage.analyzedRows, 0);
  }
  const result = analyze([row(1), row(2, {tokenContext: {...context, mintAddress: address(999)}}), row(3, {extractionId: "old"})]);
  assert.equal(result.coverage.rejectedRows, 2); assert.equal(result.coverage.analyzedRows, 1);
});

test("Only supported pool/contract evidence excludes rows, and similarity uses bounded groups", () => {
  const result = analyze([row(1, {walletAddress: context.poolAddress}), row(2, {remainingPercentage: "1.08%"}), row(3, {remainingPercentage: "1.15%"}),
    row(4, {classification: {category: "pool", source: "display-label-only"}}), row(5, {remainingPercentage: "6%"})]);
  assert.equal(result.coverage.excludedRows, 1); assert.equal(result.coverage.analyzedRows, 4);
  const group = signal(result, "holdings").groups[0];
  assert.equal(group.count, 2); assert.equal(group.value, "1%–1.08%"); assert.equal(signal(result, "holdings").denominator, 3);
});

test("Similar-size bursts require distinct resolved wallets and precise non-initial approximate times", () => {
  const events = [trade(1), trade(2), trade(3)], result = analyze([], {trades: events, coverage: {filters: {status: "unrestricted"}}});
  assert.equal(signal(result, "buyBursts").percentage, 100); assert.equal(signal(result, "buyBursts").contribution, 10);
  assert.equal(signal(result, "buyBursts").groups[0].value, "0.03 ETH"); assert.equal(result.score, 10);
  assert.equal(result.sampleFactor, 1, "Trade-only evidence exposes its actual multiplier");
  for (const convert of [e => ({...e, appearance: "initial-sync"}), e => ({...e, makerAddress: address(1)}),
    e => ({...e, timing: {earliestAt: now - 60000, latestAt: now}}), e => ({...e, identityStatus: "unresolved"}),
    e => ({...e, sourceTabId: 99}), e => ({...e, context: {...e.context, sourceKey: "other"}})]) {
    assert.equal(signal(analyze([], {trades: events.map(convert)}), "buyBursts").contribution, 0);
  }
  const sells = analyze([], {trades: events.map(e => ({...e, direction: "sell"}))});
  assert.equal(signal(sells, "sellBursts").percentage, 100);
  assert.equal(signal(sells, "buyBursts").percentage, null);
});

test("Event deduplication, conflicting identities, restricted filters and analysis caps remain explicit", () => {
  const event = trade(1), duplicate = analyze([], {trades: [event, event, event]});
  assert.equal(duplicate.coverage.tradeEvents, 1); assert.equal(signal(duplicate, "buyBursts").contribution, 0);
  const conflict = analyze([], {trades: [event, {...event, makerAddress: address(2)}, trade(3), trade(4)]});
  assert.equal(conflict.coverage.conflictingTradeEvents, 1); assert.equal(signal(conflict, "buyBursts").contribution, 0);
  const result = analyze([], {trades: [trade(1), trade(2), trade(3)], coverage: {filters: {status: "restricted"}}});
  assert.equal(signal(result, "buyBursts").filtered, true);
  const capped = analyze([], {trades: Array.from({length: 1002}, (_, i) => trade(i + 1))});
  assert.equal(capped.coverage.tradeEvents, 1000); assert.equal(capped.coverage.tradeEventsOmitted, 2);
});

test("Recording preserves all signal ratios, member identities and score evidence through compact export", () => {
  const snap = snapshot(), result = analyze(), session = R.createSession(snap, {sourceTabId: 42, intervalMs: 5000, scope: "all"}, now);
  const entry = R.consider(session, snap, 42, now, () => ({bundlerDetection: result})); R.stop(session, now + 1000);
  const report = R.report(session, [entry]);
  assert.deepEqual(readReport(report).rows[0].bundlerDetection, result); assert.match(report, /not a probability or proof/);
});
