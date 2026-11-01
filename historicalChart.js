// Permission-gated provider history, independent of local DOM samples and observed trades.
(() => {
  "use strict";
  const node = id => document.getElementById(id), origins = ["https://api.geckoterminal.com/*"];
  let collector = null, dataset = null, chart = null, candles = null, volume = null, timeline = null, markers = null;
  let controller = null, generation = 0, sourceKey = null, shown = [], summary = null, busy = false, operation = null, poolSelection = "user-selected-pool";
  const date = at => Number.isFinite(at) ? new Date(at).toISOString() : "Unavailable";
  const number = value => Number.isFinite(value) ? AxiomChartView.exact(value) : "Unavailable";
  const canonical = value => value?.startsWith("0x") ? value.toLowerCase() : value;
  const selection = () => ({blockchain: node("historyNetwork").value, mintAddress: node("historyMint").value.trim(), poolAddress: node("historyPool").value.trim()});
  const key = context => JSON.stringify([context.blockchain, canonical(context.mintAddress), canonical(context.poolAddress)]);
  const matches = context => dataset && key(dataset.metadata) === key(context);
  function buttons() {
    node("historyLoad").disabled = busy; node("historyFindPools").disabled = busy;
    node("historyRefresh").disabled = busy || !dataset; node("historyExport").disabled = !shown.length;
  }
  function clear(clearCandidates = true) {
    globalThis.AxiomSupplyUI?.clearProvider();
    generation++; controller?.abort(); controller = null; dataset = null; shown = []; summary = null; busy = false;
    node("historyResults").hidden = true;
    node("historyCursor").textContent = "Hover a candle or volume bar to inspect provider OHLCV.";
    if (chart) chart.remove(); chart = null; candles = null; volume = null; timeline = null; markers = null;
    if (clearCandidates) { node("historyCandidates").replaceChildren(); node("historyPoolStatus").textContent = "Pool unknown? Select the network and token, then choose Find pools."; }
    buttons();
  }
  function validate(needsPool, focus = true) {
    const context = selection(), validNetwork = Boolean(AxiomChartData.NETWORKS[context.blockchain]);
    let first = null;
    for (const [id, error] of [
      ["historyNetwork", !validNetwork ? "Select the token's network. Balance symbols do not establish a blockchain." : ""],
      ["historyMint", !validNetwork ? "Select the network first." : !AxiomChartData.isAddress(context.mintAddress, context.blockchain) ? "Enter the full token address for this network." : ""],
      ["historyPool", needsPool && !AxiomChartData.isPoolAddress(context.poolAddress, context.blockchain) ? "Enter a full pool address or provider pool ID, or use Find pools and choose a candidate." :
        needsPool && canonical(context.poolAddress) === canonical(context.mintAddress) ? "Token and pool addresses must be different." : ""]]) {
      node(id).setAttribute("aria-invalid", Boolean(error)); node(`${id}Help`).textContent = error;
      if (error && (id !== "historyMint" || validNetwork)) first ||= id;
    }
    if (first) { if (focus) node(first).focus(); node("historyStatus").textContent = "Complete the highlighted selection fields. The rest of the analyzer remains available."; return null; }
    return context;
  }
  function renderSource() {
    if (!dataset || !summary) return;
    const meta = dataset.metadata, aged = Date.now() - meta.fetchedAt >= AxiomChartData.CACHE_TTL;
    dataset.stale = Boolean(dataset.refreshFailed || aged);
    node("historyIdentity").textContent = `${meta.dataSource} · network ${meta.blockchain} · token ${meta.mintAddress} · pool ${meta.poolAddress} · selected ${meta.tokenSide} token · price ${meta.quoteCurrency} · volume ${meta.volumeCurrency}`;
    node("historyTiming").textContent = `Candle interval: 1 minute. Viewing period: ${summary.seconds / 60}m ending ${date(summary.end * 1000)}. Fetched ${date(meta.fetchedAt)} · ${dataset.cacheHit ? "local cache" : "API response"} · ${dataset.stale ? "stale; manual refresh available" : "within the 1-minute local cache lifetime"}.`;
    if (!busy || operation !== "candles") node("historyStatus").textContent = `${dataset.refreshFailed ? `Refresh failed: ${dataset.refreshFailed}. Previous matching results remain visible and stale. ` : ""}` +
      `${meta.dataSource}: ${shown.length} one-minute candles · ${summary.missingIntervals} missing intervals · ${summary.incomplete} incomplete.` +
      `${meta.rejectedRows ? ` ${meta.rejectedRows} malformed provider rows were omitted.` : ""}`;
    node("historyCoverage").textContent = summary.complete ? "All selected one-minute intervals have provider candles; elapsed intervals may still be revised." :
      `Partial selected-period coverage: ${shown.length}/${summary.expected} intervals have candles. ${shown.length ? "Earlier or missing history is unavailable in this response; a young or sparsely traded pool may have only a few candles." : "No indexed candles are available in this period; try 1h or refresh later."} Missing intervals can reflect no swaps or unavailable history; they are left blank.`;
  }
  function inspectCandle(time) {
    const row = shown.find(item => item.timestamp === Number(time));
    node("historyCursor").textContent = row ? `${date(row.timestamp * 1000)} · ${dataset.metadata.quoteCurrency} · ` +
      ["open", "high", "low", "close"].map(field => `${field}: ${number(row[field])}`).join(" · ") +
      ` · volume: ${row.volume === null ? "Unavailable" : number(row.volume)} ${dataset.metadata.volumeCurrency} · ${row.finalized ? "Interval ended; provider revisions possible" : "Incomplete at fetch time"}` : "No provider candle in this minute; price and volume are unavailable.";
  }
  function render(resetView = true) {
    if (!dataset) return;
    summary = AxiomChartData.summarize(dataset, Number(node("historyRange").value)); shown = summary.rows;
    node("historyResults").hidden = false;
    if (!chart) {
      chart = AxiomChartView.createChart(node("historicalChart"));
      timeline = chart.addSeries(LightweightCharts.LineSeries, {priceScaleId: "timeline", lineVisible: false, lastValueVisible: false, priceLineVisible: false, pointMarkersVisible: false});
      candles = chart.addSeries(LightweightCharts.CandlestickSeries, {priceScaleId: "right", upColor: "#2fe3b0", downColor: "#f25583", wickUpColor: "#2fe3b0", wickDownColor: "#f25583", borderVisible: false});
      volume = chart.addSeries(LightweightCharts.HistogramSeries, {priceScaleId: "right", priceFormat: {type: "volume"}, priceLineVisible: false, lastValueVisible: false}, 1);
      chart.panes()[0].setStretchFactor(3); chart.panes()[1].setStretchFactor(1);
      markers = LightweightCharts.createSeriesMarkers(candles, []);
      chart.subscribeCrosshairMove(param => inspectCandle(param.time));
    }
    const range = !resetView ? chart.timeScale().getVisibleRange() : null;
    timeline.setData(Array.from({length: summary.expected}, (_, index) => ({time: summary.start + index * 60})));
    candles.applyOptions({priceFormat: AxiomChartView.priceFormat(shown.flatMap(row => [row.open, row.high, row.low, row.close]))});
    candles.setData(shown.map(({timestamp, open, high, low, close}) => ({time: timestamp, open, high, low, close})));
    volume.setData(shown.map(row => row.volume === null ? {time: row.timestamp} :
      {time: row.timestamp, value: row.volume, color: row.close >= row.open ? "#2fe3b088" : "#f2558388"}));
    markers.setMarkers(shown.filter(row => !row.finalized).map(row => ({time: row.timestamp, position: "aboveBar", color: "#f2c879", shape: "arrowDown", text: "Incomplete"})));
    if (range) chart.timeScale().setVisibleRange(range);
    else chart.timeScale().setVisibleRange({from: shown[0]?.timestamp ?? summary.start, to: (shown.at(-1)?.timestamp ?? summary.end) + 60});
    chart.priceScale("right", 0).applyOptions({autoScale: true}); volume.priceScale().applyOptions({autoScale: true, scaleMargins: {top: 0.1, bottom: 0}});
    for (const [id, value] of Object.entries({historyOpen: summary.firstOpen, historyClose: summary.latestClose, historyHigh: summary.highest, historyLow: summary.lowest})) node(id).textContent = `${number(value)}${value === null ? "" : " USD"}`;
    node("historyChange").textContent = summary.changePercent === null ? "Unavailable (zero or missing first open)" : `${summary.changePercent >= 0 ? "+" : ""}${summary.changePercent.toFixed(2)}%`;
    node("historyVolume").textContent = summary.volume === null ? "Unavailable" : `${number(summary.volume)} USD`;
    node("historyVolumeCoverage").textContent = `Sum of available provider volume: ${summary.volumeCount} candles; ${summary.missingVolumes} candles lack volume. Explicit zero volume is retained.`;
    dataset.metadata.selectedPeriodSeconds = summary.seconds;
    renderSource(); buttons();
  }
  async function begin(kind, context, force = false) {
    const requestId = ++generation; controller?.abort(); controller = new AbortController();
    const signal = controller.signal; busy = true; operation = kind; buttons();
    const status = node(kind === "pools" ? "historyPoolStatus" : "historyStatus");
    status.textContent = kind === "pools" ? "Finding candidate pools. Public API pacing can take several seconds." : "Verifying this network, token and pool, then loading candles. Public API pacing can take several seconds.";
    try {
      // Permission request remains directly within an explicit button/submit gesture.
      const granted = await chrome.permissions.request({origins});
      if (requestId !== generation) return;
      if (!granted) throw new Error("GeckoTerminal access was declined. Live DOM collection continues.");
      collector ||= AxiomChartData.createCollector({storage: chrome.storage.local});
      if (kind === "pools") {
        const result = await collector.findPools(context, {signal});
        if (requestId !== generation) return;
        const container = node("historyCandidates"); container.replaceChildren();
        for (const candidate of result.candidates) {
          const button = document.createElement("button"); button.type = "button"; button.className = "history-pool-candidate";
          const liquidity = candidate.liquidityUSD === null ? "liquidity unavailable" : `liquidity ${new Intl.NumberFormat("en-US", {maximumSignificantDigits: 8}).format(candidate.liquidityUSD)} USD`;
          button.textContent = `${candidate.name} · ${candidate.network} · ${candidate.poolAddress} · ${liquidity} · Select pool`;
          button.addEventListener("click", () => {
            clear(false); node("historyPool").value = candidate.poolAddress; poolSelection = "user-selected-candidate";
            node("historyPoolHelp").textContent = "Candidate selected. Load candles to verify pool membership and token side."; node("historyPool").setAttribute("aria-invalid", "false");
            node("historyStatus").textContent = "Pool selected by you; a match to Axiom's pool has not been established. Load candles to verify and display history.";
          }); container.append(button);
        }
        status.textContent = result.candidates.length ? `${result.candidates.length} candidate pools · ${result.network} · first provider page, not an exhaustive list · ${result.cacheHit ? "cached" : "fetched"} ${date(result.fetchedAt)}. Choose a pool; none is selected automatically.` : "No indexed pools found for this token on this network. Check the token/network, enter a known pool, or try later.";
      } else {
        const result = await collector.collect({...context, sourceKey: key(context), poolSelection}, {signal, force});
        if (requestId !== generation) return;
        if (key(result.metadata) !== key(context)) throw new Error("Provider result identity does not match the current selection.");
        const resetView = !dataset; dataset = result; dataset.refreshFailed = null; render(resetView);
        globalThis.AxiomSupplyUI?.setProvider(result.metadata.providerValuations);
      }
    } catch (error) {
      if (requestId !== generation) return;
      globalThis.AxiomSupplyUI?.providerError(error.message);
      if (kind === "candles" && matches(context)) { dataset.refreshFailed = error.message; renderSource(); }
      else status.textContent = error.message;
    } finally { if (requestId === generation) { busy = false; operation = null; renderSource(); buttons(); } }
  }
  function load(force = false) {
    const context = validate(true); if (!context) return;
    if (dataset && !matches(context)) clear(false);
    return begin("candles", context, force);
  }
  node("historyForm").addEventListener("submit", event => { event.preventDefault(); load(); });
  node("historyFindPools").addEventListener("click", () => { const context = validate(false); if (context) begin("pools", context); });
  node("historyRefresh").addEventListener("click", () => load(true));
  for (const id of ["historyNetwork", "historyMint", "historyPool"]) {
    const changed = () => { clear(id !== "historyPool"); poolSelection = "user-selected-pool"; validate(false, false); node("historyStatus").textContent = "Selection changed. Load candles to verify this token and pool."; };
    node(id).addEventListener("input", changed); node(id).addEventListener("change", changed);
  }
  node("historyRange").addEventListener("change", () => render()); node("historyFit").addEventListener("click", () => render());
  node("historyExport").addEventListener("click", () => {
    if (!dataset || !shown.length) return;
    renderSource();
    const content = AxiomChartData.toCSV({...dataset, candles: shown}, true);
    const url = URL.createObjectURL(new Blob([content + "\n"], {type: "text/csv;charset=utf-8"}));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `geckoterminal-${dataset.metadata.blockchain}-${dataset.metadata.poolAddress}-1m-usd.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  globalThis.AxiomHistoricalUI = {
    setContext(context) {
      const nextKey = context ? JSON.stringify([context.sourceKey, context.blockchain, context.mintAddress, context.poolAddress, context.conflict]) : null;
      if (nextKey === sourceKey) return;
      sourceKey = nextKey; clear();
      node("historyNetwork").value = context?.conflict ? "" : AxiomChartData.NETWORKS[context?.blockchain] ?? "";
      node("historyMint").value = context?.conflict ? "" : context?.mintAddress ?? "";
      node("historyPool").value = context?.conflict ? "" : context?.poolAddress ?? "";
      poolSelection = context?.poolAddress && !context.conflict ? "axiom-explicit-pool" : "user-selected-pool";
      validate(false, false); node("historyStatus").textContent = context?.conflict || "Confirm the detected addresses or complete the missing fields. Find pools and Load candles run only on request.";
    },
    inspect: () => ({metadata: dataset?.metadata, stale: dataset?.stale, candles: shown, summary, volume: volume?.data(),
      paneCount: chart?.panes().length, formattedPrice: shown.length ? candles?.priceFormatter().format(shown[0].close) : null,
      markers: markers?.markers(), visibleRange: chart?.timeScale().getVisibleRange(), visibleLogicalRange: chart?.timeScale().getVisibleLogicalRange()})
  };
  setInterval(renderSource, 1000); buttons();
  window.addEventListener("pagehide", () => { generation++; controller?.abort(); });
})();
