// Chrome MV3 worker: cache market stats and Holders Intelligence together.
// One atomic snapshot keeps holder observations paired with their source token/tab.
"use strict";
importScripts("rollingChartCollector.js");
importScripts("sampleArchive.js");
importScripts("liquidityHistory.js");
importScripts("liquidityAlerts.js");
importScripts("holderTableExtractor.js");
importScripts("tradingParticipation.js");
importScripts("tradingArchive.js");
const tradingArchive = AxiomTradingArchive.createArchive();
const tradingLive = AxiomTrading.createStore();
const tradingPending = new Map(), tradingCoverage = new Map(), tradingPendingLosses = new Map();
const tradingDirtyCoverage = new Set();
let tradingQueue = Promise.resolve(), tradingTimer = null, tradingError = null, tradingGlobalLoss = null;
function broadcastTrading(packet) {
  try { chrome.runtime.sendMessage({type: "AXIOM_TRADES_LIVE", ...packet}, () => { void chrome.runtime.lastError; }); }
  catch { /* Dashboard can remain closed while the source and worker collect. */ }
}
function scheduleTradingPersistence() {
  if (tradingTimer === null) tradingTimer = setTimeout(() => { tradingTimer = null; flushTrading(); }, 15000);
}
function flushTrading() {
  clearTimeout(tradingTimer); tradingTimer = null;
  tradingQueue = tradingQueue.catch(() => {}).then(async () => {
    let writeError = null;
    for (const tokenKey of new Set([...tradingDirtyCoverage, ...[...tradingPending.values()].map(row => row.tokenKey)])) {
      const coverage = tradingCoverage.get(tokenKey) ?? null;
      const rows = [...tradingPending.values()].filter(row => row.tokenKey === tokenKey);
      try {
        await tradingArchive.write(rows, coverage, [...tradingPendingLosses.values(), ...(tradingGlobalLoss ? [{...tradingGlobalLoss, tokenKey: "*"}] : [])]);
        for (const row of rows) if (tradingPending.get(AxiomTrading.eventKey(row)) === row) tradingPending.delete(AxiomTrading.eventKey(row));
        tradingDirtyCoverage.delete(tokenKey);
      } catch (error) { writeError = error.message; }
    }
    tradingError = writeError;
    broadcastTrading({archiveStatus: {error: tradingError, pending: tradingPending.size}});
    if (tradingPending.size || tradingDirtyCoverage.size) scheduleTradingPersistence();
  });
  return tradingQueue;
}
function receiveTrading(packet, sender) {
  tradingQueue = tradingQueue.catch(() => {}).then(() => {
    if (!packet?.context?.tokenKey || !Array.isArray(packet.events) || packet.events.length > 500 ||
        packet.coverage?.tokenKey !== packet.context.tokenKey || typeof packet.context.tokenKey !== "string" || packet.context.tokenKey.length > 4096) return;
    const now = Date.now();
    const valid = packet.events.filter(row => row.tokenKey === packet.context.tokenKey && row.context?.sourceKey === packet.context.sourceKey && AxiomTrading.isEvent(row, now))
      .map(row => ({...row, deliveredAt: now, sourceTabId: sender.tab.id}));
    const rows = tradingLive.ingest(valid);
    for (const row of rows) tradingPending.set(AxiomTrading.eventKey(row), row);
    while (tradingPending.size > 5000) {
      const key = tradingPending.keys().next().value, row = tradingPending.get(key); tradingPending.delete(key);
      tradingPendingLosses.set(row.tokenKey, AxiomTrading.mergeLoss(tradingPendingLosses.get(row.tokenKey), AxiomTrading.lossFor(row, "pending-write-cap")));
    }
    while (tradingPendingLosses.size > 64) { const key = tradingPendingLosses.keys().next().value; tradingGlobalLoss = AxiomTrading.mergeLoss(tradingGlobalLoss, tradingPendingLosses.get(key)); tradingPendingLosses.delete(key); }
    const prior = tradingCoverage.get(packet.context.tokenKey);
    tradingCoverage.delete(packet.context.tokenKey);
    const coverage = AxiomTrading.mergeCoverage(prior, {...packet.coverage, sourceTabId: sender.tab.id});
    tradingCoverage.set(packet.context.tokenKey, coverage);
    tradingDirtyCoverage.add(packet.context.tokenKey);
    while (tradingCoverage.size > 64) { const key = tradingCoverage.keys().next().value; tradingCoverage.delete(key); tradingDirtyCoverage.delete(key); }
    scheduleTradingPersistence();
    broadcastTrading({tokenKey: packet.context.tokenKey, events: rows, coverage, losses: [...tradingLive.status(packet.context.tokenKey).losses,
      tradingPendingLosses.get(packet.context.tokenKey), tradingGlobalLoss].filter(Boolean), archiveStatus: {error: tradingError, pending: tradingPending.size}});
  }).catch(error => { tradingError = error.message; });
}
let opening = null;
const rollingCharts = AxiomRollingChart.createStore();
const archive = AxiomSampleArchive.createArchive();
const liquidityArchive = AxiomSampleArchive.createArchive({databaseName: "axiom-liquidity-v1",
  valueTypes: ["liquidity"], source: AxiomLiquidityHistory.SOURCE, maxTokenKeyLength: 4096,
  defaults: {retentionHours: AxiomLiquidityHistory.RETENTION_HOURS, maxRecords: AxiomLiquidityHistory.MAX_RECORDS},
  validateRow: AxiomLiquidityHistory.isAttempt});
const liquidityRows = new Map();
let liquidityError = null;
const liquidityAlerts = AxiomLiquidityAlerts.createEngine();
let liquidityAlertError = null, liquidityAlertsDirty = false, liquidityAlertsRevision = 0, liquidityAlertsReady = false, liquidityAlertsLoading = null;
async function loadLiquidityAlerts() {
  if (liquidityAlertsReady) return;
  if (!liquidityAlertsLoading) liquidityAlertsLoading = liquidityArchive.getMeta("activity-v1").then(saved => {
    liquidityAlerts.restore(saved); liquidityAlertsReady = true; liquidityAlertError = null;
  }).finally(() => { liquidityAlertsLoading = null; });
  return liquidityAlertsLoading;
}
const liquidityLoaded = Promise.all([
  liquidityArchive.getSettings().catch(error => { liquidityError = error.message; }),
  loadLiquidityAlerts().catch(error => { liquidityAlertError = error.message; })]);
function alertSnapshot(tokenKey) { return {...liquidityAlerts.view(tokenKey), error: liquidityAlertError, ruleLoaded: liquidityAlertsReady}; }
async function persistLiquidityAlerts() {
  if (!liquidityAlertsDirty) return;
  const revision = liquidityAlertsRevision;
  await liquidityArchive.setMeta("activity-v1", liquidityAlerts.exportState());
  if (revision === liquidityAlertsRevision) liquidityAlertsDirty = false;
  liquidityAlertError = null;
}
function dirtyLiquidityAlerts() { liquidityAlertsDirty = true; liquidityAlertsRevision++; chartDirty = true; schedulePersistence(); }
let archiveError = null;
let archiveConfig = {...AxiomSampleArchive.DEFAULTS};
let archiveStats = {count: 0};
const pendingRecords = new Map();
let droppedRecords = 0;
const recordKey = row => JSON.stringify([row.tokenKey, row.valueType, row.unit, row.timestamp]);
const chartLoaded = chrome.storage.local.get("rollingChartHistories").then(async saved => {
  rollingCharts.restore(saved.rollingChartHistories);
  try {
    if (!await archive.getMeta("legacyMigrated")) {
      const legacy = [];
      for (const history of saved.rollingChartHistories ?? []) for (const [type, series] of Object.entries(history.series ?? {})) {
        for (const row of series.samples ?? []) if (!row.gap && Number.isFinite(row.sampledAt)) legacy.push({...row,
          tokenKey: history.tokenKey, tokenIdentity: history.context, valueType: type, unit: series.unit, source: "axiom-dom-sample"});
      }
      if (legacy.length) await archive.write(legacy);
      await archive.setMeta("legacyMigrated", true);
    }
    archiveConfig = await archive.getSettings(); archiveStats = await archive.stats();
  } catch (error) { archiveError = error.message; } // Live chart stays usable if local disk is unavailable.
});
let chartDirty = false;
let persistTimer = null;
let chartQueue = Promise.resolve();
let persistence = Promise.resolve();

function flushCharts() {
  clearTimeout(persistTimer); persistTimer = null;
  persistence = persistence.catch(() => {}).then(async () => {
    await chartLoaded;
    if (!chartDirty) return;
    chartDirty = false;
    try {
      const batch = [...pendingRecords.values()];
      const batches = [batch.filter(row => row.valueType !== "liquidity"), batch.filter(row => row.valueType === "liquidity")];
      const results = await Promise.allSettled([...batches.map((rows, index) => rows.length ?
        (index ? liquidityArchive : archive).write(rows) : Promise.resolve()), persistLiquidityAlerts()]);
      for (const [index, result] of results.entries()) {
        if (index === 2) { if (result.status === "rejected") liquidityAlertError = result.reason.message; continue; }
        if (result.status === "fulfilled") {
          for (const row of batches[index]) if (pendingRecords.get(recordKey(row)) === row) pendingRecords.delete(recordKey(row));
        }
        if (batches[index].length) {
          const error = result.status === "rejected" ? result.reason.message : null;
          if (index) liquidityError = error; else archiveError = error;
        }
      }
      archiveStats = await archive.stats();
      chartDirty = pendingRecords.size > 0 || liquidityAlertsDirty;
      broadcastArchiveStatus();
      if (chartDirty) schedulePersistence();
    } catch (error) {
      chartDirty = true;
      archiveError = error.message; broadcastArchiveStatus();
      console.warn("Axiom rolling chart persistence:", error);
      schedulePersistence();
    }
  });
  return persistence;
}

function trimLiquidityRows(at = Date.now()) {
  const retained = new Set([...liquidityRows.values()].flat().filter(row => row.sampledAt >= at - 86400000)
    .sort((a, b) => b.sampledAt - a.sampledAt).slice(0, AxiomLiquidityHistory.MAX_RECORDS));
  for (const [key, rows] of liquidityRows) {
    const kept = rows.filter(row => retained.has(row));
    if (kept.length) liquidityRows.set(key, kept); else liquidityRows.delete(key);
  }
}

function receiveLiquidity(row, sender) {
  chartQueue = chartQueue.catch(() => {}).then(async () => {
    await liquidityLoaded;
    const receivedAt = Date.now();
    if (!AxiomLiquidityHistory.isAttempt(row, receivedAt)) return;
    if (!liquidityAlertsReady) try { await loadLiquidityAlerts(); } catch (error) { liquidityAlertError = error.message; }
    const delivered = {...row, deliveredAt: receivedAt, sourceTabId: sender.tab.id};
    const key = recordKey(row), old = pendingRecords.get(key);
    if (old && old.sampledAt > row.sampledAt) return;
    const group = AxiomLiquidityHistory.seriesKey(row);
    let previous = liquidityRows.get(group);
    if (!previous) {
      try { previous = (await liquidityArchive.readLatest(row.tokenKey, "liquidity", null,
        {windowSeconds: 86400, maxRows: AxiomLiquidityHistory.MAX_RECORDS, allUnits: true})).samples
        .filter(item => item.unit === row.unit).map(item => ({...item, restored: true, deliveredAt: null})); }
      catch (error) { liquidityError = error.message; }
    }
    const alreadyRecorded = previous?.some(item => AxiomLiquidityAlerts.scopeKey(item) === AxiomLiquidityAlerts.scopeKey(delivered) && item.sampledAt >= row.sampledAt);
    liquidityRows.delete(group);
    liquidityRows.set(group, AxiomLiquidityHistory.mergeRows(previous, [delivered])
      .filter(item => item.sampledAt >= receivedAt - 86400000).slice(-AxiomLiquidityHistory.MAX_RECORDS));
    while (liquidityRows.size > AxiomLiquidityHistory.MAX_SERIES) liquidityRows.delete(liquidityRows.keys().next().value);
    trimLiquidityRows(receivedAt);
    const attempts = [...liquidityRows.values()].flat().filter(item => item.tokenKey === row.tokenKey);
    if (liquidityAlertsReady && !alreadyRecorded && liquidityAlerts.observe(delivered, attempts, receivedAt).changed) dirtyLiquidityAlerts();
    pendingRecords.set(key, delivered);
    while (pendingRecords.size > 5000) { pendingRecords.delete(pendingRecords.keys().next().value); droppedRecords++; }
    chartDirty = true; schedulePersistence();
    try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_LIVE", row: delivered, activity: alertSnapshot(row.tokenKey)}, () => { void chrome.runtime.lastError; }); }
    catch { /* The dashboard may be closed; collection and persistence continue. */ }
  }).catch(error => { liquidityError = error.message; });
}

function broadcastArchiveStatus() {
  try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_ARCHIVE_STATUS", error: liquidityError,
    alertError: liquidityAlertError,
    pendingCount: [...pendingRecords.values()].filter(row => row.valueType === "liquidity").length,
    droppedRecords}, () => { void chrome.runtime.lastError; }); }
  catch { /* No open dashboard. */ }
  try { chrome.runtime.sendMessage({type: "AXIOM_DOM_ARCHIVE_STATUS", error: archiveError,
    stats: archiveStats, settings: archiveConfig, pendingCount: pendingRecords.size, droppedRecords}, () => { void chrome.runtime.lastError; }); }
  catch { /* No open dashboard. */ }
}

function schedulePersistence() {
  if (persistTimer === null) persistTimer = setTimeout(() => { void flushCharts(); }, 15000);
}

function receiveSamples(packet, sender) {
  chartQueue = chartQueue.catch(() => {}).then(async () => {
    await chartLoaded;
    const receivedAt = Date.now();
    const delivered = {...packet, series: Object.fromEntries(Object.entries(packet?.series ?? {}).map(([type, series]) =>
      [type, {...series, samples: (series.samples ?? []).map(row => ({...row,
        deliveredAt: Number.isFinite(row.sampledAt) ? receivedAt : null,
        deliveryDelayMs: Number.isFinite(row.sampledAt) ? Math.max(0, receivedAt - row.sampledAt) : null}))}]))};
    if (!rollingCharts.merge(delivered)) return;
    for (const [type, series] of Object.entries(delivered.series)) for (const row of series.samples) {
      if (row.gap || !Number.isFinite(row.sampledAt)) continue;
      const normalized = {...row, tokenKey: delivered.tokenKey, tokenIdentity: {
        blockchain: delivered.context.blockchain ?? null, mintAddress: delivered.context.mintAddress ?? null,
        poolAddress: delivered.context.poolAddress ?? null, routeAddress: delivered.context.routeAddress ?? null},
        valueType: type, unit: series.unit, source: "axiom-dom-sample"};
      const key = recordKey(normalized), old = pendingRecords.get(key);
      if (old && old.sampledAt > normalized.sampledAt) continue;
      pendingRecords.set(key, normalized);
    }
    while (pendingRecords.size > 5000) { pendingRecords.delete(pendingRecords.keys().next().value); droppedRecords++; }
    chartDirty = true; schedulePersistence();
    try {
      chrome.runtime.sendMessage({type: "AXIOM_DOM_CHART_LIVE", packet: delivered,
        receivedAt, sourceTabId: sender.tab.id}, () => { void chrome.runtime.lastError; });
    } catch { /* Dashboard may not be open; retained history is still batched locally. */ }
  }).catch(error => console.warn("Axiom rolling chart:", error));
}

async function ensureDashboard(activate = false) {
  if (opening) return opening;
  opening = (async () => {
    const {dashboardTabId} = await chrome.storage.session.get("dashboardTabId");
    if (typeof dashboardTabId === "number") {
      try {
        const tab = await chrome.tabs.get(dashboardTabId);
        if (tab.url?.startsWith(chrome.runtime.getURL("dashboard.html"))) {
          if (activate) await chrome.tabs.update(dashboardTabId, {active: true});
          return dashboardTabId;
        }
      } catch { /* Dashboard tab was closed. */ }
    }
    const tab = await chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard.html"),
      active: activate // Don't hide the live Axiom source tab automatically.
    });
    await chrome.storage.session.set({dashboardTabId: tab.id});
    return tab.id;
  })();
  try { return await opening; }
  finally { opening = null; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AXIOM_LIQUIDITY_ALERT_SETTINGS") {
    if (sender.url !== chrome.runtime.getURL("dashboard.html")) return;
    chartQueue = chartQueue.catch(() => {}).then(async () => {
      await liquidityLoaded;
      await loadLiquidityAlerts();
      liquidityAlerts.setSettings(message.settings); dirtyLiquidityAlerts();
      try { await persistLiquidityAlerts(); }
      catch (error) { liquidityAlertError = error.message; }
      const activity = alertSnapshot(message.tokenKey);
      sendResponse({ok: true, activity});
      try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_ALERT_SETTINGS_LIVE", settings: activity.settings}, () => { void chrome.runtime.lastError; }); } catch { /* No dashboard. */ }
    }).catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message?.type === "AXIOM_TRADES_GET") {
    if (sender.url !== chrome.runtime.getURL("dashboard.html") || typeof message.tokenKey !== "string" || message.tokenKey.length > 4096) return;
    tradingQueue = tradingQueue.catch(() => {}).then(async () => {
      let saved = {events: [], coverage: null, losses: []};
      try { saved = await tradingArchive.read(message.tokenKey); if (!tradingPending.size && !tradingDirtyCoverage.size) tradingError = null; } catch (error) { tradingError = error.message; }
      sendResponse({ok: true, ...saved, events: AxiomTrading.mergeRows(saved.events, tradingLive.rows(message.tokenKey)),
        coverage: AxiomTrading.mergeCoverage(saved.coverage, tradingCoverage.get(message.tokenKey)),
        losses: [...saved.losses, ...tradingLive.status(message.tokenKey).losses, tradingPendingLosses.get(message.tokenKey), tradingGlobalLoss].filter(Boolean),
        archiveStatus: {error: tradingError, pending: tradingPending.size}, retentionMs: AxiomTrading.RETENTION_MS, maxRecords: AxiomTrading.MAX_RECORDS});
    }).catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (["AXIOM_TRADES_UPDATE", "AXIOM_TRADES_FLUSH"].includes(message?.type)) {
    if (typeof sender.tab?.id !== "number" || !sender.url?.startsWith("https://axiom.trade/")) return;
    if (message.type === "AXIOM_TRADES_UPDATE") receiveTrading(message.packet, sender); else void flushTrading();
    return;
  }
  if (message?.type === "AXIOM_LIQUIDITY_GET") {
    if (sender.url !== chrome.runtime.getURL("dashboard.html") || typeof message.tokenKey !== "string") return;
    void Promise.all([liquidityLoaded, chartQueue, persistence]).then(async () => {
      if (!liquidityAlertsReady) try { await loadLiquidityAlerts(); } catch (error) { liquidityAlertError = error.message; }
      let saved = [];
      try {
        saved = (await liquidityArchive.readLatest(message.tokenKey, "liquidity", null,
          {windowSeconds: 86400, maxRows: AxiomLiquidityHistory.MAX_RECORDS, allUnits: true})).samples;
        liquidityError = null;
      } catch (error) { liquidityError = error.message; }
      trimLiquidityRows();
      const live = [...liquidityRows.values()].flat().filter(row => row.tokenKey === message.tokenKey && !row.restored);
      sendResponse({ok: true, saved, live, error: liquidityError,
        activity: alertSnapshot(message.tokenKey),
        retentionHours: AxiomLiquidityHistory.RETENTION_HOURS, maxRecords: AxiomLiquidityHistory.MAX_RECORDS});
    }).catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message?.type === "AXIOM_DOM_CHART_GET") {
    if (sender.url !== chrome.runtime.getURL("dashboard.html")) return;
    void Promise.all([chartLoaded, chartQueue]).then(async () => {
      let recorded = null;
      if (typeof message.tokenKey === "string" && ["price", "marketCap"].includes(message.metric)) {
        try { recorded = await archive.readLatest(message.tokenKey, message.metric, message.endTimestamp); archiveStats = await archive.stats(); archiveError = null; }
        catch (error) { archiveError = error.message; }
      }
      sendResponse({ok: true, histories: rollingCharts.snapshot(), recorded, settings: archiveConfig,
        stats: archiveStats, archiveError, pendingCount: pendingRecords.size, droppedRecords});
    },
      error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message?.type === "AXIOM_DOM_ARCHIVE_SETTINGS") {
    if (sender.url !== chrome.runtime.getURL("dashboard.html")) return;
    void chartLoaded.then(async () => {
      archiveConfig = await archive.setSettings(message.settings);
      archiveStats = await archive.stats(); broadcastArchiveStatus();
      sendResponse({ok: true, settings: archiveConfig, stats: archiveStats});
    }).catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (["AXIOM_DOM_CHART_UPDATE", "AXIOM_DOM_CHART_FLUSH", "AXIOM_LIQUIDITY_UPDATE"].includes(message?.type)) {
    if (typeof sender.tab?.id !== "number" || !sender.url?.startsWith("https://axiom.trade/")) return;
    if (message.type === "AXIOM_DOM_CHART_UPDATE") receiveSamples(message.packet, sender);
    else if (message.type === "AXIOM_LIQUIDITY_UPDATE") receiveLiquidity(message.row, sender);
    else void chartQueue.then(flushCharts).catch(console.warn);
    return;
  }
  if (message?.type !== "AXIOM_STATS_UPDATE" || !message.snapshot) return;
  if (typeof sender.tab?.id !== "number" ||
      !sender.url?.startsWith("https://axiom.trade/")) return;
  void (async () => {
    await chrome.storage.session.set({
      latestSnapshot: message.snapshot,
      sourceTabId: sender.tab.id
    });
    const {dashboardAutoOpened} = await chrome.storage.session.get("dashboardAutoOpened");
    if (!dashboardAutoOpened) {
      await ensureDashboard(false);
      await chrome.storage.session.set({dashboardAutoOpened: true});
    }
  })().catch(error => console.warn("Axiom Live Stats:", error));
});

chrome.action.onClicked.addListener(() => {
  void ensureDashboard(true).catch(console.warn);
});
