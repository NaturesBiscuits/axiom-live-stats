// Axiom Live Stats — read-only DOM extractor.
(() => {
  "use strict";
  const clean = (text) => (text ?? "").replace(/\s+/g, " ").trim();
  const labels = {
    globalFees: "Global Fees Paid", price: "Price", liquidity: "Liquidity",
    supply: "Supply", ath: "ATH", volume5m: "5m Vol",
    buys: "Buys", sells: "Sells", netVolume: "Net Vol."
  };
  let cachedSpans = [];
  let discoveryRoute = null;
  let lastDiscoveryAt = -Infinity;
  let discoveryNeeded = true;
  const isStatLabel = node => node.nodeType === 1 && node.childElementCount === 0 &&
    (Object.values(labels).includes(clean(node.textContent)) ||
      AxiomTokenInfo.labels.includes(clean(node.textContent)) ||
      /^(?:Holders\s*\([\d,]+\)|Bundlers|Top 10 H\.|Market\s?Cap|Mkt\s?Cap)$/i.test(clean(node.textContent)));
  function statSpans() {
    const route = AxiomTokenContextDetector.routeKey();
    const missing = cachedSpans.length === 0 || cachedSpans.some(node => !node.isConnected);
    if (route !== discoveryRoute || ((missing || discoveryNeeded) && Date.now() - lastDiscoveryAt >= 2500)) {
      cachedSpans = Array.from(document.querySelectorAll("span"))
        .filter(node => isStatLabel(node) && !node.closest('[data-perf-id*="table"], [role="row"], [data-perf-id="token-trades-panel"]'));
      discoveryRoute = route; lastDiscoveryAt = Date.now();
      discoveryNeeded = false;
    }
    return cachedSpans.filter(node => node.isConnected);
  }

  function readStat(spans, label) {
    const node = spans.find(el => clean(el.textContent) === label);
    if (!node?.parentElement) return null;
    return Array.from(node.parentElement.children)
      .filter(child => child !== node)
      .map(child => clean(child.innerText || child.textContent))
      .filter(Boolean).join(" ") || null;
  }

  const tokenInfoReader = AxiomTokenInfo.createReader();

  function collect() {
    const spans = statSpans();
    const leaves = spans.filter(el => el.childElementCount === 0);
    const stats = {};
    for (const [key, label] of Object.entries(labels)) {
      stats[key] = readStat(leaves, label);
    }
    const holdersNode = spans.find(el => /^Holders\s*\([\d,]+\)$/.test(clean(el.textContent)));
    stats.holders = clean(holdersNode?.textContent).match(/\(([\d,]+)\)/)?.[1] ?? null;
    const tokenInfo = tokenInfoReader.read(spans, {routeKey: AxiomTokenContextDetector.routeKey()});
    stats.bundlers = tokenInfo.tiles.bundlers.displayText;
    stats.top10Holders = tokenInfo.tiles.top10Holders.displayText;
    if (stats.globalFees === null && stats.volume5m === null && stats.liquidity === null &&
        !Object.values(tokenInfo.tiles).some(tile => tile.status === "available") &&
        tokenInfo.token.status !== "resolved" && tokenInfo.developer.status !== "resolved") return null;
    return {
      title: document.title || "Axiom token",
      url: location.origin + location.pathname,
      capturedAt: Date.now(), marketObservedAt: Date.now(), stats, tokenInfo
    };
  }

  let lastFingerprint = "";
  let lastSentAt = 0;
  let pendingTimer = null;
  let marketSnapshot = null;
  let collecting = false;
  let tokenPending = false;
  let contextDiscoveryNeeded = true;
  const identitySelector = '[data-token-mint], [data-mint-address], [data-token-address], [data-pool-address], [data-pair-address], [data-chain], [data-network], a[href*="geckoterminal.com/"], a[href*="solscan.io/account/"], a[href*="scan.io/token/"], a[href*="scan.com/token/"], a[href*="scan.org/token/"]';
  const rolling = AxiomRollingChart.createStore();
  const liveValues = AxiomLiveValueObserver.createReader((type, parsed, at, details) => rolling.observe(type, parsed, at, details));
  const liquidity = AxiomLiquidityHistory.createRecorder();
  const liquidityReader = AxiomLiveValueObserver.createReader(() => {}, Date.now, [["liquidity", ["liquidity"]]]);
  const pageKey = () => location.origin + location.pathname;
  const tradeMonitor = AxiomTradeFeed.createMonitor(packet => {
    try { chrome.runtime.sendMessage({type: "AXIOM_TRADES_UPDATE", packet}, () => { void chrome.runtime.lastError; }); }
    catch { /* Source collection is independent of the dashboard. */ }
  }, {ready: () => !tokenPending && !contextDiscoveryNeeded, contextNeeded: schedule});
  const insideObservedFeed = node => holderMonitor.contains(node) || tradeMonitor.contains(node);
  const holderMonitor = AxiomHolderTableExtractor.createMonitor(() => {
    // Holder mutations use the last market reading; they do not rescan the page.
    if (!collecting && !tokenPending && !contextDiscoveryNeeded && marketSnapshot?.chartContext?.routeKey === AxiomTokenContextDetector.routeKey()) sendSnapshot();
    else if (!collecting) schedule();
  });

  function sendSnapshot() {
    if (!marketSnapshot) return;
    const snapshot = {...marketSnapshot, capturedAt: Date.now(), holdersIntelligence: holderMonitor.getState(),
      tradingContext: tradeMonitor.context(), tradingStatus: tradeMonitor.getState()};
    const fingerprint = JSON.stringify({
      title: snapshot.title, url: snapshot.url, stats: snapshot.stats,
      holdersIntelligence: snapshot.holdersIntelligence, chartContext: snapshot.chartContext, liquidityContext: snapshot.liquidityContext,
      tokenInfo: snapshot.tokenInfo, tradingContext: snapshot.tradingContext, tradingStatus: snapshot.tradingStatus
    });
    if (fingerprint === lastFingerprint && Date.now() - lastSentAt < 3000) return;
    lastFingerprint = fingerprint;
    lastSentAt = Date.now();
    try {
      chrome.runtime.sendMessage({type: "AXIOM_STATS_UPDATE", snapshot}, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // Reload the source page after reloading the extension.
    }
  }

  function publish() {
    pendingTimer = null;
    const previousContext = marketSnapshot?.chartContext;
    const snapshot = collect();
    // Clear the previous token even when the new route has not loaded its stats.
    if (!snapshot && !marketSnapshot && !/^\/meme\//.test(location.pathname) && !tradeMonitor.discover()) return;
    marketSnapshot = snapshot || {
      title: document.title || "Axiom", url: pageKey(), stats: Object.fromEntries(
        [...Object.keys(labels), "holders", "bundlers", "top10Holders"].map(key => [key, null])
      )
    };
    const explicitToken = marketSnapshot.tokenInfo?.token;
    const identityFingerprint = JSON.stringify([explicitToken?.status, explicitToken?.candidates]);
    marketSnapshot.chartContext = !contextDiscoveryNeeded && previousContext?.routeKey === AxiomTokenContextDetector.routeKey() &&
      previousContext.tokenInfoFingerprint === identityFingerprint ? previousContext :
      {...AxiomTokenContextDetector.detect(document, location, explicitToken, marketSnapshot.tokenInfo), tokenInfoFingerprint: identityFingerprint};
    contextDiscoveryNeeded = false;
    // Chain/mint/pool query changes also delimit holder sessions without storing unrelated queries.
    marketSnapshot.tokenKey = marketSnapshot.chartContext.routeKey;
    rolling.setToken(marketSnapshot.chartContext);
    liveValues.setToken(marketSnapshot.chartContext.sourceKey);
    liveValues.bind(cachedSpans.filter(node => node.isConnected));
    liquidity.setContext(marketSnapshot.chartContext);
    marketSnapshot.liquidityContext = liquidity.context();
    liquidityReader.setToken(marketSnapshot.chartContext.sourceKey);
    liquidityReader.bind(cachedSpans.filter(node => node.isConnected));
    tokenPending = false;
    tradeMonitor.setContext(marketSnapshot.chartContext);
    collecting = true;
    try {
      holderMonitor.setContext(marketSnapshot.tokenKey, marketSnapshot.stats.holders, Boolean(snapshot), marketSnapshot.chartContext);
    } finally {
      collecting = false;
    }
    sendSnapshot();
    sampleLiquidity();
  }

  function schedule() {
    if (pendingTimer !== null) return;
    pendingTimer = setTimeout(publish, 500);
  }

  const marketObserver = new MutationObserver(records => {
    const identityChanged = records.some(record => !insideObservedFeed(record.target) &&
      ((record.type === "attributes" && (/^data-(?:token|mint|pool|pair|chain|network)/.test(record.attributeName) ||
        record.attributeName === "href" && record.target.matches(identitySelector))) ||
        [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])].some(node =>
          node.matches?.(identitySelector) || node.querySelector?.(identitySelector))));
    if (identityChanged) contextDiscoveryNeeded = true;
    if (records.some(record => !insideObservedFeed(record.target) &&
      Array.from(record.addedNodes ?? []).some(node => isStatLabel(node) ||
        Array.from(node.querySelectorAll?.("span") ?? []).some(isStatLabel)))) discoveryNeeded = true;
    if (marketSnapshot?.chartContext.routeKey !== AxiomTokenContextDetector.routeKey() ||
        identityChanged) {
      tokenPending = true;
    }
    const marketRecords = records.filter(record => !insideObservedFeed(record.target));
    if (!tokenPending) { liveValues.mutations(marketRecords); liquidityReader.mutations(marketRecords); }
    // The separate scoped observer handles holder rows, including recycled nodes.
    if (marketRecords.length) schedule();
  });
  marketObserver.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "aria-selected", "href", "title", "data-token-mint", "data-mint-address", "data-token-address", "data-pool-address", "data-pair-address", "data-chain", "data-network"]
  });
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  schedule();
  let heartbeat = setInterval(schedule, 2500);
  let samplerStart = null;
  let liquidityTimer = null;
  function sampleLiquidity() {
    const ready = marketSnapshot && !tokenPending && marketSnapshot.chartContext.routeKey === AxiomTokenContextDetector.routeKey();
    const row = ready ? liquidity.sample(() => liquidityReader.readAttempt("liquidity"), Date.now(), document.hidden) : null;
    clearTimeout(liquidityTimer);
    liquidityTimer = setTimeout(sampleLiquidity, ready ? liquidity.delay() : AxiomLiquidityHistory.CADENCE_MS);
    if (!row) return;
    try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_UPDATE", row}, () => { void chrome.runtime.lastError; }); }
    catch { /* Reloaded extension: never replay cached snapshots as observations. */ }
  }
  function startLiquiditySampler() {
    clearTimeout(liquidityTimer);
    sampleLiquidity();
  }
  function sample() {
    if (!marketSnapshot || tokenPending || marketSnapshot.chartContext.routeKey !== AxiomTokenContextDetector.routeKey()) {
      schedule(); return;
    }
    const started = performance.now();
    liveValues.readLatest();
    const domReadDurationMs = performance.now() - started;
    const packet = rolling.tick(Date.now(), document.hidden);
    if (!packet) return;
    const collectorDurationMs = performance.now() - started;
    for (const series of Object.values(packet.series)) for (const row of series.samples) if (!row.gap) {
      row.domReadDurationMs = domReadDurationMs;
      row.collectorDurationMs = collectorDurationMs;
    }
    try {
      chrome.runtime.sendMessage({type: "AXIOM_DOM_CHART_UPDATE", packet}, () => { void chrome.runtime.lastError; });
    } catch { /* Extension was reloaded; no synthetic observations are created. */ }
  }
  function startSampler() {
    clearTimeout(samplerStart);
    const run = () => {
      sample();
      samplerStart = setTimeout(run, Math.max(50, 1000 - Date.now() % 1000));
    };
    samplerStart = setTimeout(run, 1000 - Date.now() % 1000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { startSampler(); startLiquiditySampler(); } });
  startSampler();
  startLiquiditySampler();
  window.addEventListener("pagehide", () => {
    marketObserver.disconnect();
    holderMonitor.disconnect();
    tradeMonitor.disconnect();
    clearTimeout(pendingTimer);
    pendingTimer = null;
    clearInterval(heartbeat);
    clearTimeout(samplerStart);
    clearTimeout(liquidityTimer);
    try { chrome.runtime.sendMessage({type: "AXIOM_DOM_CHART_FLUSH"}, () => { void chrome.runtime.lastError; }); }
    catch { /* Best effort navigation flush; normal persistence is batched. */ }
    try { chrome.runtime.sendMessage({type: "AXIOM_TRADES_FLUSH"}, () => { void chrome.runtime.lastError; }); } catch { /* Best effort. */ }
  });
  // A back/forward-cache restore must resume observation without duplicate timers.
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    marketObserver.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "aria-selected", "href", "title", "data-token-mint", "data-mint-address", "data-token-address", "data-pool-address", "data-pair-address", "data-chain", "data-network"]
    });
    heartbeat = setInterval(schedule, 2500);
    schedule();
    startSampler();
    startLiquiditySampler();
  });
})();
