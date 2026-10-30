"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");
const {runInNewContext} = require("node:vm");
const source = readFileSync(resolve(__dirname, "../background.js"), "utf8");
const flush = async () => { for (let index = 0; index < 4; index++) await new Promise(setImmediate); };

function worker(stored = {}, localSaved = {}, options = {}) {
  let onMessage, onClicked;
  let clock = 1700000000000;
  let timerId = 0;
  const timers = new Map();
  const created = [], updated = [], warnings = [], broadcasts = [], localWrites = [], archiveWrites = [], imports = [];
  localSaved.archiveRows ||= []; localSaved.archiveMeta ||= {};
  localSaved.liquidityRows ||= []; localSaved.liquidityMeta ||= {};
  const Archive = require("../sampleArchive.js");
  const fakeArchive = (liquidity = false) => {
    const records = liquidity ? "liquidityRows" : "archiveRows", meta = liquidity ? "liquidityMeta" : "archiveMeta";
    return {
    getMeta: async key => localSaved[meta][key],
    setMeta: async (key, value) => { localSaved[meta][key] = value; },
    getSettings: async () => localSaved[meta].settings || Archive.DEFAULTS,
    setSettings: async value => (localSaved[meta].settings = Archive.settings(value)),
    stats: async () => ({count: localSaved[records].length}),
    write: async rows => {
      if (!rows.length) return;
      if (liquidity && options.failLiquidity) throw new Error("Liquidity storage fixture failure");
      archiveWrites.push(rows);
      const byKey = new Map(localSaved[records].map(row => [JSON.stringify([row.tokenKey,row.valueType,row.unit,row.timestamp]), row]));
      for (const row of rows) if (!row.gap && Number.isFinite(row.sampledAt)) byKey.set(JSON.stringify([row.tokenKey,row.valueType,row.unit,row.timestamp]), row);
      localSaved[records] = [...byKey.values()];
    },
    readLatest: async (key, metric) => {
      const rows = localSaved[records].filter(row => row.tokenKey === key && row.valueType === metric).sort((a,b) => a.timestamp-b.timestamp);
      return {unit: rows.at(-1)?.unit, end: rows.at(-1)?.timestamp, samples: rows.slice(-900)};
    }
  }; };
  const url = "chrome-extension://fixture/dashboard.html";
  runInNewContext(source, {console: {warn: error => warnings.push(error)}, Date: {now: () => clock},
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, at: clock + ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    importScripts(name) { imports.push(name); },
    AxiomSampleArchive: {...Archive, createArchive: options => fakeArchive(options?.databaseName === "axiom-liquidity-v1")},
    AxiomLiquidityHistory: require("../liquidityHistory.js"),
    AxiomRollingChart: {createStore: () => require("../rollingChartCollector.js").createStore({now: () => clock})}, chrome: {
    runtime: {getURL: () => url, onMessage: {addListener: callback => { onMessage = callback; }},
      sendMessage(message, callback) { broadcasts.push(message); callback?.(); }},
    storage: {local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, localSaved[key]])),
      set: async values => { localWrites.push(values); Object.assign(localSaved, structuredClone(values)); }
    }, session: {
      get: async key => ({[key]: stored[key]}),
      set: async values => Object.assign(stored, structuredClone(values))
    }},
    tabs: {
      get: async id => ({id, url}),
      create: async options => { created.push(options); return {id: 7, url}; },
      update: async (id, options) => { updated.push({id, ...options}); }
    },
    action: {onClicked: {addListener: callback => { onClicked = callback; }}}
  }});
  return {send: (message, sender, reply = () => {}) => onMessage(message, sender, reply),
    click: () => onClicked(), stored, localSaved, created, updated, warnings, broadcasts, localWrites, archiveWrites, imports,
    now: () => clock, advance(ms) {
      clock += ms;
      for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
    }};
}

test("background validates source, atomically stores holder/market snapshot and reuses dashboard", async () => {
  const instance = worker();
  const snapshot = {url: "https://axiom.trade/meme/token-a", stats: {holders: "123"},
    holdersIntelligence: {tokenKey: "https://axiom.trade/meme/token-a", rows: [{axiomBundler: true}]}};
  const message = {type: "AXIOM_STATS_UPDATE", snapshot};
  instance.send(message, {tab: {id: 42}, url: "https://example.com/"});
  instance.send(message, {url: snapshot.url});
  await flush();
  assert.deepEqual(instance.stored, {});
  const sender = {tab: {id: 42}, url: snapshot.url};
  instance.send(message, sender);
  await flush();
  assert.deepEqual(instance.stored.latestSnapshot, snapshot);
  assert.equal(instance.stored.sourceTabId, 42);
  assert.equal(instance.created.length, 1);
  assert.equal(instance.created[0].active, false);
  const next = structuredClone(snapshot);
  next.url = "https://axiom.trade/meme/token-b";
  next.holdersIntelligence = {tokenKey: next.url, rows: [], observedHolders: 0};
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: next}, {...sender, url: next.url});
  await flush();
  assert.deepEqual(instance.stored.latestSnapshot, next);
  assert.equal(instance.created.length, 1);
  instance.click();
  await flush();
  assert.deepEqual(instance.updated, [{id: 7, active: true}]);
  const restarted = worker(instance.stored);
  restarted.click();
  await flush();
  assert.equal(restarted.created.length, 0);
  assert.equal(restarted.updated.length, 1);
  assert.equal(instance.warnings.length, 0);
});

test("background remains compatible with market-only snapshots", async () => {
  const instance = worker();
  const snapshot = {url: "https://axiom.trade/meme/token-a", stats: {bundlers: "12.5%"}};
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot}, {tab: {id: 42}, url: snapshot.url});
  await flush();
  assert.deepEqual(instance.stored.latestSnapshot, snapshot);
  assert.equal(instance.created.length, 1);
});

test("republished snapshots preserve independent holder and market extraction timestamps", async () => {
  const instance = worker(), observedAt = instance.now();
  const snapshot = {url: "https://axiom.trade/meme/token-a", capturedAt: observedAt, marketObservedAt: observedAt, stats: {top10Holders: "14.05%"},
    holdersIntelligence: {extractedAt: observedAt, extractionId: "original", rows: [{observedAt}]}};
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot}, {tab: {id: 42}, url: snapshot.url}); await flush();
  instance.advance(20000);
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: {...snapshot, capturedAt: instance.now()}}, {tab: {id: 42}, url: snapshot.url}); await flush();
  assert.equal(instance.stored.latestSnapshot.capturedAt, instance.now());
  assert.equal(instance.stored.latestSnapshot.marketObservedAt, observedAt);
  assert.equal(instance.stored.latestSnapshot.holdersIntelligence.extractedAt, observedAt);
  assert.equal(instance.stored.latestSnapshot.holdersIntelligence.rows[0].observedAt, observedAt);
});

const chartSender = {tab: {id: 42}, url: "https://axiom.trade/meme/token-a"};
function packetAt(at, key = "token-a", value = 1) {
  const model = require("../rollingChartCollector.js").createStore({now: () => at});
  model.setToken({sourceKey: key, blockchain: "solana", routeKey: "https://axiom.trade/meme/" + key});
  model.observe("price", {value, unit: "USD"}, at);
  return model.tick(at);
}

test("rolling chart delivery is live but persistence is batched every 15 seconds", async () => {
  const instance = worker();
  for (let index = 0; index < 16; index++) {
    instance.send({type: "AXIOM_DOM_CHART_UPDATE", packet: packetAt(instance.now())}, chartSender);
    await flush();
    if (index < 14) assert.equal(instance.localWrites.length, 0, "No every-second chart storage writes");
    instance.advance(1000); await flush();
  }
  assert.equal(instance.broadcasts.filter(message => message.type === "AXIOM_DOM_CHART_LIVE").length, 16);
  assert.equal(instance.localWrites.length, 0);
  assert.equal(instance.archiveWrites.length, 1);
  assert.equal(instance.localSaved.archiveRows.length, 15);
  assert.deepEqual(instance.imports, ["rollingChartCollector.js", "sampleArchive.js", "liquidityHistory.js"], "Only local recording modules are loaded");
  assert.equal(instance.stored.chartState, undefined, "No per-second chart session-storage writes");
});

test("local history request is dashboard-only; source navigation flush persists latest token-isolated samples", async () => {
  const instance = worker();
  instance.send({type: "AXIOM_DOM_CHART_UPDATE", packet: packetAt(instance.now())}, {tab: {id: 42}, url: "https://example.com/"});
  await flush(); assert.equal(instance.broadcasts.length, 0);
  instance.send({type: "AXIOM_DOM_CHART_UPDATE", packet: packetAt(instance.now())}, chartSender);
  instance.advance(1000);
  instance.send({type: "AXIOM_DOM_CHART_UPDATE", packet: packetAt(instance.now(), "token-b", 2)}, chartSender);
  await flush();
  let reply;
  assert.equal(instance.send({type: "AXIOM_DOM_CHART_GET"}, chartSender, value => { reply = value; }), undefined);
  assert.equal(reply, undefined);
  assert.equal(instance.send({type: "AXIOM_DOM_CHART_GET"}, {url: "chrome-extension://fixture/dashboard.html"}, value => { reply = value; }), true);
  await flush();
  assert.equal(reply.histories.length, 2);
  assert.equal(reply.histories[0].series.price.samples[0].value, 1);
  assert.equal(reply.histories[1].series.price.samples[0].value, 2);
  instance.send({type: "AXIOM_DOM_CHART_FLUSH"}, chartSender);
  await flush(); assert.equal(instance.localWrites.length, 0);
  assert.equal(instance.archiveWrites.length, 1);
  const restarted = worker(instance.stored, instance.localSaved);
  restarted.send({type: "AXIOM_DOM_CHART_GET", tokenKey: "token-a", metric: "price"}, {url: "chrome-extension://fixture/dashboard.html"}, value => { reply = value; });
  await flush();
  assert.equal(reply.recorded.samples.length, 1, "Recorded data survives worker restart");
  assert.equal(reply.histories.length, 0, "Disk history does not seed a live connection");
});


test("broker timestamps delivery independently and retention settings are restricted to the dashboard", async () => {
  const instance = worker();
  const packet = packetAt(instance.now()); instance.advance(2000);
  instance.send({type: "AXIOM_DOM_CHART_UPDATE", packet}, chartSender); await flush();
  const delivered = instance.broadcasts.find(message => message.type === "AXIOM_DOM_CHART_LIVE").packet.series.price.samples[0];
  assert.equal(delivered.deliveredAt, instance.now());
  assert.equal(delivered.deliveryDelayMs, 2000);
  assert.equal(delivered.sampledAt + 2000, delivered.deliveredAt);
  let response;
  instance.send({type: "AXIOM_DOM_ARCHIVE_SETTINGS", settings: {retentionHours: 72, maxRecords: 10000}}, chartSender, value => { response = value; });
  await flush(); assert.equal(response, undefined);
  instance.send({type: "AXIOM_DOM_ARCHIVE_SETTINGS", settings: {retentionHours: 72, maxRecords: 10000}}, {url: "chrome-extension://fixture/dashboard.html"}, value => { response = value; });
  await flush(); assert.equal(response.settings.retentionHours, 72); assert.equal(response.settings.maxRecords, 10000);
});

function liquidityRow(at, context = {sourceKey: "pool-a", blockchain: "solana", mintAddress: "mint", poolAddress: "pool-a"}, text = "$5.56K") {
  const recorder = require("../liquidityHistory.js").createRecorder({sessionId: "worker-test"});
  recorder.setContext(context);
  return recorder.sample(() => ({displayText: text, domReadAt: at}), at);
}

test("liquidity source validation, five-second observations and snapshot republishes remain independent", async () => {
  const instance = worker(), first = liquidityRow(instance.now());
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: first}, {tab: {id: 1}, url: "https://example.com/"});
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: {...first, status: "missing", value: 0}}, chartSender);
  await flush(); assert.equal(instance.broadcasts.length, 0);
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: first}, chartSender);
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: {stats: {liquidity: "$99M"}, capturedAt: instance.now()}}, chartSender);
  instance.advance(5000);
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: liquidityRow(instance.now())}, chartSender);
  await flush();
  const delivered = instance.broadcasts.filter(message => message.type === "AXIOM_LIQUIDITY_LIVE");
  assert.equal(delivered.length, 2); assert.equal(delivered[1].row.value, first.value);
  assert.equal(delivered[1].row.observedAt - delivered[0].row.observedAt, 5000);
  assert.equal(instance.archiveWrites.length, 0, "No immediate per-attempt writes");
  let reply;
  instance.send({type: "AXIOM_LIQUIDITY_GET", tokenKey: first.tokenKey}, chartSender, value => { reply = value; });
  await flush(); assert.equal(reply, undefined);
  instance.send({type: "AXIOM_LIQUIDITY_GET", tokenKey: first.tokenKey}, {url: "chrome-extension://fixture/dashboard.html"}, value => { reply = value; });
  await flush(); assert.equal(reply.live.length, 2); assert.equal(reply.saved.length, 0);
  instance.send({type: "AXIOM_DOM_CHART_FLUSH"}, chartSender); await flush();
  assert.equal(instance.localSaved.liquidityRows.length, 2); assert.equal(instance.localSaved.archiveRows.length, 0);
  const restarted = worker(instance.stored, instance.localSaved);
  restarted.send({type: "AXIOM_LIQUIDITY_GET", tokenKey: first.tokenKey}, {url: "chrome-extension://fixture/dashboard.html"}, value => { reply = value; });
  await flush(); assert.equal(reply.live.length, 0, "Restored timestamps never imply a live source");
  assert.equal(reply.saved.length, 2); assert.equal(reply.saved[0].observedAt, first.observedAt);
});

test("a liquidity disk failure leaves price persistence working and reports the separate storage error", async () => {
  const instance = worker({}, {}, {failLiquidity: true});
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: liquidityRow(instance.now())}, chartSender);
  instance.send({type: "AXIOM_DOM_CHART_UPDATE", packet: packetAt(instance.now())}, chartSender);
  await flush(); instance.send({type: "AXIOM_DOM_CHART_FLUSH"}, chartSender); await flush();
  assert.equal(instance.localSaved.archiveRows.length, 1);
  assert.equal(instance.localSaved.liquidityRows.length, 0);
  assert.equal(instance.broadcasts.findLast(message => message.type === "AXIOM_DOM_ARCHIVE_STATUS").error, null);
  const liquidity = instance.broadcasts.findLast(message => message.type === "AXIOM_LIQUIDITY_ARCHIVE_STATUS");
  assert.match(liquidity.error, /fixture failure/); assert.equal(liquidity.pendingCount, 1);
});
