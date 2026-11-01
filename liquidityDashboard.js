// Local liquidity observations stay separate from price, market cap and API candles.
(() => {
  "use strict";
  const H = AxiomLiquidityHistory, node = id => document.getElementById(id);
  const chart = AxiomChartView.createChart(node("liquidityChart"));
  const timeline = chart.addSeries(LightweightCharts.LineSeries, {priceScaleId: "timeline", lineVisible: false,
    pointMarkersVisible: false, lastValueVisible: false, priceLineVisible: false});
  let context = null, rows = [], liveAt = null, generation = 0, series = [], plotted = [], plotKey = "", archiveError = null;
  let activity = null;
  const time = at => Number.isFinite(at) ? new Date(at).toISOString() : "Unavailable";
  const amount = row => row ? `${new Intl.NumberFormat("en-US", {maximumSignificantDigits: 8}).format(row.value)} ${row.unit}` : "Unavailable";
  const change = value => value === null ? "Unavailable" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
  const duration = ms => `${Math.floor(ms / 60000)}m ${Math.floor(ms / 1000) % 60}s`;
  function render() {
    const now = Date.now();
    rows = rows.filter(row => row.sampledAt >= now - H.RETENTION_HOURS * 3600000).slice(-H.MAX_RECORDS);
    const select = node("liquidityCurrency"), previous = select.value;
    const units = [...new Set(rows.map(row => row.unit))];
    if (JSON.stringify(units) !== JSON.stringify([...select.options].map(option => option.value))) {
      select.replaceChildren(...units.map(unit => { const option = document.createElement("option"); option.value = unit; option.textContent = unit; return option; }));
      select.value = units.includes(previous) ? previous : rows.filter(H.valid).at(-1)?.unit ?? units.at(-1) ?? "";
    }
    const selected = rows.filter(row => row.unit === select.value), summary = H.analyze(selected, now);
    const connected = liveAt !== null && now - liveAt <= 12500, latest = summary.latest;
    node("liquidityCurrent").textContent = amount(latest);
    node("liquidityCurrent").title = latest ? `${AxiomChartView.exact(latest.value)} ${latest.unit} · displayed ${latest.displayText}` : "";
    node("liquidityObservedAt").textContent = latest ? `Observed ${time(latest.domReadAt)}` : "No valid observation";
    node("liquidityFirst").textContent = amount(summary.first);
    node("liquidityFirst").title = summary.first ? `${AxiomChartView.exact(summary.first.value)} ${summary.first.unit} · ${time(summary.first.domReadAt)}` : "";
    node("liquiditySinceStart").textContent = change(summary.sinceStart);
    node("liquidityDuration").textContent = duration(summary.durationMs);
    node("liquidityCoverage").textContent = `${(summary.coverage * 100).toFixed(1)}% · ${summary.observations} valid / ${summary.attempts} actual attempts · ${summary.expected} expected 5s slots`;
    node("liquidityChangeLabel").textContent = `Observed ${select.value || "currency-unresolved"} liquidity changes`;
    for (const seconds of [30, 60, 300, 900]) {
      const window = summary.windows[seconds], output = node(`liquidityChange${seconds}`);
      output.textContent = window.status === "available" ? change(window.change) : window.status;
      output.title = window.baseline ? `Baseline ${time(window.baseline.domReadAt)} · end ${time(latest.domReadAt)} · tolerance ±2.5s` : "Requires a full recorded period and a valid baseline within ±2.5s of its start";
    }
    const last = rows.at(-1);
    node("liquidityStatus").textContent = `${connected ? "Recent source delivery" : rows.length ? "Saved / delayed source; no current connection established" : "Waiting for source"}` +
      `${last ? ` · latest attempt ${last.status} at ${time(last.domReadAt)}` : ""}` +
      `${archiveError ? ` · Storage error: ${archiveError}` : ""}`;
    node("liquidityIdentity").textContent = context ? `${context.blockchain ?? "Network unresolved"} · token ${context.mintAddress ?? context.routeAddress ?? "unresolved"} · pool ${context.poolAddress ?? "unresolved (page-session series only)"} · identity ${context.identityStatus}` : "Waiting for token identity";
    globalThis.AxiomLiquidityAlertUI?.render({context, rows, unit: select.value, activity, liveAt});
    const seconds = Number(node("liquidityRange").value), end = selected.at(-1)?.sampledAt ?? now;
    plotted = selected.filter(row => row.sampledAt >= end - seconds * 1000);
    const key = JSON.stringify([context?.tokenKey, select.value, seconds, plotted.length, plotted.at(-1)]);
    if (key !== plotKey) {
      plotKey = key;
      for (const item of series) chart.removeSeries(item);
      series = [];
      timeline.setData(plotted.map(row => ({time: row.timestamp})));
      const groups = H.segments(plotted), dots = groups.length > 32;
      for (const group of dots ? [groups.flat()].filter(group => group.length) : groups) {
        const line = chart.addSeries(LightweightCharts.LineSeries, {color: "#2fe3b0", lineWidth: 2,
          lineVisible: !dots, pointMarkersVisible: true, pointMarkersRadius: 3, priceLineVisible: false,
          lastValueVisible: false, priceFormat: {type: "custom", minMove: 0.000001,
            formatter: value => new Intl.NumberFormat("en-US", {notation: "compact", maximumSignificantDigits: 5}).format(value)}});
        line.setData(group.map(row => ({time: row.timestamp, value: row.value}))); series.push(line);
      }
      if (plotted.length) chart.timeScale().setVisibleRange({from: Math.min((plotted.find(H.valid) ?? plotted[0]).timestamp, Math.floor(end / 1000) - 5), to: Math.floor(end / 1000) + 1});
      chart.priceScale("right").applyOptions({autoScale: true});
      node("liquidityChart").dataset.segments = groups.length;
    }
  }
  chart.subscribeCrosshairMove(param => {
    const row = plotted.find(row => row.timestamp === Number(param.time));
    node("liquidityCursor").textContent = row ? `${time(row.domReadAt)} · ${H.valid(row) ? `${AxiomChartView.exact(row.value)} ${row.unit}` : row.status} · displayed: ${row.displayText ?? "unavailable"}` : "No observation at this time";
  });
  function hydrate() {
    const requestId = ++generation;
    if (!context?.tokenKey) return;
    try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_GET", tokenKey: context.tokenKey}, response => {
      if (requestId !== generation) return;
      archiveError = chrome.runtime.lastError?.message ?? response?.error ?? null;
      if (response?.ok) {
        activity = response.activity ?? null;
        rows = H.mergeRows(response.saved, response.live, rows);
        // Only worker-held delivery establishes connectivity; disk timestamps do not.
        liveAt = Math.max(liveAt ?? 0, ...(response.live ?? []).filter(row => !context.recordingId || row.tokenIdentity?.recordingId === context.recordingId).map(row => row.deliveredAt ?? 0)) || null;
      }
      render();
    }); } catch (error) { archiveError = error.message; render(); }
  }
  for (const id of ["liquidityRange", "liquidityCurrency"]) node(id).addEventListener("change", render);
  node("liquidityRefresh").addEventListener("click", hydrate);
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "AXIOM_LIQUIDITY_ALERT_SETTINGS_LIVE") { hydrate(); return; }
    if (message?.type === "AXIOM_LIQUIDITY_ARCHIVE_STATUS") { archiveError = message.error; if (activity) activity.error = message.alertError ?? null; render(); return; }
    if (message?.type !== "AXIOM_LIQUIDITY_LIVE" || message.row?.tokenKey !== context?.tokenKey) return;
    if (context.recordingId && message.row.tokenIdentity?.recordingId !== context.recordingId) return;
    if (!H.isAttempt(message.row)) return;
    rows = H.mergeRows(rows, [message.row]); liveAt = message.row.deliveredAt; activity = message.activity ?? activity; render();
  });
  globalThis.AxiomLiquidityUI = {setContext(next) {
    if ((next?.tokenKey ?? null) === (context?.tokenKey ?? null) && next?.recordingId === context?.recordingId) return;
    context = next; rows = []; liveAt = null; activity = null; archiveError = null; generation++; render(); hydrate();
  }, applyActivity(next, tokenKey) { if (tokenKey === context?.tokenKey) { activity = next; render(); } },
    inspect: () => ({rows, activity, plotted, series: series.map(item => item.data()), connected: liveAt !== null && Date.now() - liveAt <= 12500})};
  setInterval(render, 1000);
  render();
})();
