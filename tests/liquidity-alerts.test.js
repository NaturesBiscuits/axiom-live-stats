"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const H = require("../liquidityHistory.js"), A = require("../liquidityAlerts.js");
const start = 1700000000000;
const context = {sourceKey: "sol:mint:pool", blockchain: "solana", mintAddress: "mint", poolAddress: "pool"};
function fixture(settings = {}) {
  let clock = start;
  const engine = A.createEngine({now: () => clock}), recorder = H.createRecorder({sessionId: "alerts"}), rows = [];
  recorder.setContext(context); engine.setSettings(settings);
  function read(second, text = "$100", age = 0) {
    clock = start + second * 1000 + age;
    const at = clock - age, row = {...recorder.sample(() => ({displayText: text, domReadAt: at}), at), sourceTabId: 7};
    rows.push(row); engine.observe(row, rows, clock); return row;
  }
  return {engine, recorder, rows, read, now: () => clock, advance: ms => { clock += ms; },
    view: () => engine.view(rows.at(-1)?.tokenKey), warm: (through = 55) => { for (let s = 0; s <= through; s += 5) read(s); }};
}
test("threshold decisions are unrounded, inclusive, and optionally require an absolute drop", () => {
  for (const [text, minimum, expected] of [["$80", null, true], ["$80.000001", null, false], ["$80", 20, true], ["$80", 20.000001, false], ["$0", 100, true]]) {
    const f = fixture({confirmations: 1, minimumAbsoluteDrop: minimum}); f.warm(); f.read(60, text);
    assert.equal(f.view().history.length, expected ? 1 : 0);
  }
});
test("three distinct unchanged fresh readings confirm one episode; repeated messages and views do not count", () => {
  const f = fixture(); f.warm(); const a = f.read(60, "$80");
  for (let i = 0; i < 10; i++) { assert.equal(f.engine.observe(a, f.rows).changed, false); f.view(); }
  assert.equal(f.view().states[0].pending, 1); assert.equal(f.view().history.length, 0);
  f.read(65, "$80"); f.read(70, "$80");
  const event = f.view().history[0]; assert.equal(f.view().history.length, 1);
  assert.equal(event.evidence.baselineValue, 100); assert.equal(event.evidence.currentValue, 80);
  assert.equal(event.evidence.signedChangePercent, -20); assert.equal(event.evidence.absoluteChange, -20);
  assert.equal(event.evidence.intervalMs, 60000); assert.equal(event.evidence.currentAt, start + 70000);
  f.read(75, "$70"); assert.equal(f.view().history.length, 1); assert.equal(f.view().history[0].latestEvidence.currentValue, 70);
});
test("recovery uses the original baseline and two consecutive fresh readings, not a declining rolling baseline", () => {
  const f = fixture(); f.warm(); for (const s of [60, 65, 70]) f.read(s, "$80");
  for (let s = 75; s <= 140; s += 5) f.read(s, "$80");
  assert.equal(f.view().history[0].recoveredAt, null, "Flat low liquidity cannot silently recover");
  f.read(145, "$85"); assert.equal(f.view().states[0].recovery, 1);
  f.read(150, "$84.999999"); assert.equal(f.view().states[0].recovery, 0);
  f.read(155, "$85"); f.read(160, "$85");
  assert.equal(f.view().history[0].recoveredAt, start + 160000);
  assert.equal(f.view().history[0].recoveryEvidence.baselineValue, 100);
});
test("valid current zero qualifies; zero baseline and malformed/missing values cannot qualify", () => {
  const f = fixture({confirmations: 1}); f.warm(); f.read(60, "$0"); assert.equal(f.view().history[0].evidence.signedChangePercent, -100);
  const z = fixture({confirmations: 1}); for (let s = 0; s <= 60; s += 5) z.read(s, "$0");
  assert.equal(z.view().history.length, 0); assert.match(z.view().states[0].reason, /baseline is zero/);
  for (const text of [null, "$oops", "$1e999", "$-1", "NaN"]) {
    const x = fixture({confirmations: 1}); x.warm(); x.read(60, text); assert.equal(x.view().history.length, 0);
    assert.equal(x.view().states.at(-1).status, "Data delayed/unavailable");
  }
  assert.equal(A.compare([], {...f.rows.at(-1), value: NaN}, A.DEFAULTS, f.now()).status, "Data delayed/unavailable");
});
test("warm-up requires the full selected period; baseline tolerance is reused and missing baselines explained", () => {
  const f = fixture(); f.warm(40); assert.equal(f.view().states[0].status, "Collecting history");
  assert.match(f.view().states[0].reason, /40s.*60s/);
  f.read(60); f.read(107.501, "$70"); assert.match(f.view().states[0].reason, /No valid baseline/);
  for (const windowSeconds of [30, 60, 300, 900]) {
    const x = fixture({windowSeconds}); x.read(0); x.read(windowSeconds - 2.5, "$50");
    assert.equal(x.view().history.length, 0); assert.equal(x.view().states[0].status, "Collecting history");
  }
});
test("one missing internal sample allows valid endpoints and explicitly incomplete interval coverage", () => {
  const f = fixture({confirmations: 1});
  for (let s = 0; s <= 55; s += 5) f.read(s, s === 30 ? null : "$100");
  f.read(60, "$80"); const e = f.view().history[0].evidence;
  assert.equal(e.coverage.complete, false); assert.equal(e.coverage.validSlots, 12); assert.equal(e.coverage.expected, 13);
  assert.equal(e.coverage.ratio, 12 / 13);
});
test("invalid or stale readings interrupt confirmation and recovery but preserve the confirmed alert", () => {
  const f = fixture(); f.warm(); f.read(60, "$80"); f.read(65, null); f.read(70, "$80");
  assert.equal(f.view().states.find(s => s.currency === "USD").pending, 1);
  f.read(75, "$80"); f.read(80, "$80"); assert.equal(f.view().history.length, 1);
  f.read(85, "$85"); f.read(90, null); assert.equal(f.view().states[0].activeId, f.view().history[0].id);
  assert.equal(f.view().states[0].status, "Data delayed/unavailable");
  f.read(95, "$85"); assert.equal(f.view().history[0].recoveredAt, null);
  f.advance(13000); assert.equal(f.view().states[0].status, "Data delayed/unavailable"); assert.match(f.view().states[0].reason, /Last confirmed/);
  f.read(115, "$85"); assert.equal(f.view().history[0].recoveredAt, null); f.read(120, "$85"); assert.notEqual(f.view().history[0].recoveredAt, null);
  const stale = fixture(); stale.warm(); stale.read(60, "$80"); stale.read(65, "$80", 13000);
  assert.equal(stale.view().states[0].pending, 0); assert.equal(stale.view().history.length, 0);
});
test("gaps reset pending confirmation; fresh unchanged samples may start it again", () => {
  const f = fixture(); f.warm(); f.read(60, "$80"); f.read(70, "$80"); assert.equal(f.view().states[0].pending, 1);
  f.read(75, "$80"); f.read(80, "$80"); assert.equal(f.view().history.length, 1);
});
test("a nonqualifying fresh reading resets confirmation and a later recovered episode can trigger a new entry", () => {
  const f = fixture(); f.warm(); f.read(60, "$80"); f.read(65, "$81");
  assert.equal(f.view().states[0].pending, 0);
  for (const s of [70, 75, 80]) f.read(s, "$80"); assert.equal(f.view().history.length, 1);
  f.read(85, "$100"); f.read(90, "$100"); assert.notEqual(f.view().history[0].recoveredAt, null);
  for (const s of [95, 100, 105]) f.read(s, "$60");
  assert.equal(f.view().history.length, 2); assert.notEqual(f.view().history[0].id, f.view().history[1].id);
});
test("alert evidence records actual jittered intervals inside the baseline tolerance", () => {
  for (const baselineSecond of [27.5, 32.5]) {
    const f = fixture({windowSeconds: 30, confirmations: 1}); f.read(0); f.read(baselineSecond); f.read(60, "$80");
    const evidence = f.view().history[0].evidence;
    assert.equal(evidence.intervalMs, (60 - baselineSecond) * 1000);
    assert.equal(evidence.baselineAt, start + baselineSecond * 1000);
    assert.equal(evidence.baselineSampledAt, evidence.baselineAt); assert.equal(evidence.currentSampledAt, evidence.currentAt);
  }
});
test("settings validation preserves saved fields and rule changes reset pending counters", () => {
  assert.deepEqual(A.validateSettings({}, A.DEFAULTS), A.DEFAULTS);
  for (const bad of [{windowSeconds: 40}, {dropPercent: 0}, {dropPercent: NaN}, {dropPercent: "20"}, {minimumAbsoluteDrop: 0},
    {recoveryPercent: 20}, {recoveryPercent: -1}, {confirmations: 1.5}, {recoveryConfirmations: 21}]) assert.throws(() => A.validateSettings(bad));
  const f = fixture(); f.warm(); f.read(60, "$80"); f.read(65, "$80");
  f.engine.setSettings({dropPercent: 19}); f.read(70, "$80"); assert.equal(f.view().history.length, 0); assert.equal(f.view().states[0].pending, 1);
  f.read(75, "$80"); f.read(80, "$80"); const event = f.view().history[0];
  f.engine.setSettings({recoveryPercent: 10}); assert.equal(f.view().history[0].rule.recoveryPercent, 15);
  assert.equal(event.rule.dropPercent, 19); f.read(85, "$85"); f.read(90, "$85"); assert.notEqual(f.view().history[0].recoveredAt, null);
});
test("token, network, pool and currency changes do not bridge comparisons or pending confirmation", () => {
  for (const changed of [{...context, sourceKey: "other-token", mintAddress: "other"}, {...context, sourceKey: "other-pool", poolAddress: "other"},
    {...context, sourceKey: "other-network", blockchain: "eth"}]) {
    const f = fixture(); f.warm(); f.read(60, "$80"); f.recorder.setContext(changed); f.read(65, "$1");
    assert.equal(f.view().history.length, 0); assert.equal(f.view().states[0].status, "Collecting history");
    f.recorder.setContext(context); f.read(70, "$1"); assert.equal(f.view().states[0].status, "Collecting history");
  }
  const f = fixture(); f.warm(); f.read(60, "$80"); f.read(65, "1 SOL"); f.read(70, "$80");
  assert.equal(f.view().history.length, 0); assert.equal(H.analyze(f.rows.filter(r => r.unit === "USD")).durationMs, 0);
});
test("unknown DEX and unresolved pool remain eligible in their uninterrupted source session", () => {
  const f = fixture({confirmations: 1}); f.recorder.setContext({...context, sourceKey: "unresolved", poolAddress: null, dex: null});
  f.warm(); f.read(60, "$80"); assert.equal(f.view().history.length, 1);
  assert.equal(f.view().history[0].evidence.context.poolAddress, null); assert.equal(f.view().history[0].evidence.context.identityStatus, "unresolved");
});
test("reload preserves evidence/settings/deduplication and confirmed state without restoring a live connection or pending counts", () => {
  const f = fixture(); f.warm(); f.read(60, "$80");
  let saved = f.engine.exportState(); let restored = A.createEngine({now: f.now}); restored.restore(saved);
  assert.equal(restored.view(f.rows[0].tokenKey).states[0].pending, 0);
  assert.equal(restored.observe(f.rows.at(-1), f.rows).changed, false);
  assert.equal(restored.view(f.rows[0].tokenKey).states[0].live, false);
  f.read(65, "$80"); f.read(70, "$80"); f.read(75, "$85"); saved = f.engine.exportState();
  restored = A.createEngine({now: f.now}); restored.restore(saved);
  const view = restored.view(f.rows[0].tokenKey); assert.equal(view.history.length, 1); assert.equal(view.states[0].recovery, 0);
  assert.equal(view.states[0].status, "Data delayed/unavailable"); assert.deepEqual(view.history[0].evidence, saved.history[0].evidence);
  assert.equal(restored.observe({...f.rows.at(-1), restored: true}, f.rows).changed, false);
  const row = f.read(80, "$85"); restored.observe(row, f.rows);
  assert.equal(restored.view(row.tokenKey).history[0].recoveredAt, null, "Reloaded recovery count cannot carry over");
});
test("alert retention, episode IDs and checkpoints remain bounded without altering liquidity attempts", () => {
  const f = fixture({windowSeconds: 30, confirmations: 1, recoveryConfirmations: 1});
  for (let s = 0; s <= 30; s += 5) f.read(s, s === 30 ? "$80" : "$100");
  const saved = f.engine.exportState(), original = JSON.stringify(f.rows), event = saved.history[0];
  const events = Array.from({length: A.MAX_ALERTS + 30}, (_, i) => ({...event, id: `episode-${i}`, updatedAt: f.now() - i}));
  f.engine.restore({...saved, history: [...events, events[0]]}); assert.equal(f.engine.exportState().history.length, A.MAX_ALERTS);
  assert.equal(JSON.stringify(f.rows), original); f.advance(A.RETENTION_MS + 1); assert.equal(f.view().history.length, 0);
  const checkpoints = Array.from({length: 100}, (_, i) => ({key: `source-${i}`, tokenKey: "test", currency: "USD", lastSampledAt: start + i}));
  f.engine.restore({...saved, checkpoints}); assert.equal(f.engine.exportState().checkpoints.length, A.MAX_CONTEXTS);
});
test("a retained active episode survives checkpoint eviction without creating a duplicate or accepting replay", () => {
  const f = fixture({confirmations: 1}); f.warm(); const trigger = f.read(60, "$80");
  const saved = f.engine.exportState(); f.engine.restore({...saved, checkpoints: []});
  assert.equal(f.engine.observe(trigger, f.rows).changed, false);
  f.read(65, "$70"); assert.equal(f.view().history.length, 1); assert.equal(f.view().states[0].activeId, saved.history[0].id);
  f.read(70, "$85"); f.read(75, "$85"); assert.notEqual(f.view().history[0].recoveredAt, null);
});
