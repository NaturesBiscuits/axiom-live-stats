// Scoped Axiom trade-feed observation. Never clicks, scrolls or requests data.
(() => {
  "use strict";
  const PANEL_SELECTOR = '[data-perf-id="token-trades-panel"]', MAX_RENDERED_ROWS = 500;
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const visible = node => {
    if (!node?.isConnected || node.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    if (["hidden", "collapse"].includes(style.visibility) || style.display === "none") return false;
    if (style.display === "contents") return [...node.children].some(visible);
    return Boolean(node.getClientRects().length && (!node.checkVisibility || node.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})));
  };
  function displayText(node) {
    const flatten = current => {
      if (current.nodeType === 3) return current.textContent;
      if (current.nodeType !== 1 || current.matches('i, svg, img, [role="img"]') || !visible(current)) return "";
      const sub = current.tagName === "SUB" || current.classList.contains("align-sub") || current.style.verticalAlign === "sub";
      if (sub && /^\d{1,3}$/.test(clean(current.textContent))) return clean(current.textContent).replace(/\d/g, digit => "₀₁₂₃₄₅₆₇₈₉"[Number(digit)]);
      return [...current.childNodes].map(flatten).join("");
    };
    return node ? clean(flatten(node)) || null : null;
  }
  const rowNodes = panel => [...panel.querySelectorAll('div[data-transaction-key], div[data-layout="compact"]')]
    .filter(node => { const parent = node.parentElement?.closest('div[data-transaction-key], div[data-layout="compact"]'); return !parent || !panel.contains(parent); });
  function filters(panel) {
    const controls = [];
    for (const button of panel.querySelectorAll("button")) {
      if (button.closest('[data-transaction-key], [data-layout="compact"]') || !visible(button)) continue;
      const label = clean(button.getAttribute("aria-label") || displayText(button));
      if (!/^(Mine|Tracked|Dev|Filter by (?:total|market cap|amount|trader))$/.test(label)) continue;
      const states = [];
      for (const attr of ["aria-pressed", "aria-checked", "data-filter-active"]) {
        const raw = button.getAttribute(attr);
        if (raw === "true") states.push("on"); else if (raw === "false") states.push("off");
      }
      const explicit = new Set(states);
      let state = explicit.size === 1 ? [...explicit][0] : "unknown", evidence = states.length ? "explicit-control-state" : "state-unavailable";
      if (!states.length && /^(Mine|Tracked|Dev)$/.test(label) && button.classList.contains("border-transparent") && button.classList.contains("text-textTertiary")) {
        state = "off"; evidence = "captured-inactive-toggle-style";
      }
      controls.push({label, state, evidence, popoverState: button.closest("[data-state]")?.getAttribute("data-state") ?? null});
    }
    const expected = ["Mine", "Tracked", "Dev", "Filter by total", "Filter by market cap", "Filter by amount", "Filter by trader"];
    const status = controls.some(control => control.state === "on") ? "restricted" :
      expected.every(label => controls.filter(control => control.label === label && control.state === "off").length === 1) && controls.length === expected.length ? "no-restriction-detected" : "unknown";
    return {status, controls, explanation: "Closed filter popovers do not establish that column filters are inactive"};
  }
  function supportedHeader(panel, name) {
    const header = [...panel.querySelectorAll(`[data-figure="${name}"]`)].find(node => !node.closest('[data-transaction-key], [data-layout="compact"]'));
    const label = {total: /^Total$/, amount: /^Amount$/}[name];
    return Boolean(header && visible(header) && label.test(displayText(header) ?? ""));
  }
  function field(row, name, supported) {
    if (!supported) return null;
    const candidates = [...row.querySelectorAll("span, div")].filter(node =>
      node.getAttribute("data-figure") === name || node.style.minWidth.includes(`--trades-tape-figure-floor-${name}`));
    return candidates.length === 1 && visible(candidates[0]) ? candidates[0] : null;
  }
  function amount(node, tokenAmount = false) {
    const raw = displayText(node), parsed = AxiomLiquidityHistory.parseAmount(raw);
    if (tokenAmount && parsed.unit !== "unspecified") return {...parsed, value: null, status: "unsupported-token-amount-unit"};
    return {...parsed, displayText: raw, unit: tokenAmount && parsed.unit === "unspecified" ? "token" : parsed.unit,
      status: parsed.status, source: tokenAmount ? "amount-header-and-field-marker" : "total-header-and-field-marker"};
  }
  function extract(panel, {observedAt = Date.now()} = {}) {
    if (!panel || !visible(panel)) return {rows: [], status: panel ? "hidden" : "unavailable", filters: {status: "unknown", controls: []}, observedAt, missingIdentifiers: 0, renderedLimitReached: false};
    const candidates = rowNodes(panel), filterState = filters(panel), rows = [];
    const headers = {total: supportedHeader(panel, "total"), amount: supportedHeader(panel, "amount")};
    let missingIdentifiers = 0;
    for (const row of candidates.slice(0, MAX_RENDERED_ROWS)) {
      if (!visible(row)) continue;
      const key = row.getAttribute("data-transaction-key");
      if (!AxiomTrading.opaqueKey(key)) { missingIdentifiers++; continue; }
      const makerNodes = [row, ...row.querySelectorAll("[data-maker-address]")];
      const makers = new Set(makerNodes.map(node => node.getAttribute("data-maker-address"))
        .filter(AxiomHolderTableExtractor.isAddress).map(AxiomHolderTableExtractor.addressKey));
      const totalField = field(row, "total", headers.total), amountField = field(row, "amount", headers.amount);
      const markers = new Set(totalField ? [totalField, ...totalField.querySelectorAll("*")].filter(visible)
        .flatMap(node => ["text-increase", "text-decrease"].filter(marker => node.classList.contains(marker))) : []);
      const trader = row.querySelector('[data-action="open-trader"]');
      const traderLabel = trader ? [...trader.querySelectorAll("span[title]")].find(node => visible(node) && /username|Confirmed|source/i.test(node.title)) : null;
      const explorerLinks = [...row.querySelectorAll("a[href]")].filter(visible)
        .map(anchor => AxiomTokenInfo.explorerLink(anchor.getAttribute("href"), "transaction")).filter(Boolean);
      const urls = new Set(explorerLinks.map(link => link.url));
      const ageNodes = [...row.querySelectorAll('[data-row-accessory="age"]')].filter(visible);
      const ages = new Set(ageNodes.map(displayText).filter(Boolean));
      rows.push({eventKey: key, makerAddress: makers.size === 1 ? [...makers][0] : null, makerCandidates: [...makers],
        identityStatus: makers.size > 1 ? "conflicting" : makers.size ? "resolved" : "unresolved",
        traderDisplay: displayText(traderLabel ?? trader),
        direction: markers.size === 1 ? markers.has("text-increase") ? "buy" : "sell" : "unknown",
        directionMarkers: [...markers], directionEvidence: {source: "scoped-total-semantic-class", markers: [...markers], status: markers.size > 1 ? "conflicting" : markers.size ? "supported" : "missing"},
        total: amount(totalField), tokenAmount: amount(amountField, true),
        transactionUrl: urls.size === 1 ? [...urls][0] : null, transactionLinkStatus: urls.size > 1 ? "conflicting" : urls.size ? "resolved" : "unavailable",
        rawAge: ages.size === 1 ? [...ages][0] : null, ageStatus: ages.size > 1 ? "conflicting" : ages.size ? "relative-display" : "unavailable", filters: filterState});
    }
    return {rows, status: rows.length ? "available" : missingIdentifiers ? "unsupported-identifiers" : "empty", filters: filterState,
      observedAt, missingIdentifiers, renderedLimitReached: candidates.length > MAX_RENDERED_ROWS, materializedRows: candidates.length};
  }
  function createMonitor(onBatch, {doc = document, now = Date.now, routeKey = () => AxiomTokenContextDetector.routeKey(), ready = () => true,
    contextNeeded = () => {}, sessionId = globalThis.crypto?.randomUUID?.() ?? String(Math.random())} = {}) {
    let context = null, inputKey = null, epoch = 0, panel = null, observer = null, timer = null, state = null;
    let initial = true, syncKind = "initial-sync", recordingStartedAt = null, previousFilters = null, wasHidden = false;
    let lastEmissionAt = -Infinity, lastRenderedLimitAt = null;
    let blockedKeys = new Set(), sourceKeys = new Set(), lastKnownKeys = new Set(), coverageFingerprint = "";
    const records = new Map(); let localEvictions = 0;
    const disconnectPanel = () => { observer?.disconnect(); observer = null; clearTimeout(timer); timer = null; panel = null; };
    function discover() {
      if (panel?.isConnected && visible(panel)) return panel;
      disconnectPanel();
      const panels = [...doc.querySelectorAll(PANEL_SELECTOR)]; panel = panels.find(visible) ?? panels[0] ?? null;
      initial = true; syncKind = state ? "panel-sync" : "initial-sync";
      if (panel) {
        observer = new MutationObserver(schedule);
        observer.observe(panel, {subtree: true, childList: true, characterData: true, attributes: true,
          attributeFilter: ["data-transaction-key", "data-maker-address", "class", "style", "href", "hidden", "aria-hidden", "aria-pressed", "aria-checked", "data-filter-active", "data-state"]});
      }
      return panel;
    }
    function update() {
      timer = null;
      if (!context) return;
      if (context.routeKey !== routeKey() || !ready()) { contextNeeded(); return; }
      discover();
      const at = now(), reading = extract(panel, {observedAt: at});
      if (reading.renderedLimitReached) lastRenderedLimitAt = at;
      const filterFingerprint = JSON.stringify(reading.filters);
      const filterChanged = previousFilters !== null && previousFilters !== filterFingerprint;
      if (filterChanged) { initial = true; syncKind = "filter-sync"; }
      previousFilters = filterFingerprint;
      if (wasHidden && reading.status !== "hidden") { initial = true; syncKind = "resume-sync"; }
      wasHidden = reading.status === "hidden";
      const batch = [];
      for (const row of reading.rows) {
        if (blockedKeys.has(row.eventKey)) continue;
        const event = AxiomTrading.makeEvent(row, context, at, initial ? syncKind : "newly-observed");
        const merged = AxiomTrading.mergeEvent(records.get(row.eventKey), event);
        records.set(row.eventKey, merged); sourceKeys.add(row.eventKey); batch.push(merged);
      }
      if (reading.status !== "hidden" && panel) initial = false;
      lastKnownKeys = new Set(reading.rows.map(row => row.eventKey));
      while (records.size > 5000) { records.delete(records.keys().next().value); localEvictions++; }
      // The guard only needs the last materialized keys, not an unbounded session ledger.
      if (sourceKeys.size > 5000) sourceKeys = new Set([...sourceKeys].slice(-5000));
      state = {tokenKey: context.tokenKey, sourceContext: context, status: blockedKeys.size && !batch.length && reading.rows.length ? "awaiting-token" : reading.status,
        recordingStartedAt, recordingSessionId: sessionId + ":" + epoch, lastReadAt: at, filters: reading.filters, missingIdentifiers: reading.missingIdentifiers,
        renderedLimitReached: reading.renderedLimitReached, lastRenderedLimitAt, materializedRows: reading.materializedRows ?? 0,
        localDedupRecords: records.size, localDedupLimit: 5000, localEvictions,
        coverage: "partial-materialized-dom", sourceHidden: doc.hidden, initialSynchronization: initial};
      const nextFingerprint = JSON.stringify({...state, lastReadAt: undefined});
      if (batch.length || nextFingerprint !== coverageFingerprint || at - lastEmissionAt >= 2500) {
        coverageFingerprint = nextFingerprint; lastEmissionAt = at; onBatch?.({context, events: batch, coverage: state});
      }
    }
    function schedule() { if (timer === null) timer = setTimeout(update, 180); }
    return {discover, setContext(next) {
      if (!next?.sourceKey) return;
      if (inputKey !== next.sourceKey) {
        if (context) {
          const guard = new Set();
          for (const key of [...blockedKeys, ...sourceKeys, ...lastKnownKeys, ...(panel ? rowNodes(panel).map(row => row.getAttribute("data-transaction-key")) : [])]) {
            if (!key) continue; guard.delete(key); guard.add(key);
          }
          blockedKeys = new Set([...guard].slice(-5000));
        }
        inputKey = next.sourceKey; epoch++; context = AxiomTrading.sourceContext(next, sessionId, epoch);
        records.clear(); sourceKeys.clear(); recordingStartedAt = now(); initial = true; syncKind = "initial-sync";
        previousFilters = null; coverageFingerprint = ""; localEvictions = 0; lastRenderedLimitAt = null;
      }
      update();
    }, context: () => context, getState: () => state,
    contains: node => Boolean(panel && (panel === node || panel.contains(node))),
    disconnect() { disconnectPanel(); initial = true; syncKind = "resume-sync"; }};
  }
  globalThis.AxiomTradeFeed = Object.freeze({PANEL_SELECTOR, MAX_RENDERED_ROWS, displayText, filters, extract, createMonitor});
})();
