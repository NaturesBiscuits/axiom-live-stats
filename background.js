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
importScripts("supplyValuation.js");
importScripts("holderConcentration.js");
importScripts("bundlerDetection.js");
importScripts("analysisRecorder.js");
importScripts("analysisRecordingArchive.js");
importScripts("liveSignals.js");
importScripts("liveSignalArchive.js");
importScripts("liveSignalService.js");
const signalSnapshots = new Map(), signalKeys = new Map();
const liveSignals = AxiomLiveSignalService.createService({archive: AxiomLiveSignalArchive.createArchive(),
  onUpdate: signalBroadcast,
  hasPermission: () => chrome.permissions?.contains({permissions: ["notifications"]}) ?? Promise.resolve(false),
  notify: event => chrome.notifications.create(`axiom-signal-${event.triggeredAt}`, {type: "basic", iconUrl: chrome.runtime.getURL("signal-icon.svg"),
    title: event.type === "buy-trigger" ? "Entry conditions met" : event.type.startsWith("risk-warning:") ? "Observed risk warning" : "Tracked position exit conditions met",
    message: `${String(event.title ?? event.context.mintAddress ?? "Axiom token").slice(0, 60)} · tab ${event.sourceTabId} · ${event.currency} ${event.price}. Informational ${event.type}; no order executed. Open Live Signals for evidence.`})});
function signalBroadcast(result) {
  if (!result) return;
  try { chrome.runtime.sendMessage({type: "AXIOM_SIGNALS_STATE", ...result}, () => { void chrome.runtime.lastError; }); } catch { /* Dashboard may be closed. */ }
}
async function receiveSignalPrices(packet, tab, deliveredAt) {
  await Promise.all([tradingQueue, liquidityLoaded]);
  const snapshot = signalSnapshots.get(tab);
  if (!snapshot || AxiomAnalysisRecorder.scopeKey(snapshot.chartContext) !== AxiomAnalysisRecorder.scopeKey(packet.context) || packet.tokenKey !== packet.context?.sourceKey) return;
  const unit = packet.series?.price?.unit;
  for (const row of (packet.series?.price?.samples ?? []).slice(-900)) {
    const at = Date.now();
    if (row.stale || row.restored || row.gap || row.sampledAt > at + 1000 || row.sampledAt < at - 15000 || row.domReadAt > row.sampledAt + 1000) continue;
    if (signalSnapshots.get(tab)?.chartContext?.sourceKey !== packet.context.sourceKey) return;
    const input = AxiomLiveSignals.buildSnapshot({snapshot, extras: recordingExtras(snapshot, at, tab, {allActiveAlerts: true}),
      row: {...row, unit, deliveredAt}, sourceTabId: tab, at});
    if (!input) continue;
    signalKeys.set(tab, {key: input.key, sourceKey: snapshot.chartContext.sourceKey, scope: AxiomAnalysisRecorder.scopeKey(snapshot.chartContext)});
    await liveSignals.observe(input);
  }
}
const analysisRecording = AxiomAnalysisRecorder.createService({archive: AxiomAnalysisRecordingArchive.createArchive()});
function recordingBroadcast(result) {
  if (!result) return;
  try { chrome.runtime.sendMessage({type: "AXIOM_RECORDING_STATE", session: result.session}, () => { void chrome.runtime.lastError; }); }
  catch { /* Manual recording continues with the dashboard closed. */ }
}
function recordingExtras(snapshot, at, sourceTabId, {allActiveAlerts = false, includeHolderRows = false} = {}) {
  const context = snapshot.chartContext, holders = snapshot.holdersIntelligence;
  const matches = candidate => candidate && AxiomAnalysisRecorder.scopeKey(candidate) === AxiomAnalysisRecorder.scopeKey(context);
  const matched = matches(holders?.context) && holders?.tokenKey === snapshot.tokenKey;
  const concentration = AxiomHolderConcentration.analyze(matched ? holders : null, {now: at, excludePools: false});
  const tradingKey = matches(snapshot.tradingContext) ? snapshot.tradingContext.tokenKey : null, cachedCoverage = tradingCoverage.get(tradingKey);
  const coverage = tradingKey ? cachedCoverage?.sourceTabId === sourceTabId ? cachedCoverage : snapshot.tradingStatus ?? null : null;
  const tradeRows = tradingKey ? tradingLive.rows(tradingKey).filter(row => row.firstSeenAt <= at && row.sourceTabId === sourceTabId && matches(row.context)) : [];
  const summary = AxiomTrading.analyze(tradeRows, {now: at, seconds: 60, basis: "observation-time", coverage});
  const currencies = summary.currencies.length ? summary.currencies : [null];
  const trading = currencies.map(currency => {
    const result = AxiomTrading.analyze(tradeRows, {now: at, seconds: 60, basis: "observation-time", currency, coverage,
      losses: [...(tradingKey ? tradingLive.status(tradingKey).losses : []), tradingPendingLosses.get(tradingKey), tradingGlobalLoss].filter(Boolean)});
    const {wallets, ...counts} = result; return counts;
  });
  const liquidityKey = matches(snapshot.liquidityContext) ? snapshot.liquidityContext.tokenKey : null;
  const liquidity = [...liquidityRows.values()].map(rows => rows.filter(row => row.tokenKey === liquidityKey && row.sampledAt <= at && row.sourceTabId === sourceTabId))
    .filter(rows => rows.length).map(current => ({unit: current.at(-1)?.unit ?? null, summary: AxiomLiquidityHistory.analyze(current)}));
  const activity = alertSnapshot(liquidityKey);
  const fromThisTab = key => { try { return JSON.parse(key).at(-1) === sourceTabId; } catch { return false; } };
  const activityHistory = activity.history.filter(event => fromThisTab(event.scopeKey) && event.triggeredAt <= at);
  const includedHistory = allActiveAlerts ? activityHistory.filter((event, index) => index >= activityHistory.length - 5 || event.recoveredAt === null) : activityHistory.slice(-5);
  return {
    ...(includeHolderRows ? {bundlerDetection: AxiomBundlerDetection.analyze({snapshot, trades: tradeRows, coverage, sourceTabId, now: at})} : {}),
    holders: {source: "Axiom DOM; partial rendered table", extractedAt: matched ? holders.extractedAt ?? null : null,
      tableStatus: matched ? holders.tableStatus : "unavailable", renderedHolders: matched ? holders.renderedHolders : null,
      renderedBundlers: matched ? holders.renderedBundlers : null, unresolvedRendered: matched ? holders.unresolvedRendered : null,
      retainedSessionIdentities: matched ? holders.observedHolders : null, concentration,
      ...(includeHolderRows ? {
        coverage: "partial-virtualized", totalReported: matched ? holders.totalReported ?? null : null,
        extractionId: matched ? holders.extractionId ?? null : null,
        activeTable: matched ? holders.activeTable ?? null : null, sort: matched ? holders.sort ?? null : null,
        cacheTruncated: matched ? holders.cacheTruncated ?? null : null,
        renderedLimitReached: matched ? holders.renderedLimitReached ?? null : null,
        unsupportedRows: matched ? holders.unsupportedRows ?? null : null,
        duplicateRows: matched ? holders.duplicateRows ?? null : null,
        rows: matched && ["available", "unsupported"].includes(holders.tableStatus) ? holders.rows ?? [] : []
      } : {})},
    trading: {source: "Partial Axiom observed feed", status: coverage ? "observed-partial" : "unavailable", observedAt: coverage?.lastReadAt ?? null, filters: coverage?.filters ?? null,
      archiveError: tradingError, windows: trading},
    liquidity: {source: "Axiom-reported liquidity observations", status: liquidity.length ? "observed" : "unavailable", series: liquidity, storageError: liquidityError,
      activity: {settings: activity.settings, ruleLoaded: activity.ruleLoaded, states: activity.states.filter(state => fromThisTab(state.key) && state.lastSampledAt <= at), history: includedHistory,
        retainedAlerts: activityHistory.length, includedLatestAlerts: Math.min(5, activityHistory.length), error: activity.error}}
  };
}
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
    void receiveSignalPrices(delivered, sender.tab.id, receivedAt).catch(error => console.warn("Live signals:", error));
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
  if (message?.type === "AXIOM_BUNDLER_GET") {
    if (sender.url !== chrome.runtime.getURL("dashboard.html")) return;
    void (async () => {
      const saved = await chrome.storage.session.get(["latestSnapshot", "sourceTabId"]);
      const snapshot = signalSnapshots.get(message.sourceTabId) ?? (saved.sourceTabId === message.sourceTabId ? saved.latestSnapshot : null);
      if (!snapshot || message.scope !== AxiomAnalysisRecorder.scopeKey(snapshot.chartContext)) throw new Error("Selected bundler source changed; waiting for matching observations.");
      await tradingQueue;
      const current = signalSnapshots.get(message.sourceTabId);
      if (current && message.scope !== AxiomAnalysisRecorder.scopeKey(current.chartContext)) throw new Error("Selected bundler source changed during evaluation.");
      sendResponse({ok: true, result: recordingExtras(snapshot, Date.now(), message.sourceTabId, {includeHolderRows: true}).bundlerDetection});
    })().catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (["AXIOM_SIGNALS_STATUS", "AXIOM_SIGNALS_SETTINGS", "AXIOM_SIGNALS_POSITION", "AXIOM_SIGNALS_CLOSE", "AXIOM_SIGNALS_NOTIFICATIONS", "AXIOM_SIGNALS_EXPORT"].includes(message?.type)) {
    if (sender.url !== chrome.runtime.getURL("dashboard.html")) return;
    void (async () => {
      const selected = signalKeys.get(message.sourceTabId);
      const key = selected && selected.sourceKey === message.sourceKey && selected.scope === AxiomAnalysisRecorder.scopeKey(signalSnapshots.get(message.sourceTabId)?.chartContext) ? selected.key : "@waiting";
      if (["AXIOM_SIGNALS_POSITION", "AXIOM_SIGNALS_CLOSE"].includes(message.type) && (key === "@waiting" || message.key !== key)) throw new Error("Selected token/source changed; refresh Live Signals before changing a position.");
      if (message.type === "AXIOM_SIGNALS_SETTINGS") await liveSignals.settings(message.settings);
      if (message.type === "AXIOM_SIGNALS_POSITION") await liveSignals.position(key, message.position);
      if (message.type === "AXIOM_SIGNALS_CLOSE") await liveSignals.closePosition(key);
      if (message.type === "AXIOM_SIGNALS_NOTIFICATIONS") await liveSignals.notifications(message.enabled);
      const result = message.type === "AXIOM_SIGNALS_EXPORT" ? await liveSignals.export() : await liveSignals.status(key);
      sendResponse({ok: true, ...result});
    })().catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (["AXIOM_RECORDING_STATUS", "AXIOM_RECORDING_START", "AXIOM_RECORDING_STOP", "AXIOM_RECORDING_REPORT"].includes(message?.type)) {
    if (sender.url !== chrome.runtime.getURL("dashboard.html")) return;
    void (async () => {
      let result;
      if (message.type === "AXIOM_RECORDING_START") {
        const {latestSnapshot, sourceTabId} = await chrome.storage.session.get(["latestSnapshot", "sourceTabId"]);
        result = await analysisRecording.start(latestSnapshot, {sourceTabId, intervalMs: message.intervalMs, scope: message.scope}, at => recordingExtras(latestSnapshot, at, sourceTabId, {includeHolderRows: true}));
      } else if (message.type === "AXIOM_RECORDING_STOP") result = await analysisRecording.stop();
      else if (message.type === "AXIOM_RECORDING_REPORT") result = await analysisRecording.report();
      else { result = await analysisRecording.expire() ?? await analysisRecording.status(); }
      sendResponse({ok: true, ...result});
      if (["AXIOM_RECORDING_START", "AXIOM_RECORDING_STOP"].includes(message.type)) recordingBroadcast(result);
    })().catch(error => sendResponse({ok: false, error: error.message}));
    return true;
  }
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
  const priorSignalSnapshot = signalSnapshots.get(sender.tab.id);
  if (!priorSignalSnapshot || (message.snapshot.marketObservedAt ?? 0) >= (priorSignalSnapshot.marketObservedAt ?? 0)) signalSnapshots.set(sender.tab.id, message.snapshot);
  while (signalSnapshots.size > 16) { const key = signalSnapshots.keys().next().value; signalSnapshots.delete(key); signalKeys.delete(key); }
  void analysisRecording.observe(message.snapshot, sender.tab.id, Date.now(), at => recordingExtras(message.snapshot, at, sender.tab.id, {includeHolderRows: true}))
    .then(recordingBroadcast).catch(error => console.warn("Analysis recording:", error));
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
chrome.tabs.onRemoved?.addListener(tabId => {
  signalSnapshots.delete(tabId); signalKeys.delete(tabId);
  void liveSignals.interrupt(tabId).then(signalBroadcast).catch(error => console.warn("Live signals:", error));
  void analysisRecording.sourceClosed(tabId).then(recordingBroadcast).catch(error => console.warn("Analysis recording:", error));
});
