// Chrome MV3 worker: cache market stats and Holders Intelligence together.
// One atomic snapshot keeps holder observations paired with their source token/tab.
"use strict";
importScripts("rollingChartCollector.js");
importScripts("sampleArchive.js");
importScripts("liquidityHistory.js");
let opening = null;
const rollingCharts = AxiomRollingChart.createStore();
const archive = AxiomSampleArchive.createArchive();
const liquidityArchive = AxiomSampleArchive.createArchive({databaseName: "axiom-liquidity-v1",
  valueTypes: ["liquidity"], source: AxiomLiquidityHistory.SOURCE, maxTokenKeyLength: 4096,
  defaults: {retentionHours: AxiomLiquidityHistory.RETENTION_HOURS, maxRecords: AxiomLiquidityHistory.MAX_RECORDS},
  validateRow: AxiomLiquidityHistory.isAttempt});
const liquidityRows = new Map();
let liquidityError = null;
const liquidityLoaded = liquidityArchive.getSettings().catch(error => { liquidityError = error.message; });
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
      const results = await Promise.allSettled(batches.map((rows, index) => rows.length ?
        (index ? liquidityArchive : archive).write(rows) : Promise.resolve()));
      for (const [index, result] of results.entries()) {
        if (result.status === "fulfilled") {
          for (const row of batches[index]) if (pendingRecords.get(recordKey(row)) === row) pendingRecords.delete(recordKey(row));
        }
        if (batches[index].length) {
          const error = result.status === "rejected" ? result.reason.message : null;
          if (index) liquidityError = error; else archiveError = error;
        }
      }
      archiveStats = await archive.stats();
      chartDirty = pendingRecords.size > 0;
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
    const delivered = {...row, deliveredAt: receivedAt, sourceTabId: sender.tab.id};
    const key = recordKey(row), old = pendingRecords.get(key);
    if (old && old.sampledAt > row.sampledAt) return;
    const group = AxiomLiquidityHistory.seriesKey(row);
    const previous = liquidityRows.get(group);
    liquidityRows.delete(group);
    liquidityRows.set(group, AxiomLiquidityHistory.mergeRows(previous, [delivered])
      .filter(item => item.sampledAt >= receivedAt - 86400000).slice(-AxiomLiquidityHistory.MAX_RECORDS));
    while (liquidityRows.size > AxiomLiquidityHistory.MAX_SERIES) liquidityRows.delete(liquidityRows.keys().next().value);
    trimLiquidityRows(receivedAt);
    pendingRecords.set(key, delivered);
    while (pendingRecords.size > 5000) { pendingRecords.delete(pendingRecords.keys().next().value); droppedRecords++; }
    chartDirty = true; schedulePersistence();
    try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_LIVE", row: delivered}, () => { void chrome.runtime.lastError; }); }
    catch { /* The dashboard may be closed; collection and persistence continue. */ }
  }).catch(error => { liquidityError = error.message; });
}

function broadcastArchiveStatus() {
  try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_ARCHIVE_STATUS", error: liquidityError,
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
  if (message?.type === "AXIOM_LIQUIDITY_GET") {
    if (sender.url !== chrome.runtime.getURL("dashboard.html") || typeof message.tokenKey !== "string") return;
    void Promise.all([liquidityLoaded, chartQueue, persistence]).then(async () => {
      let saved = [];
      try {
        saved = (await liquidityArchive.readLatest(message.tokenKey, "liquidity", null,
          {windowSeconds: 86400, maxRows: AxiomLiquidityHistory.MAX_RECORDS, allUnits: true})).samples;
        liquidityError = null;
      } catch (error) { liquidityError = error.message; }
      trimLiquidityRows();
      const live = [...liquidityRows.values()].flat().filter(row => row.tokenKey === message.tokenKey);
      sendResponse({ok: true, saved, live, error: liquidityError,
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
    await ensureDashboard(false);
  })().catch(error => console.warn("Axiom Live Stats:", error));
});

chrome.action.onClicked.addListener(() => {
  void ensureDashboard(true).catch(console.warn);
});
