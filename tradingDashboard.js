(() => {
  "use strict";
  const T = AxiomTrading, node = id => document.getElementById(id);
  let context = null, store = T.createStore(), coverage = null, archiveStatus = null, losses = [], generation = 0, lastResult = null;
  const value = number => Number.isFinite(number) ? new Intl.NumberFormat("en-US", {maximumSignificantDigits: 9}).format(number) : "Unavailable";
  const at = number => Number.isFinite(number) ? new Date(number).toISOString() : "Unavailable";
  const volume = (number, unit) => Number.isFinite(number) && unit ? `${value(number)} ${unit}` : "Unavailable";
  function retainLosses(incoming = []) {
    const combined = new Map();
    for (const loss of [...losses, ...incoming].filter(Boolean)) {
      const key = JSON.stringify([loss.tokenKey, loss.reason]), old = combined.get(key);
      combined.set(key, old ? {...loss, from: Math.min(old.from, loss.from), through: Math.max(old.through, loss.through), count: Math.max(old.count, loss.count)} : loss);
    }
    losses = [...combined.values()].filter(loss => loss.through >= Date.now() - T.RETENTION_MS).slice(-128);
  }
  function render() {
    const now = Date.now(), rows = context ? store.rows(context.tokenKey) : [];
    let summary = T.analyze(rows, {now, seconds: Number(node("participationRange").value), currency: node("participationCurrency").value || null,
      basis: node("participationTiming").value, coverage, losses: [...losses, ...(context ? store.status(context.tokenKey).losses : [])]});
    const select = node("participationCurrency"), previous = select.value;
    if (JSON.stringify([...select.options].map(option => option.value)) !== JSON.stringify(summary.currencies)) {
      select.replaceChildren(...summary.currencies.map(unit => { const option = document.createElement("option"); option.value = unit; option.textContent = unit; return option; }));
      select.value = summary.currencies.includes(previous) ? previous : summary.currencies.includes("USD") ? "USD" : summary.currencies[0] ?? "";
      summary = T.analyze(rows, {now, seconds: Number(node("participationRange").value), currency: select.value || null, basis: node("participationTiming").value, coverage, losses: summary.losses});
    }
    lastResult = summary;
    for (const [id, text] of Object.entries({
      participationEvents: `${summary.buys} buys / ${summary.sells} sells`,
      participationWallets: `${summary.buyers} buyers / ${summary.sellers} sellers`,
      participationRepeat: `${summary.repeatBuyers} repeat buyers / ${summary.repeatSellers} repeat sellers`,
      participationBoth: `${summary.bothSides} addresses on both sides`,
      participationVolume: `${volume(summary.buyVolume, summary.currency)} buys / ${volume(summary.sellVolume, summary.currency)} sells`,
      participationUnresolved: `${summary.unresolvedEvents} unresolved-address events · ${summary.unknownDirection} unknown-direction events`,
      participationUnknownVolume: `Unidentified volume: ${volume(summary.unresolvedVolume, summary.currency)} · Unknown-direction volume: ${volume(summary.unknownDirectionVolume, summary.currency)}. These groups can overlap.`,
      participationDenominator: `Volume denominator: ${volume(summary.totalVolume, summary.currency)}. ${summary.denominator}. ${summary.volumeEvents} events have usable volume; ${summary.missingVolumeEvents} lack usable volume in this currency (${summary.otherCurrencyEvents} have another currency).`,
      participationTimingNote: `${summary.basis === "approximate-trade-time" ? "Approximate trade-time window from the first valid relative age" : "Observation-time window from first seen; not event occurrence time"} · ${summary.approximateEvents}/${summary.events} selected events have approximate trade timing · ${summary.initialSyncEvents} synchronization rows · ${summary.excludedUntimed} untimed events excluded in this view · ${summary.boundaryUncertain} rounded-age intervals cross the window boundary.`,
      participationCoverage: `Recording duration/span (includes gaps, limited to retained 24h): ${summary.recordingDurationMs === null ? "Unavailable" : `${Math.floor(summary.recordingDurationMs / 60000)}m ${Math.floor(summary.recordingDurationMs / 1000) % 60}s`} · ${summary.recordingCoversWindow ? "Recording started before this window" : "Recording does not cover this full window"}. Partial materialized DOM feed; gaps and filters prevent complete market-wide history.`,
      participationFilters: `Current filter coverage: ${coverage?.filters?.status ?? "unknown"}. ${(coverage?.filters?.controls ?? []).map(control => `${control.label}: ${control.state}`).join(" · ")} · Selected events observed under restricted filters: ${summary.restrictedEvents}; unknown filters: ${summary.unknownFilterEvents}.`,
      participationStatus: `${coverage?.status ?? "Waiting for source"} · last DOM read ${at(coverage?.lastReadAt)} · ${coverage?.lastReadAt && now - coverage.lastReadAt <= 10000 ? "Recent local observation" : "Saved/delayed source; current connection unavailable"}` +
        `${archiveStatus?.error ? ` · Storage error: ${archiveStatus.error}` : ""} · ${archiveStatus?.pending ?? 0} pending writes`,
      participationIdentity: context ? `${context.blockchain ?? "Network unresolved"} · token ${context.mintAddress ?? "unresolved"} · pool ${context.poolAddress ?? "unresolved"} · route hint ${context.routeAddress ?? context.routeKey ?? "unresolved"} · identity ${context.identityStatus}` : "Token context unavailable",
      participationLoss: (summary.losses.length ? `Data loss/truncation may affect this window: ${[...new Set(summary.losses.map(loss => loss.reason))].join(", ")}. Deduplication cannot be guaranteed beyond retained records.` : "No recorded record-cap loss in this window; feed coverage remains partial.") +
        (coverage?.lastRenderedLimitAt > now - summary.seconds * 1000 ? " Rendered-row cap reached during this window; unread trades may be missing." : "") +
        (coverage?.missingIdentifiers ? ` ${coverage.missingIdentifiers} current rows have no reliable event ID and are excluded.` : "")
    })) node(id).textContent = text;
    node("participationLimitations").textContent = `${coverage?.missingIdentifiers ?? 0} materialized rows lack reliable event IDs and are excluded from deduplicated metrics. ` +
      `${coverage?.renderedLimitReached ? "Rendered-row limit reached; unread events may affect this window. " : ""}` +
      `${coverage?.localEvictions ?? 0} local dedup entries evicted; worker/archive deduplication still applies while records are retained. ` +
      "24h retention / 50,000 archive events globally; 20,000 worker/dashboard events; 5,000 local dedup and pending-write entries. Writes batch every 15s; forced shutdown can lose the pending batch.";
    const fragment = document.createDocumentFragment();
    for (const share of summary.shares) {
      const item = document.createElement("span"); item.textContent = `Largest ${share.n} observed wallets: ${share.percentage === null ? "Unavailable" : value(share.percentage) + "%"}`;
      item.title = share.reason; fragment.append(item);
    }
    node("participationShares").replaceChildren(fragment);
    const body = document.createDocumentFragment();
    for (const wallet of summary.wallets.slice(0, 200)) {
      const row = document.createElement("tr");
      for (const text of [wallet.address, wallet.label ?? "Unavailable", `${wallet.buys} / ${wallet.sells} / ${wallet.unknown}`, String(wallet.events),
        volume(wallet.volume, summary.currency), wallet.share === null ? "Unavailable" : value(wallet.share) + "%", String(wallet.missingVolumeEvents)]) {
        const cell = document.createElement("td"); cell.textContent = text; row.append(cell);
      }
      body.append(row);
    }
    node("participationRows").replaceChildren(body);
    node("participationTableNote").textContent = `${summary.wallets.length} resolved observed addresses; showing ${Math.min(200, summary.wallets.length)}. Repeat means at least two events on that side. Counts cover all supported directions/currencies; volumes use the selected currency. Wallet addresses do not establish independent people, common ownership or wash trading.`;
  }
  function hydrate() {
    if (!context) return;
    const requestId = ++generation, tokenKey = context.tokenKey;
    chrome.runtime.sendMessage({type: "AXIOM_TRADES_GET", tokenKey}, response => {
      void chrome.runtime.lastError;
      if (requestId !== generation || tokenKey !== context?.tokenKey) return;
      if (response?.ok) {
        store.ingest(response.events ?? []); coverage = T.mergeCoverage(coverage, response.coverage); retainLosses(response.losses);
        archiveStatus = response.archiveStatus ?? null;
      } else archiveStatus = {error: response?.error ?? "Trading archive response unavailable"};
      render();
    });
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "AXIOM_TRADES_LIVE") return;
    if (message.archiveStatus) archiveStatus = message.archiveStatus;
    if (message.tokenKey === context?.tokenKey) {
      store.ingest(message.events ?? []); coverage = T.mergeCoverage(coverage, message.coverage); retainLosses(message.losses);
    }
    render();
  });
  for (const id of ["participationRange", "participationCurrency", "participationTiming"]) node(id).addEventListener("change", render);
  node("participationRefresh").addEventListener("click", hydrate);
  setInterval(render, 1000);
  globalThis.AxiomTradingUI = Object.freeze({setSnapshot(snapshot) {
    const next = snapshot.tradingContext;
    if (next?.tokenKey === context?.tokenKey) { coverage = T.mergeCoverage(coverage, snapshot.tradingStatus); render(); return; }
    generation++; context = next ?? null; store = T.createStore(); coverage = snapshot.tradingStatus ?? null; losses = []; archiveStatus = null;
    render(); hydrate();
  }, inspect: () => ({context, coverage, summary: lastResult, rows: context ? store.rows(context.tokenKey) : []})});
  render();
})();
