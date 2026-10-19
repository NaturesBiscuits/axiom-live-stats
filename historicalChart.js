// Explicit, permission-gated market history. Never merges with DOM observations.
(() => {
  "use strict";
  const node = id => document.getElementById(id);
  const origins = ["https://api.geckoterminal.com/*"];
  let collector = null, dataset = null, chart = null, candles = null, timeline = null;
  let controller = null, generation = 0, sourceKey = null, shown = [];
  const date = at => new Date(at).toISOString();
  function clear() {
    generation++; controller?.abort(); controller = null; dataset = null; shown = [];
    node("historyLoad").disabled = false;
    node("historyResults").hidden = true;
    node("historyCursor").textContent = "Hover a candle to inspect OHLCV. Empty minutes remain blank; the current candle can be incomplete.";
    if (chart) { chart.remove(); chart = null; candles = null; timeline = null; }
  }
  function render() {
    if (!dataset) return;
    const seconds = Number(node("historyRange").value);
    const end = Math.floor(dataset.metadata.fetchedAt / 60000) * 60;
    shown = dataset.candles.filter(row => row.timestamp > end - seconds && row.timestamp <= end);
    node("historyResults").hidden = false;
    if (!chart) {
      chart = AxiomChartView.createChart(node("historicalChart"));
      timeline = chart.addSeries(LightweightCharts.LineSeries, {priceScaleId: "timeline", lineVisible: false,
        lastValueVisible: false, priceLineVisible: false, pointMarkersVisible: false});
      candles = chart.addSeries(LightweightCharts.CandlestickSeries, {priceScaleId: "right",
        upColor: "#2fe3b0", downColor: "#f25583", wickUpColor: "#2fe3b0", wickDownColor: "#f25583", borderVisible: false});
      chart.subscribeCrosshairMove(param => {
        const row = shown.find(item => item.timestamp === Number(param.time));
        if (!row) { node("historyCursor").textContent = "No market candle in this minute."; return; }
        node("historyCursor").textContent = `${date(row.timestamp * 1000)} · USD · ` +
          ["open", "high", "low", "close", "volume"].map(field => `${field}: ${AxiomChartView.exact(row[field])}`).join(" · ") +
          ` · ${row.finalized ? "Interval ended; provider revisions possible" : "Incomplete interval"}`;
      });
    }
    timeline.setData(Array.from({length: seconds / 60}, (_, index) => ({time: end - seconds + 60 + index * 60})));
    candles.applyOptions({priceFormat: AxiomChartView.priceFormat(shown.flatMap(row => [row.open, row.high, row.low, row.close]))});
    candles.setData(shown.map(({timestamp, open, high, low, close}) => ({time: timestamp, open, high, low, close})));
    chart.timeScale().setVisibleRange({from: end - seconds + 60, to: end});
    chart.priceScale("right").applyOptions({autoScale: true});
    const meta = dataset.metadata;
    node("historyIdentity").textContent = `${meta.blockchain} · token ${meta.mintAddress} · pool ${meta.poolAddress} · USD · ${meta.tokenSide} token`;
    node("historyStatus").textContent = `${dataset.cacheHit ? "Cached" : "Fetched"} ${date(meta.fetchedAt)} · ` +
      `${shown.length} one-minute candles in the selected ${seconds / 60}m period · ${shown.filter(row => !row.finalized).length} incomplete. ` +
      `GeckoTerminal market data; empty minutes are not filled.${shown.length ? "" : " No candles available in this period; try 1h or reload later."}`;
    node("historyExport").disabled = !shown.length;
  }
  node("historyForm").addEventListener("submit", async event => {
    event.preventDefault();
    const blockchain = node("historyNetwork").value;
    const mintAddress = node("historyMint").value.trim(), poolAddress = node("historyPool").value.trim();
    if (!AxiomChartData.NETWORKS[blockchain] || !AxiomChartData.isAddress(mintAddress, blockchain) ||
        !AxiomChartData.isAddress(poolAddress, blockchain)) {
      node("historyStatus").textContent = "Select a network and enter full, valid token and pool addresses."; return;
    }
    const requestId = ++generation;
    controller?.abort(); controller = new AbortController();
    const signal = controller.signal;
    node("historyLoad").disabled = true;
    node("historyStatus").textContent = "Verifying pool and token, then loading candles. Public API pacing can take several seconds.";
    try {
      // Keep this call in the user gesture; no permission prompt on dashboard load.
      const granted = await chrome.permissions.request({origins});
      if (requestId !== generation) return;
      if (!granted) throw new Error("GeckoTerminal access was declined. Live DOM collection continues.");
      collector ||= AxiomChartData.createCollector({storage: chrome.storage.local});
      const context = {sourceKey: JSON.stringify([blockchain, mintAddress, poolAddress]), blockchain, mintAddress, poolAddress};
      const result = await collector.collect(context, {signal});
      if (requestId !== generation) return;
      dataset = result; render();
    } catch (error) {
      if (requestId === generation) node("historyStatus").textContent = `${error.message}${dataset ? ` Previous results fetched ${date(dataset.metadata.fetchedAt)} remain visible.` : ""}`;
    } finally {
      if (requestId === generation) node("historyLoad").disabled = false;
    }
  });
  for (const id of ["historyNetwork", "historyMint", "historyPool"]) node(id).addEventListener("input", () => {
    clear(); node("historyStatus").textContent = "Selection changed. Load candles to verify this token and pool.";
  });
  node("historyRange").addEventListener("change", render);
  node("historyFit").addEventListener("click", render);
  node("historyExport").addEventListener("click", () => {
    if (!dataset || !shown.length) return;
    const content = AxiomChartData.toCSV({...dataset, candles: shown}, true);
    const url = URL.createObjectURL(new Blob([content + "\n"], {type: "text/csv;charset=utf-8"}));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = `geckoterminal-${dataset.metadata.blockchain}-${dataset.metadata.poolAddress}-1m-usd.csv`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  globalThis.AxiomHistoricalUI = {
    setContext(context) {
      if ((context?.sourceKey ?? null) === sourceKey) return;
      sourceKey = context?.sourceKey ?? null; clear();
      node("historyNetwork").value = AxiomChartData.NETWORKS[context?.blockchain] ?? "";
      node("historyMint").value = context?.conflict ? "" : context?.mintAddress ?? "";
      node("historyPool").value = context?.conflict ? "" : context?.poolAddress ?? "";
      node("historyStatus").textContent = context?.conflict ||
        "Confirm the detected addresses, or enter the missing network, token and pool. History loads only on request.";
    },
    inspect: () => ({metadata: dataset?.metadata, candles: shown, visibleRange: chart?.timeScale().getVisibleRange()})
  };
  window.addEventListener("pagehide", () => controller?.abort());
})();
