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
      /^(?:Holders\s*\([\d,]+\)|Bundlers|Market\s?Cap|Mkt\s?Cap)$/i.test(clean(node.textContent)));
  function statSpans() {
    const route = AxiomTokenContextDetector.routeKey();
    const missing = cachedSpans.length === 0 || cachedSpans.some(node => !node.isConnected);
    if (route !== discoveryRoute || ((missing || discoveryNeeded) && Date.now() - lastDiscoveryAt >= 2500)) {
      cachedSpans = Array.from(document.querySelectorAll("span"))
        .filter(node => isStatLabel(node) && !node.closest('[data-perf-id*="table"], [role="row"]'));
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

  // Axiom's Token Info tiles put the percentage ABOVE the text label.
  // This reads Axiom's displayed bundle-holder percentage; it does not
  // independently classify on-chain bundles or wallets.
  function readTokenInfoPercent(spans, label) {
    const node = spans.find(el =>
      el.childElementCount === 0 && clean(el.textContent) === label
    );
    const card = node?.parentElement?.parentElement;
    if (!card) return null;
    return Array.from(card.querySelectorAll("span"))
      .map(el => clean(el.textContent))
      .find(text => /^\d+(?:\.\d+)?%$/.test(text)) ?? null;
  }

  function collect() {
    const spans = statSpans();
    const leaves = spans.filter(el => el.childElementCount === 0);
    const stats = {};
    for (const [key, label] of Object.entries(labels)) {
      stats[key] = readStat(leaves, label);
    }
    const holdersNode = spans.find(el => /^Holders\s*\([\d,]+\)$/.test(clean(el.textContent)));
    stats.holders = clean(holdersNode?.textContent).match(/\(([\d,]+)\)/)?.[1] ?? null;
    stats.bundlers = readTokenInfoPercent(spans, "Bundlers");
    if (stats.globalFees === null && stats.volume5m === null) return null;
    return {
      title: document.title || "Axiom token",
      url: location.origin + location.pathname,
      capturedAt: Date.now(), stats
    };
  }

  let lastFingerprint = "";
  let lastSentAt = 0;
  let pendingTimer = null;
  let marketSnapshot = null;
  let collecting = false;
  let tokenPending = false;
  let contextDiscoveryNeeded = true;
  const identitySelector = '[data-token-mint], [data-mint-address], [data-token-address], [data-pool-address], [data-pair-address], [data-chain], [data-network], a[href*="geckoterminal.com/"], a[href*="scan.io/token/"], a[href*="scan.com/token/"], a[href*="scan.org/token/"]';
  const rolling = AxiomRollingChart.createStore();
  const liveValues = AxiomLiveValueObserver.createReader((type, parsed, at, details) => rolling.observe(type, parsed, at, details));
  const pageKey = () => location.origin + location.pathname;
  const holderMonitor = AxiomHolderTableExtractor.createMonitor(() => {
    // Holder mutations use the last market reading; they do not rescan the page.
    if (!collecting && marketSnapshot?.chartContext?.routeKey === AxiomTokenContextDetector.routeKey()) sendSnapshot();
    else if (!collecting) schedule();
  });

  function sendSnapshot() {
    if (!marketSnapshot) return;
    const snapshot = {...marketSnapshot, capturedAt: Date.now(), holdersIntelligence: holderMonitor.getState()};
    const fingerprint = JSON.stringify({
      title: snapshot.title, url: snapshot.url, stats: snapshot.stats,
      holdersIntelligence: snapshot.holdersIntelligence, chartContext: snapshot.chartContext
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
    if (!snapshot && !marketSnapshot) return;
    marketSnapshot = snapshot || {
      title: document.title || "Axiom", url: pageKey(), stats: Object.fromEntries(
        [...Object.keys(labels), "holders", "bundlers"].map(key => [key, null])
      )
    };
    marketSnapshot.chartContext = !contextDiscoveryNeeded && previousContext?.routeKey === AxiomTokenContextDetector.routeKey() ?
      previousContext : AxiomTokenContextDetector.detect();
    contextDiscoveryNeeded = false;
    // Chain/mint/pool query changes also delimit holder sessions without storing unrelated queries.
    marketSnapshot.tokenKey = marketSnapshot.chartContext.routeKey;
    rolling.setToken(marketSnapshot.chartContext);
    liveValues.setToken(marketSnapshot.chartContext.sourceKey);
    liveValues.bind(cachedSpans.filter(node => node.isConnected));
    tokenPending = false;
    collecting = true;
    try {
      holderMonitor.setContext(marketSnapshot.tokenKey, marketSnapshot.stats.holders, Boolean(snapshot));
    } finally {
      collecting = false;
    }
    sendSnapshot();
  }

  function schedule() {
    if (pendingTimer !== null) return;
    pendingTimer = setTimeout(publish, 500);
  }

  const marketObserver = new MutationObserver(records => {
    const identityChanged = records.some(record => !holderMonitor.contains(record.target) &&
      ((record.type === "attributes" && /^data-(?:token|mint|pool|pair|chain|network)/.test(record.attributeName)) ||
        [...(record.addedNodes ?? []), ...(record.removedNodes ?? [])].some(node =>
          node.matches?.(identitySelector) || node.querySelector?.(identitySelector))));
    if (identityChanged) contextDiscoveryNeeded = true;
    if (records.some(record => !holderMonitor.contains(record.target) &&
      Array.from(record.addedNodes ?? []).some(node => isStatLabel(node) ||
        Array.from(node.querySelectorAll?.("span") ?? []).some(isStatLabel)))) discoveryNeeded = true;
    if (marketSnapshot?.chartContext.routeKey !== AxiomTokenContextDetector.routeKey() ||
        identityChanged) {
      tokenPending = true;
    }
    if (!tokenPending) liveValues.mutations(records);
    // The separate scoped observer handles holder rows, including recycled nodes.
    if (records.some(record => !holderMonitor.contains(record.target))) schedule();
  });
  marketObserver.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "data-token-mint", "data-mint-address", "data-token-address", "data-pool-address", "data-pair-address", "data-chain", "data-network"]
  });
  window.addEventListener("popstate", schedule);
  window.addEventListener("hashchange", schedule);
  schedule();
  let heartbeat = setInterval(schedule, 2500);
  let samplerStart = null;
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
  document.addEventListener("visibilitychange", () => { if (!document.hidden) startSampler(); });
  startSampler();
  window.addEventListener("pagehide", () => {
    marketObserver.disconnect();
    holderMonitor.disconnect();
    clearTimeout(pendingTimer);
    pendingTimer = null;
    clearInterval(heartbeat);
    clearTimeout(samplerStart);
    try { chrome.runtime.sendMessage({type: "AXIOM_DOM_CHART_FLUSH"}, () => { void chrome.runtime.lastError; }); }
    catch { /* Best effort navigation flush; normal persistence is batched. */ }
  });
  // A back/forward-cache restore must resume observation without duplicate timers.
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    marketObserver.observe(document.documentElement, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["hidden", "aria-hidden", "data-token-mint", "data-mint-address", "data-token-address", "data-pool-address", "data-pair-address", "data-chain", "data-network"]
    });
    heartbeat = setInterval(schedule, 2500);
    schedule();
    startSampler();
  });
})();
