"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {resolve} = require("node:path");
const {runInNewContext} = require("node:vm");
const source = readFileSync(resolve(__dirname, "../background.js"), "utf8");
const flush = async () => { for (let index = 0; index < 4; index++) await new Promise(setImmediate); };

function worker(stored = {}, localSaved = {}) {
  let onMessage, onClicked;
  let clock = 1700000000000;
  let timerId = 0;
  const timers = new Map();
  const created = [], updated = [], warnings = [], broadcasts = [], localWrites = [], archiveWrites = [], imports = [];
  localSaved.archiveRows ||= []; localSaved.archiveMeta ||= {};
  const Archive = require("../sampleArchive.js");
  const fakeArchive = {
    getMeta: async key => localSaved.archiveMeta[key],
    setMeta: async (key, value) => { localSaved.archiveMeta[key] = value; },
    getSettings: async () => localSaved.archiveMeta.settings || Archive.DEFAULTS,
    setSettings: async value => (localSaved.archiveMeta.settings = Archive.settings(value)),
    stats: async () => ({count: localSaved.archiveRows.length}),
    write: async rows => {
      archiveWrites.push(rows);
      const byKey = new Map(localSaved.archiveRows.map(row => [JSON.stringify([row.tokenKey,row.valueType,row.unit,row.timestamp]), row]));
      for (const row of rows) if (!row.gap && Number.isFinite(row.sampledAt)) byKey.set(JSON.stringify([row.tokenKey,row.valueType,row.unit,row.timestamp]), row);
      localSaved.archiveRows = [...byKey.values()];
    },
    readLatest: async (key, metric) => {
      const rows = localSaved.archiveRows.filter(row => row.tokenKey === key && row.valueType === metric).sort((a,b) => a.timestamp-b.timestamp);
      return {unit: rows.at(-1)?.unit, end: rows.at(-1)?.timestamp, samples: rows.slice(-900)};
    }
  };
  const url = "chrome-extension://fixture/dashboard.html";
  runInNewContext(source, {console: {warn: error => warnings.push(error)}, Date: {now: () => clock},
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, at: clock + ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    importScripts(name) { imports.push(name); },
    AxiomSampleArchive: {...Archive, createArchive: () => fakeArchive},
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
  assert.deepEqual(instance.imports, ["rollingChartCollector.js", "sampleArchive.js"], "Only local recording modules are loaded");
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
