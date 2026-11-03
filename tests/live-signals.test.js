"use strict";
const {test} = require("node:test"), assert = require("node:assert/strict");
const S = require("../liveSignals.js"), Service = require("../liveSignalService.js");
const start = 1700000000000, context = {sourceKey: "source-a", blockchain: "sol", mintAddress: "mint-a", poolAddress: "pool-a"};
function input(second, price = 100, overrides = {}) {
  const at = start + second * 1000;
  return {key: S.identity(context, 42, "USD"), context, sourceTabId: 42, currency: "USD", evaluatedAt: at, observedAt: at,
    observationId: String(at), sampledAt: at, deliveredAt: at, price: {value: price, currency: "USD", observedAt: at},
    latency: {sourceToEvaluationMs: 0}, eventTime: null, provenance: "Axiom DOM", title: "Fixture",
    trading: {observedAt: at, filters: {status: "unrestricted"}, error: null, summary: {recordingCoversWindow: true, losses: [], events: 8,
      buys: 6, sells: 2, buyVolume: 80, sellVolume: 20, volumeEvents: 8, totalVolume: 100, missingVolumeEvents: 0, otherCurrencyEvents: 0,
      unknownDirection: 0, initialSyncEvents: 0, buyers: 5, sellers: 2, bothSides: 1, unresolvedVolume: 0, shares: [{n: 1, percentage: 30}]}},
    liquidity: {summary: {latest: {domReadAt: at, value: 10000}, lastAttempt: {status: "valid"}, coverage: 1, windows: {60: {status: "available", change: 0}}},
      activity: {ruleLoaded: true, history: [], error: null}},
    holders: {extractedAt: at, concentration: {results: []}}, tokenInfo: {observedAt: at, tiles: {
      top10Holders: {value: 20, status: "available", observedAt: at}, developerHoldings: {value: 3, status: "available", observedAt: at}}}, ...overrides};
}
function fixture(params = {}) {
  let clock = start; const engine = S.createEngine({now: () => clock}); engine.setSettings(params);
  return {engine, tick(second, price = 100, overrides) { clock = start + second * 1000; return engine.observe(input(second, price, overrides)); },
    warm() { for (let second = 0; second < 60; second++) this.tick(second); }, now: () => clock, advance(ms) { clock += ms; }, view() { return engine.view(input(0).key); }};
}
test("Strength exposes weights/contributions, complementary percentages, neutral and required-input unknowns", () => {
  const x = input(60); const range = {status: "available", changePct: 0};
  x.trading.summary.buyVolume = x.trading.summary.sellVolume = 50; x.trading.summary.buys = x.trading.summary.sells = 4;
  let a = S.assess(x, range, S.DEFAULTS); assert.equal(a.score.bullish, 50); assert.equal(a.score.bearish, 50); assert.equal(a.score.coverage, 1);
  x.trading.summary.buyVolume = 80; x.trading.summary.sellVolume = 20;
  a = S.assess(x, {...range, changePct: 2}, S.DEFAULTS);
  assert.equal(a.score.factors[0].contribution, 40); assert(Math.abs(a.score.factors[1].contribution - 21) < 1e-10);
  assert.equal(a.score.bullish + a.score.bearish, 100);
  x.trading.summary = null; a = S.assess(x, range, S.DEFAULTS); assert.equal(a.score.bullish, null); assert.equal(a.score.status, "Insufficient data");
});
test("Breakout excludes the current/candidate price and confirms only distinct eligible observations", () => {
  const f = fixture(); f.warm(); f.tick(60, 101);
  assert.equal(f.view().current.range.high, 100); assert.equal(f.view().current.phase, "setup-forming");
  for (let n = 0; n < 10; n++) f.engine.observe(input(60, 101));
  assert.equal(f.view().history.length, 0); f.tick(65, 101); f.tick(70, 101);
  assert.equal(f.view().current.phase, "buy-trigger"); assert.equal(f.view().history.length, 1);
  for (let second = 71; second < 85; second++) f.tick(second, 101);
  assert.equal(f.view().history.length, 1, "Latched setup cannot flood new triggers");
  f.tick(85, 99); f.tick(90, 99); assert.equal(f.view().history[0].recoveredAt, start + 90000);
});
test("Gaps interrupt pending confirmation; missing optional evidence stays visible; liquidity risk veto persists", () => {
  const f = fixture(); f.warm(); f.tick(60, 101); f.tick(80, 101);
  assert.notEqual(f.view().current.phase, "buy-trigger");
  const g = fixture({confirmations: 1}); g.warm();
  const missing = input(60, 101); missing.tokenInfo = null; missing.trading.summary.unresolvedVolume = 10; missing.trading.summary.buyers = undefined;
  g.tick(60, 101, {tokenInfo: null, trading: missing.trading});
  assert(g.view().current.conditions.some(c => c.id === "volumeConcentration" && c.status === "unavailable"));
  assert.equal(g.view().current.phase, "buy-trigger", "Missing optional participation/concentration does not hide supported entry analysis");
  const h = fixture({confirmations: 1}); h.warm(); const risk = input(60, 110);
  risk.liquidity.activity.history = [{id: "existing", recoveredAt: null, evidence: {currency: "USD", currentValue: 80}}];
  h.tick(60, 110, {liquidity: risk.liquidity});
  assert(h.view().current.warnings.some(w => w.id === "liquidity-drop")); assert.notEqual(h.view().current.phase, "buy-trigger");
  h.advance(20000); assert.equal(h.view().current.score.bullish, null); assert.equal(h.view().current.warnings.length, 1);
});
test("Fresh unchanged readings confirm, repeated/stale/delayed records do not", () => {
  const f = fixture({confirmations: 2}); f.warm(); f.tick(60, 101); f.tick(65, 101);
  assert.equal(f.view().history.length, 1);
  f.engine.observe(input(64, 900)); assert.equal(f.view().current.observedAt, start + 65000);
  f.engine.observe(input(70, 102, {evaluatedAt: start + 100000})); assert.equal(f.view().history.length, 1);
});
test("Manual positions snapshot exits; post-entry trailing excludes earlier highs; priority and no invented PnL", () => {
  const f = fixture({evaluationIntervalMs: 1000, exitConfirmations: 1}); f.warm(); f.tick(60, 150);
  assert.equal(f.view().position, null);
  f.engine.openPosition(input(0).key, {mode: "paper", entryPrice: 100, currency: "USD", entryAt: start + 60000, size: 2,
    exits: {stopLossPct: 5, takeProfitPct: 0, trailingStopPct: 5, exitConfirmations: 1}});
  assert.equal(f.view().position.highWater, 100); assert.equal(f.view().position.pnlPct, null);
  f.engine.setSettings({stopLossPct: 1, trailingStopPct: 1}); assert.equal(f.view().position.settings.stopLossPct, 5);
  f.tick(61, 110); assert.equal(f.view().position.highWater, 110); f.tick(62, 104);
  assert.equal(f.view().position.status, "sell-trigger"); assert.match(f.view().position.reason, /trailing-stop/);
  const g = fixture({evaluationIntervalMs: 1000, exitConfirmations: 1}); g.tick(0, 100);
  g.engine.openPosition(input(0).key, {mode: "reported-real", entryPrice: 100, currency: "USD", entryAt: start, size: null, exits: {exitConfirmations: 1}});
  g.tick(1, 90); assert.match(g.view().position.reason, /stop-loss/); assert.equal(g.view().position.estimatedPnl, null);
});
test("Positions validate explicit entries, take-profit, context isolation and immutable risk settings", () => {
  const f = fixture({evaluationIntervalMs: 1000, exitConfirmations: 1}); f.tick(0);
  const entry = {mode: "paper", entryPrice: 100, currency: "USD", entryAt: start, size: null, exits: {exitConfirmations: 1}};
  assert.throws(() => f.engine.openPosition(input(0).key, {...entry, entryPrice: 0}));
  assert.throws(() => f.engine.openPosition(input(0).key, {...entry, currency: "SOL"}));
  f.engine.openPosition(input(0).key, entry); f.tick(1, 112); assert.match(f.view().position.reason, /take-profit/);
  const alternate = S.identity(context, 99, "USD"); f.tick(2, 100, {key: alternate, sourceTabId: 99});
  assert.equal(f.engine.view(alternate).position, null);
  const swapped = S.identity(context, 42, "SOL"); f.tick(3, 100, {key: swapped, currency: "SOL"});
  assert.equal(f.engine.view(swapped).position, null); assert.equal(f.view().current.live, false);
});
test("Worker restart preserves position plans and event evidence, resets confirmation/history and rejects replay", () => {
  const f = fixture({confirmations: 1}); f.warm(); f.tick(60, 101);
  f.engine.openPosition(input(0).key, {mode: "paper", entryPrice: 101, currency: "USD", entryAt: start + 60000, size: 2, exits: {}});
  const saved = f.engine.exportState(), restored = S.createEngine({now: () => start + 61000}); restored.restore(saved);
  assert.equal(restored.view(input(0).key).interrupted, true); assert.equal(restored.view(input(0).key).history[0].outdated, true);
  assert.equal(restored.observe(input(60, 101)).changed, false); restored.observe(input(61, 101));
  assert.equal(restored.view(input(0).key).current.phase, "warming-up"); assert.equal(restored.view(input(0).key).history.filter(e => e.type === "buy-trigger").length, 1);
  assert.equal(restored.view(input(0).key).position.entryPrice, 101);
});
test("Chronological replay uses no future prices; separate outcome inspection requires supported endpoints", () => {
  const f = fixture({confirmations: 1}); for (let second = 0; second < 100; second++) f.tick(second, second < 60 ? 100 : second < 90 ? 101 : 102);
  const saved = f.engine.exportState(), event = saved.events[0]; assert.equal(event.triggeredAt, start + 60000);
  const earlier = fixture({confirmations: 1}); for (let second = 0; second <= 60; second++) earlier.tick(second, second < 60 ? 100 : 101);
  assert.deepEqual(earlier.view().history[0], event);
  const result = S.outcomes(saved.events, saved.journal, [30, 300]); assert.equal(result[0].status, "observed"); assert.equal(result[1].status, "unavailable");
  assert.equal(S.outcomes(saved.events, [], [30])[0].grossObservedReturnPct, null);
});
test("Adapter preserves DOM provenance, same-currency summaries and rejects restored/unknown observations", () => {
  const snapshot = {chartContext: context, stats: {price: "$100"}, tokenInfo: null};
  const row = {value: 100, unit: "USD", domReadAt: start, sampledAt: start};
  const build = candidate => S.buildSnapshot({snapshot, extras: {trading: {windows: [{currency: "SOL"}]}}, row: candidate, sourceTabId: 42, at: start});
  assert.equal(build(row).trading.summary, null); assert.equal(build({...row, restored: true}), null);
  assert.equal(build({...row, unit: "unspecified"}), null); assert.equal(build(row).eventTime, null);
});
test("Service requires notification opt-in, suppresses duplicates/restarts and safely surfaces storage failures", async () => {
  let clock = start, saved = null, sent = [], permission = false, fail = false;
  const archive = {load: async () => saved, save: async value => { if (fail) throw new Error("disk error"); saved = structuredClone(value); }};
  const service = Service.createService({archive, now: () => clock, hasPermission: async () => permission, notify: async e => sent.push(e)});
  await assert.rejects(service.notifications(true), /permission/); permission = true; await service.notifications(true); await service.settings({confirmations: 1});
  for (let second = 0; second <= 60; second++) { clock = start + second * 1000; await service.observe(input(second, second < 60 ? 100 : 101)); }
  assert.equal(sent.length, 1); await service.observe(input(60, 101)); assert.equal(sent.length, 1);
  const restarted = Service.createService({archive, now: () => clock, hasPermission: async () => true, notify: async e => sent.push(e)});
  await restarted.observe(input(60, 101)); assert.equal(sent.length, 1);
  fail = true; clock += 5000; await restarted.observe(input(65, 102)); assert.match((await restarted.status(input(0).key)).storageError, /disk error/);
  const bad = Service.createService({archive: {load: async () => { throw new Error("read failed"); }}});
  await assert.rejects(bad.settings({confirmations: 1}), /read failed/);
});
test("Retention bounds and parameter validation remain explicit", () => {
  const f = fixture(); f.warm(); f.tick(60, 101); f.advance(S.LIMITS.retentionMs + 1000);
  assert.equal(f.engine.exportState().journal.length, 0);
  assert.throws(() => S.settings({strategyId: "placeholder"})); assert.throws(() => S.settings({maxGapMs: 2000})); assert.throws(() => S.settings({confirmations: 1.2}));
});

test("Risk warnings survive missing/stale evidence and require confirmed recovery independently of scores", () => {
  const f = fixture({evaluationIntervalMs: 1000, confirmations: 1}); f.warm();
  const risk = input(60, 110); risk.tokenInfo.tiles.developerHoldings.value = 30;
  f.tick(60, 110, {tokenInfo: risk.tokenInfo}); assert(f.view().current.score.bullish > 50); assert.equal(f.view().current.warnings.length, 1);
  f.tick(61, 110, {tokenInfo: null}); assert.equal(f.view().current.warnings.length, 1, "Unknown developer exposure cannot clear the previous warning");
  f.tick(62, 110); assert.equal(f.view().current.warnings.length, 1); f.tick(63, 110);
  assert.equal(f.view().current.warnings.length, 0); assert.equal(f.view().history.find(e => e.type.startsWith("risk-warning:")).recoveredAt, start + 63000);
  const restored = S.createEngine({now: f.now}); restored.restore(f.engine.exportState()); assert(restored.view(input(0).key).history.length > 0);
});

test("Position risk checks retain original thresholds after profile changes and missing evidence cannot clear them", () => {
  const f = fixture({evaluationIntervalMs: 1000, exitConfirmations: 2}); f.tick(0);
  f.engine.openPosition(input(0).key, {mode: "paper", entryPrice: 100, currency: "USD", entryAt: start, size: 1, exits: {}});
  f.engine.setSettings({maxDeveloperPct: 90});
  const risk = input(1); risk.tokenInfo.tiles.developerHoldings.value = 30;
  f.tick(1, 100, {tokenInfo: risk.tokenInfo}); assert.equal(f.view().position.status, "exit-warning");
  assert.equal(f.view().position.exitConditions[0].met, true);
  f.tick(2, 100, {tokenInfo: null}); assert.equal(f.view().position.status, "exit-warning"); assert.equal(f.view().position.pending, 0);
});

test("Notification rate limiting covers simultaneous contexts and export evaluates only post-evaluation horizons", async () => {
  let clock = start, sent = 0, saved = null;
  const service = Service.createService({now: () => clock, archive: {load: async () => saved, save: async state => { saved = structuredClone(state); }},
    hasPermission: async () => true, notify: async () => { sent++; }});
  await service.settings({confirmations: 1}); await service.notifications(true);
  for (let second = 0; second <= 60; second++) {
    clock = start + second * 1000;
    for (const tab of [42, 99]) await service.observe(input(second, second < 60 ? 100 : 101, {sourceTabId: tab, key: S.identity(context, tab, "USD")}));
  }
  assert.equal(sent, 1, "Two simultaneous triggers produce at most one Chrome notification");
  const exported = await service.export(); assert.match(exported.text, /axiom-paper-evaluation-v1/);
  const event = {id: "late", key: "late", type: "buy-trigger", price: 100, triggeredAt: start, evaluatedAt: start + 20000};
  assert.equal(S.outcomes([event], [{key: "late", price: {value: 110}, observedAt: start + 30000, evaluatedAt: start + 30000}], [30])[0].status, "unavailable", "A horizon cannot start before the decision was actually evaluated");
});
