// Chrome MV3 worker: cache market stats and Holders Intelligence together.
// One atomic snapshot keeps holder observations paired with their source token/tab.
"use strict";
importScripts("rollingChartCollector.js");
importScripts("sampleArchive.js");
let opening = null;
const rollingCharts = AxiomRollingChart.createStore();
const archive = AxiomSampleArchive.createArchive();
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
      await archive.write(batch);
      for (const row of batch) if (pendingRecords.get(recordKey(row)) === row) pendingRecords.delete(recordKey(row));
      archiveError = null; archiveStats = await archive.stats();
      broadcastArchiveStatus();
    } catch (error) {
      chartDirty = true;
      archiveError = error.message; broadcastArchiveStatus();
      console.warn("Axiom rolling chart persistence:", error);
      schedulePersistence();
    }
  });
  return persistence;
}

function broadcastArchiveStatus() {
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
  if (["AXIOM_DOM_CHART_UPDATE", "AXIOM_DOM_CHART_FLUSH"].includes(message?.type)) {
    if (typeof sender.tab?.id !== "number" || !sender.url?.startsWith("https://axiom.trade/")) return;
    if (message.type === "AXIOM_DOM_CHART_UPDATE") receiveSamples(message.packet, sender);
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
