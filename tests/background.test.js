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
  localSaved.tradeRows ||= []; localSaved.tradeCoverage ||= {};
  const Trading = require("../tradingParticipation.js");
  const Archive = require("../sampleArchive.js");
  const fakeArchive = (liquidity = false) => {
    const records = liquidity ? "liquidityRows" : "archiveRows", meta = liquidity ? "liquidityMeta" : "archiveMeta";
    return {
    getMeta: async key => { if (key === "activity-v1" && options.failAlertReads) throw new Error("Alert metadata read fixture failure"); return localSaved[meta][key]; },
    setMeta: async (key, value) => { if (key === "activity-v1" && options.failAlerts) throw new Error("Alert metadata fixture failure"); localSaved[meta][key] = structuredClone(value); },
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
  runInNewContext(source, {console: {warn: error => warnings.push(error)}, Date: class extends Date { static now() { return clock; } },
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, {fn, at: clock + ms}); return id; },
    clearTimeout(id) { timers.delete(id); },
    importScripts(name) { imports.push(name); },
    AxiomSupply: require("../supplyValuation.js"), AxiomHolderConcentration: require("../holderConcentration.js"),
    AxiomAnalysisRecorder: {...require("../analysisRecorder.js"), createService: config => require("../analysisRecorder.js").createService({...config, now: () => clock})},
    AxiomAnalysisRecordingArchive: {createArchive: () => ({
      async load() { if (options.failRecordingReads) throw new Error("Recording read fixture failure"); return structuredClone(localSaved.recording ?? {session: null, rows: []}); },
      async replace(session, rows) { if (options.failRecording) throw new Error("Recording disk fixture failure"); localSaved.recording = structuredClone({session, rows}); },
      async save(session, row) { if (options.failRecording) throw new Error("Recording disk fixture failure"); localSaved.recording.session = structuredClone(session); if (row) localSaved.recording.rows.push(structuredClone(row)); }
    })},
    AxiomSampleArchive: {...Archive, createArchive: options => fakeArchive(options?.databaseName === "axiom-liquidity-v1")},
    AxiomLiquidityHistory: require("../liquidityHistory.js"),
    AxiomLiquidityAlerts: {...require("../liquidityAlerts.js"), createEngine: () => require("../liquidityAlerts.js").createEngine({now: () => clock})},
    AxiomTrading: {...Trading, createStore: () => Trading.createStore({now: () => clock})},
    AxiomTradingArchive: {createArchive: () => ({
      async write(rows, coverage) {
        if (options.failTrading) throw new Error("Trading disk fixture failure");
        localSaved.tradeRows = Trading.mergeRows(localSaved.tradeRows, rows);
        if (coverage) localSaved.tradeCoverage[coverage.tokenKey] = structuredClone(coverage);
      },
      async read(key) { if (options.failTrading) throw new Error("Trading disk fixture failure");
        return {events: localSaved.tradeRows.filter(row => row.tokenKey === key), coverage: localSaved.tradeCoverage[key], losses: []}; }
    })},
    AxiomRollingChart: {createStore: () => require("../rollingChartCollector.js").createStore({now: () => clock})}, chrome: {
    runtime: {getURL: () => url, onMessage: {addListener: callback => { onMessage = callback; }},
      sendMessage(message, callback) { broadcasts.push(message); callback?.(); }},
    storage: {local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, localSaved[key]])),
      set: async values => { localWrites.push(values); Object.assign(localSaved, structuredClone(values)); }
    }, session: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]])),
      set: async values => Object.assign(stored, structuredClone(values))
    }},
    tabs: {
      get: async id => { if (options.closedDashboard) throw new Error("Tab closed"); return {id, url}; },
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
    tokenInfo: {observedAt, developer: {address: "public-developer", observedAt}, funding: {relativeAgeText: "9mo", transactionTimestamp: null}},
    holdersIntelligence: {extractedAt: observedAt, extractionId: "original", rows: [{observedAt}]}};
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot}, {tab: {id: 42}, url: snapshot.url}); await flush();
  instance.advance(20000);
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: {...snapshot, capturedAt: instance.now()}}, {tab: {id: 42}, url: snapshot.url}); await flush();
  assert.equal(instance.stored.latestSnapshot.capturedAt, instance.now());
  assert.equal(instance.stored.latestSnapshot.marketObservedAt, observedAt);
  assert.deepEqual(instance.stored.latestSnapshot.tokenInfo, snapshot.tokenInfo);
  assert.equal(instance.stored.latestSnapshot.holdersIntelligence.extractedAt, observedAt);
  assert.equal(instance.stored.latestSnapshot.holdersIntelligence.rows[0].observedAt, observedAt);
});

const chartSender = {tab: {id: 42}, url: "https://axiom.trade/meme/token-a"};
function recordingSnapshot(at, key = "record-a") {
  return {title: "Recording fixture", url: chartSender.url, tokenKey: chartSender.url, capturedAt: at, marketObservedAt: at,
    chartContext: {sourceKey: key, routeKey: chartSender.url, blockchain: "eth", mintAddress: "0x" + "1".repeat(40)}, stats: {price: "$2", marketCap: "$999", supply: "1K"}};
}
const recordingSender = {url: "chrome-extension://fixture/dashboard.html"};
const recordingRequest = (instance, type, args = {}) => new Promise(resolve => instance.send({type, ...args}, recordingSender, resolve));

test("Manual recording commands are dashboard-only and require a recent source snapshot", async () => {
  const instance = worker(); let called = false;
  instance.send({type: "AXIOM_RECORDING_START"}, chartSender, () => { called = true; }); await flush(); assert.equal(called, false);
  assert.equal((await recordingRequest(instance, "AXIOM_RECORDING_START", {intervalMs: 5000, scope: "all"})).ok, false);
  const snapshot = recordingSnapshot(instance.now()); instance.send({type: "AXIOM_STATS_UPDATE", snapshot}, chartSender); await flush();
  const started = await recordingRequest(instance, "AXIOM_RECORDING_START", {intervalMs: 5000, scope: "all"});
  assert.equal(started.ok, true); assert.equal(started.session.count, 1); assert.equal(started.session.sourceTabId, 42);
  assert.equal(instance.localSaved.recording.rows[0].market.values.marketCap, "$999");
});

test("Worker records bounded analyzer summaries with dashboard closed and ignores other source tabs", async () => {
  const instance = worker({dashboardAutoOpened: true});
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: recordingSnapshot(instance.now())}, chartSender); await flush();
  await recordingRequest(instance, "AXIOM_RECORDING_START", {intervalMs: 5000, scope: "all"});
  instance.advance(5000);
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: recordingSnapshot(instance.now(), "other")}, {...chartSender, tab: {id: 99}}); await flush();
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: recordingSnapshot(instance.now())}, chartSender); await flush();
  const stopped = await recordingRequest(instance, "AXIOM_RECORDING_STOP");
  assert.equal(stopped.ok, true); assert.equal(stopped.session.count, 2); assert.match(stopped.text, /FIELD TIMELINES — one JSON object per line/);
  assert.equal(instance.created.length, 0); assert.equal(instance.localSaved.recording.rows[1].trading.status, "unavailable");
  assert.equal(instance.localSaved.recording.rows[1].holders.tableStatus, "unavailable"); assert.equal(instance.stored.latestSnapshot.stats.marketCap, "$999");
  assert.equal(instance.archiveWrites.length, 0); assert.equal(instance.warnings.length, 0);
});

test("Source switches stop a manual recording and worker restart restores an honest interrupted report", async () => {
  const instance = worker(); instance.send({type: "AXIOM_STATS_UPDATE", snapshot: recordingSnapshot(instance.now())}, chartSender); await flush();
  await recordingRequest(instance, "AXIOM_RECORDING_START", {intervalMs: 5000, scope: "supply"});
  instance.advance(5000); instance.send({type: "AXIOM_STATS_UPDATE", snapshot: recordingSnapshot(instance.now(), "new-token")}, chartSender); await flush();
  const stopped = await recordingRequest(instance, "AXIOM_RECORDING_STATUS"); assert.equal(stopped.session.stopReason, "source-token-or-network-changed");
  await recordingRequest(instance, "AXIOM_RECORDING_START", {intervalMs: 5000, scope: "supply"});
  const restarted = worker(instance.stored, instance.localSaved);
  const report = await recordingRequest(restarted, "AXIOM_RECORDING_REPORT"); assert.equal(report.ok, true); assert.match(report.session.stopReason, /interrupted/);
  assert.equal(report.session.count, 1); assert.equal(instance.localSaved.recording.rows[0].market, undefined);
});

test("All-summary recordings retain matching trading/liquidity data while excluding another tab on the same pool", async () => {
  const instance = worker(), trades = tradePacket(instance), context = trades.context;
  const liquidity = liquidityRow(instance.now(), context, "$500");
  instance.send({type: "AXIOM_TRADES_UPDATE", packet: trades}, chartSender);
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: liquidity}, chartSender); await flush();
  instance.send({type: "AXIOM_TRADES_UPDATE", packet: tradePacket(instance, ["other-tab-only"])}, {...chartSender, tab: {id: 99}});
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: liquidityRow(instance.now(), context, "3 SOL")}, {...chartSender, tab: {id: 99}}); await flush();
  const snapshot = {...recordingSnapshot(instance.now()), chartContext: context, tradingContext: context, tradingStatus: trades.coverage, liquidityContext: liquidity.tokenIdentity,
    tokenInfo: {source: "axiom-reported", observedAt: instance.now(), status: "observed", tiles: {developerHoldings: {value: 0, sourceText: "0%", status: "available"}}}};
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot}, chartSender); await flush();
  const start = await recordingRequest(instance, "AXIOM_RECORDING_START", {intervalMs: 5000, scope: "all"}); assert.equal(start.ok, true);
  const row = instance.localSaved.recording.rows[0]; assert.equal(row.trading.windows[0].buys, 2); assert.equal(row.trading.windows[0].totalVolume, 20);
  assert.equal(row.trading.windows[0].wallets, undefined); assert.equal(row.liquidity.series.length, 1); assert.equal(row.liquidity.series[0].unit, "USD");
  assert.equal(row.liquidity.series[0].summary.latest.value, 500); assert.equal(row.liquidity.activity.states.length, 1); assert.equal(row.tokenInfo.tiles.developerHoldings.value, 0);
});

test("Recording storage errors cannot stop ordinary market snapshot delivery", async () => {
  const instance = worker({}, {}, {failRecordingReads: true}); const snapshot = recordingSnapshot(instance.now());
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot}, chartSender); await flush();
  assert.deepEqual(instance.stored.latestSnapshot, snapshot);
  const start = await recordingRequest(instance, "AXIOM_RECORDING_START", {intervalMs: 5000, scope: "all"}); assert.equal(start.ok, false); assert.match(start.error, /read fixture/);
  instance.advance(5000); const next = recordingSnapshot(instance.now()); instance.send({type: "AXIOM_STATS_UPDATE", snapshot: next}, chartSender); await flush();
  assert.deepEqual(instance.stored.latestSnapshot, next);
});

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
  assert.deepEqual(instance.imports, ["rollingChartCollector.js", "sampleArchive.js", "liquidityHistory.js", "liquidityAlerts.js", "holderTableExtractor.js", "tradingParticipation.js", "tradingArchive.js", "supplyValuation.js", "holderConcentration.js", "analysisRecorder.js", "analysisRecordingArchive.js"], "Only local recording modules are loaded");
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

function tradePacket(instance, keys = ["signature-1-2-0", "signature-1-3-0"], rawAge = "6s") {
  const T = require("../tradingParticipation.js"), address = n => "0x" + n.toString(16).padStart(40, "0");
  const context = T.sourceContext({sourceKey: "worker-trades", routeKey: chartSender.url, blockchain: "eth", mintAddress: address(100), poolAddress: address(200)}, "worker", 1);
  const at = instance.now();
  return {context, coverage: {tokenKey: context.tokenKey, recordingStartedAt: at, lastReadAt: at, status: "available", filters: {status: "unknown", controls: []}},
    events: keys.map(key => T.makeEvent({eventKey: key, makerAddress: address(1), makerCandidates: [address(1)], identityStatus: "resolved",
      traderDisplay: "User label", direction: "buy", directionMarkers: ["text-increase"], rawAge,
      total: {value: 10, unit: "USD", displayText: "$10", status: "valid"}, tokenAmount: {value: null, status: "missing"}, filters: {status: "unknown", controls: []}}, context, at, "initial-sync"))};
}
test("Trade worker validates senders, deduplicates independently, and persists while no dashboard exists", async () => {
  const instance = worker(), packet = tradePacket(instance);
  const message = {type: "AXIOM_TRADES_UPDATE", packet};
  instance.send(message, {url: chartSender.url}); instance.send(message, {tab: {id: 1}, url: "https://evil.test/"});
  await flush(); assert(!instance.broadcasts.some(message => message.type === "AXIOM_TRADES_LIVE"));
  instance.send(message, chartSender); await flush();
  assert.equal(instance.created.length, 0, "Trade collection does not require or open a dashboard");
  assert.equal(instance.localSaved.tradeRows.length, 0, "Persistence is batched");
  instance.advance(2000); instance.send({type: "AXIOM_TRADES_UPDATE", packet: tradePacket(instance, undefined, "8s")}, chartSender); await flush();
  let response;
  assert.equal(instance.send({type: "AXIOM_TRADES_GET", tokenKey: packet.context.tokenKey}, {url: "https://axiom.trade/"}, value => response = value), undefined);
  await flush(); assert.equal(response, undefined, "Only dashboard can retrieve archive data");
  instance.send({type: "AXIOM_TRADES_GET", tokenKey: packet.context.tokenKey}, {url: "chrome-extension://fixture/dashboard.html"}, value => response = value); await flush();
  assert.equal(response.events.length, 2); assert.equal(response.events[0].estimatedTradeAt, packet.events[0].estimatedTradeAt);
  instance.advance(15000); await flush(); assert.equal(instance.localSaved.tradeRows.length, 2);
  assert.equal(instance.localSaved.tradeRows[0].firstSeenAt, packet.events[0].firstSeenAt);
  const restarted = worker({}, instance.localSaved);
  restarted.send({type: "AXIOM_TRADES_GET", tokenKey: packet.context.tokenKey}, {url: "chrome-extension://fixture/dashboard.html"}, value => response = value); await flush();
  assert.equal(response.events.length, 2); assert.equal(response.events[0].estimatedTradeAt, packet.events[0].estimatedTradeAt);
});
test("Trading disk errors preserve bounded live events and do not affect price persistence", async () => {
  const instance = worker({}, {}, {failTrading: true}), packet = tradePacket(instance);
  instance.send({type: "AXIOM_TRADES_UPDATE", packet}, chartSender);
  instance.send({type: "AXIOM_DOM_CHART_UPDATE", packet: packetAt(instance.now())}, chartSender); await flush();
  instance.send({type: "AXIOM_TRADES_FLUSH"}, chartSender); instance.send({type: "AXIOM_DOM_CHART_FLUSH"}, chartSender); await flush();
  assert.equal(instance.localSaved.archiveRows.length, 1); assert.equal(instance.localSaved.tradeRows.length, 0);
  const status = instance.broadcasts.findLast(message => message.type === "AXIOM_TRADES_LIVE" && message.archiveStatus.error);
  assert.match(status.archiveStatus.error, /Trading disk fixture failure/); assert.equal(status.archiveStatus.pending, 2);
  let response; instance.send({type: "AXIOM_TRADES_GET", tokenKey: packet.context.tokenKey}, {url: "chrome-extension://fixture/dashboard.html"}, value => response = value); await flush();
  assert.equal(response.events.length, 2); assert.match(response.archiveStatus.error, /fixture failure/);
});
test("Closing the dashboard keeps it closed while collection persists; the toolbar can reopen it", async () => {
  const instance = worker({dashboardAutoOpened: true, dashboardTabId: 7}, {}, {closedDashboard: true});
  instance.send({type: "AXIOM_STATS_UPDATE", snapshot: {url: chartSender.url, stats: {}}}, chartSender);
  instance.send({type: "AXIOM_TRADES_UPDATE", packet: tradePacket(instance)}, chartSender); await flush();
  instance.advance(15000); await flush();
  assert.equal(instance.created.length, 0); assert.equal(instance.localSaved.tradeRows.length, 2);
  instance.click(); await flush(); assert.equal(instance.created.length, 1); assert.equal(instance.created[0].active, true);
});
test("Trading pending-write cap is bounded and reports selected-source data-loss intervals", async () => {
  const instance = worker();
  for (let offset = 0; offset < 5001; offset += 500) {
    const keys = Array.from({length: Math.min(500, 5001 - offset)}, (_, index) => "bounded-event-" + (offset + index));
    instance.send({type: "AXIOM_TRADES_UPDATE", packet: tradePacket(instance, keys)}, chartSender); await flush();
  }
  const live = instance.broadcasts.findLast(message => message.type === "AXIOM_TRADES_LIVE");
  assert.equal(live.archiveStatus.pending, 5000); assert(live.losses.some(loss => loss.reason === "pending-write-cap" && loss.count === 1));
  instance.send({type: "AXIOM_TRADES_FLUSH"}, chartSender); await flush();
  assert.equal(instance.localSaved.tradeRows.length, 5000);
});

test("Liquidity alerts run with the dashboard closed, deduplicate worker messages and survive worker reload", async () => {
  const instance = worker(), sender = chartSender, dashboard = {url: "chrome-extension://fixture/dashboard.html"};
  let latest;
  for (let i = 0; i <= 14; i++) {
    latest = liquidityRow(instance.now(), undefined, i < 12 ? "$100" : "$80");
    instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: latest}, sender); await flush();
    if (i < 14) instance.advance(5000);
  }
  assert.equal(instance.created.length, 0);
  const broadcast = instance.broadcasts.findLast(message => message.type === "AXIOM_LIQUIDITY_LIVE");
  assert.equal(broadcast.activity.history.length, 1); assert.equal(broadcast.activity.states[0].status, "Liquidity drop detected");
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row: latest}, sender); await flush();
  assert.equal(instance.broadcasts.findLast(message => message.type === "AXIOM_LIQUIDITY_LIVE").activity.history.length, 1);
  instance.send({type: "AXIOM_DOM_CHART_FLUSH"}, sender); await flush();
  assert.equal(instance.localSaved.liquidityMeta["activity-v1"].history.length, 1);
  const restarted = worker(instance.stored, instance.localSaved); let reply;
  restarted.send({type: "AXIOM_LIQUIDITY_GET", tokenKey: latest.tokenKey}, dashboard, value => { reply = value; }); await flush();
  assert.equal(reply.live.length, 0); assert.equal(reply.activity.history.length, 1); assert.equal(reply.activity.states[0].live, false);
  assert.equal(reply.activity.states[0].status, "Data delayed/unavailable");
});

test("Liquidity rule settings are dashboard-only, validate fields, preserve archive configuration and surface alert storage failures", async () => {
  const instance = worker(), dashboard = {url: "chrome-extension://fixture/dashboard.html"}; let reply;
  instance.localSaved.liquidityMeta.settings = {retentionHours: 24, maxRecords: 10000};
  instance.send({type: "AXIOM_LIQUIDITY_ALERT_SETTINGS", settings: {dropPercent: 25}}, chartSender, value => { reply = value; }); await flush();
  assert.equal(reply, undefined);
  instance.send({type: "AXIOM_LIQUIDITY_ALERT_SETTINGS", settings: {dropPercent: 0}}, dashboard, value => { reply = value; }); await flush();
  assert.equal(reply.ok, false);
  instance.send({type: "AXIOM_LIQUIDITY_ALERT_SETTINGS", settings: {dropPercent: 25}}, dashboard, value => { reply = value; }); await flush();
  assert.equal(reply.ok, true); assert.equal(reply.activity.settings.confirmations, 3); assert.equal(reply.activity.settings.dropPercent, 25);
  assert.equal(instance.localSaved.liquidityMeta.settings.maxRecords, 10000);
  const restarted = worker({}, instance.localSaved);
  restarted.send({type: "AXIOM_LIQUIDITY_GET", tokenKey: "any"}, dashboard, value => { reply = value; }); await flush();
  assert.equal(reply.activity.settings.dropPercent, 25);
  const failed = worker({}, {}, {failAlerts: true});
  failed.send({type: "AXIOM_LIQUIDITY_ALERT_SETTINGS", settings: {dropPercent: 30}}, dashboard, value => { reply = value; }); await flush();
  assert.equal(reply.ok, true); assert.match(reply.activity.error, /metadata fixture failure/);
  failed.send({type: "AXIOM_DOM_CHART_UPDATE", packet: packetAt(failed.now())}, chartSender);
  failed.send({type: "AXIOM_LIQUIDITY_UPDATE", row: liquidityRow(failed.now())}, chartSender); await flush();
  failed.send({type: "AXIOM_DOM_CHART_FLUSH"}, chartSender); await flush();
  assert.equal(failed.localSaved.archiveRows.length, 1); assert.equal(failed.localSaved.liquidityRows.length, 1);
});

test("An alert metadata read failure cannot overwrite saved rules and does not stop liquidity recording", async () => {
  const saved = {liquidityMeta: {"activity-v1": {version: 1, settings: {...require("../liquidityAlerts.js").DEFAULTS, dropPercent: 35}, history: [], checkpoints: []}}};
  const instance = worker({}, saved, {failAlertReads: true}), row = liquidityRow(instance.now()); let reply;
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row}, chartSender); await flush();
  instance.send({type: "AXIOM_DOM_CHART_FLUSH"}, chartSender); await flush();
  assert.equal(instance.localSaved.liquidityRows.length, 1); assert.equal(instance.localSaved.liquidityMeta["activity-v1"].settings.dropPercent, 35);
  instance.send({type: "AXIOM_LIQUIDITY_GET", tokenKey: row.tokenKey}, {url: "chrome-extension://fixture/dashboard.html"}, value => { reply = value; }); await flush();
  assert.equal(reply.activity.ruleLoaded, false); assert.match(reply.activity.error, /read fixture failure/);
  instance.send({type: "AXIOM_LIQUIDITY_ALERT_SETTINGS", settings: {dropPercent: 25}}, {url: "chrome-extension://fixture/dashboard.html"}, value => { reply = value; }); await flush();
  assert.equal(reply.ok, false); assert.equal(instance.localSaved.liquidityMeta["activity-v1"].settings.dropPercent, 35);
});

test("A stored observation cannot advance alert confirmation even if its checkpoint write was lost", async () => {
  const row = {...liquidityRow(1700000000000), sourceTabId: chartSender.tab.id}, instance = worker({}, {liquidityRows: [row]});
  instance.send({type: "AXIOM_LIQUIDITY_UPDATE", row}, chartSender); await flush();
  const message = instance.broadcasts.findLast(message => message.type === "AXIOM_LIQUIDITY_LIVE");
  assert.equal(message.activity.states.length, 0); assert.equal(message.activity.history.length, 0);
});
