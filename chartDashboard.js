// Free Chart V2: local line charts and IndexedDB-recorded DOM samples.
(() => {
  "use strict";
  const charts = AxiomRollingChart.createStore();
  const savedSeries = new Map();
  const node = id => document.getElementById(id);
  let snapshot = null, currentSeries = null, currentEnd = null, automaticallySaved = false, settingsDirty = false, hydrationId = 0;
  const renderer = AxiomChartView.createRenderer(node("rollingChart"), (timestamp, sample) => {
    node("chartCursor").textContent = `${new Date(timestamp * 1000).toISOString()} · ${sample ? sample.value === null ?
      sample.reason : `${AxiomChartView.exact(sample.value)} ${sample.unit} · read ${sample.domReadAt ?? sample.observedAt} · changed ${sample.valueChangedAt ?? "unknown"}` : "No observation recorded"}`;
  });
  const cacheKey = (token, metric) => JSON.stringify([token, metric]);
  const timeText = time => Number.isFinite(time) ? new Date(time).toISOString().replace("T", " ") : "—";
  const chosenEnd = () => {
    const time = Date.parse(node("chartRecordedEnd").value + "Z");
    return Number.isFinite(time) && time >= 0 ? Math.min(Math.floor(time / 1000), Math.floor(Date.now() / 1000)) : null;
  };
  function archiveStatus(response) {
    node("chartArchiveStatus").textContent = response.archiveError || response.error ?
      `Local storage error: ${response.archiveError || response.error}. Live sampling continues.` :
      `${(response.stats?.count ?? 0).toLocaleString()} actual sampling records in IndexedDB · ${response.pendingCount ?? 0} awaiting batch persistence${response.droppedRecords ? ` · ${response.droppedRecords} pending records lost while storage was unavailable` : ""}`;
    if (response.settings && !settingsDirty) {
      node("chartRetention").value = response.settings.retentionHours;
      node("chartRecordLimit").value = response.settings.maxRecords;
    }
  }
  function render() {
    const now = Date.now(), context = snapshot?.chartContext, type = node("chartMetric").value;
    const history = context?.sourceKey ? charts.get(context.sourceKey, now) : null;
    const live = history?.series[type], saved = savedSeries.get(cacheKey(context?.sourceKey, type));
    const newestLive = live?.samples.at(-1)?.timestamp ?? -Infinity;
    const newestSaved = saved?.samples.at(-1)?.timestamp ?? -Infinity;
    const newest = Math.max(newestLive, newestSaved);
    currentEnd = node("chartView").value === "recorded" ? chosenEnd() ?? saved?.end ?? (Number.isFinite(newest) ? newest : Math.floor(now / 1000)) : Math.floor(now / 1000);
    node("chartRecordedEnd").disabled = node("chartView").value !== "recorded";
    const inWindow = row => row.timestamp > currentEnd - 900 && row.timestamp <= currentEnd;
    const liveEnd = live?.samples.findLast(inWindow)?.timestamp ?? -Infinity;
    const savedEnd = saved?.samples.findLast(inWindow)?.timestamp ?? -Infinity;
    const unit = liveEnd >= savedEnd && Number.isFinite(liveEnd) ? live?.unit : saved?.unit ?? live?.unit;
    const rows = new Map();
    for (const series of [saved, live]) if (series && series.unit === unit) for (const row of series.samples) {
      const old = rows.get(row.timestamp);
      if (!old || (row.sampledAt ?? -1) >= (old.sampledAt ?? -1)) rows.set(row.timestamp, row);
    }
    const candidates = [...rows.values()].filter(inWindow)
      .sort((a, b) => a.timestamp - b.timestamp);
    currentSeries = null;
    if (context && unit && candidates.length) {
      const view = AxiomRollingChart.createStore({now: () => currentEnd * 1000});
      view.merge({tokenKey: context.sourceKey, context, series: {[type]: {unit, samples: candidates}}, sentAt: currentEnd * 1000}, currentEnd * 1000);
      currentSeries = view.get(context.sourceKey, currentEnd * 1000)?.series[type] ?? null;
    }
    const samples = currentSeries?.samples ?? [], latest = samples.at(-1);
    const deliveryAge = history?.lastReceivedAt ? now - history.lastReceivedAt : null;
    const readAge = latest?.domReadAt ? now - latest.domReadAt : latest?.observedAt ? now - latest.observedAt : null;
    const recorded = node("chartView").value === "recorded";
    const connected = !recorded && deliveryAge !== null && deliveryAge <= 5000 && !history.restored;
    const readable = readAge !== null && readAge <= 5000 && !latest.stale;
    node("chartNetwork").textContent = context?.blockchain ?? "Unresolved";
    node("chartMint").textContent = context?.mintAddress ?? "Unresolved in DOM";
    node("chartPool").textContent = context?.poolAddress ?? "Unresolved in DOM";
    node("chartUnit").textContent = `${type === "price" ? "Price" : "Market cap"} · ${unit ?? "unavailable"}`;
    node("chartCount").textContent = samples.filter(row => Number.isFinite(row.sampledAt)).length.toLocaleString();
    node("chartCountNote").textContent = `${samples.filter(row => row.value !== null).length} usable · ${samples.filter(row => row.gap).length} unobserved slots · ${samples.filter(row => row.stale && !row.gap).length} unavailable/stale`;
    node("chartLastUpdate").textContent = timeText(latest?.deliveredAt ?? history?.lastReceivedAt);
    node("chartObservedAt").textContent = timeText(latest?.domReadAt ?? latest?.observedAt);
    node("chartChangedAt").textContent = timeText(latest?.valueChangedAt);
    node("chartSampledAt").textContent = timeText(latest?.sampledAt);
    node("chartWindow").textContent = `${timeText((currentEnd - 899) * 1000)} to ${timeText(currentEnd * 1000)}${node("chartView").value === "recorded" ? " · recorded period" : " · live view"}`;
    const delay = Math.max(latest?.samplingDelayMs ?? 0, connected ? 0 : Math.max(0, (deliveryAge ?? 1000) - 1000));
    node("chartDelay").textContent = latest ? `${Math.round(delay).toLocaleString()} ms · delivery ${Math.round(latest.deliveryDelayMs ?? 0)} ms` : "—";
    node("chartSource").textContent = recorded ? samples.length ? "Saved observations" : "No recorded observations" : connected ? readable ? "DOM readable" : "Connected · value unavailable" :
      saved?.samples.length || history?.restored ? "Saved observations" : history ? "Source delayed" : "Waiting";
    node("chartSource").classList.toggle("negative", !connected && Boolean(samples.length));
    node("chartMessage").textContent = !samples.length ? "No observations for this token/metric in the selected window." :
      node("chartView").value === "recorded" ? "Showing a recorded local period, not backfilled market history. Unobserved periods remain blank." :
      !connected ? "No recent sample delivery. Browser throttling or a closed source can create gaps." :
      latest?.sourceHidden ? "Source tab is hidden. These are successful DOM reads; delayed timer slots remain unobserved." :
      !readable ? "The displayed value could not be read recently. Stale/unavailable observations are null." :
      "Cached DOM cells are read each second. An unchanged price does not mean the source is disconnected; Axiom's upstream feed freshness is unknown.";
    node("chartExportJSONL").disabled = !samples.length;
    node("chartExportCSV").disabled = !samples.length;
    renderer.render(samples, currentEnd, JSON.stringify([context?.sourceKey, type, unit, node("chartView").value]));
  }
  function hydrate() {
    const context = snapshot?.chartContext, type = node("chartMetric").value;
    const requestId = ++hydrationId;
    try {
      chrome.runtime.sendMessage({type: "AXIOM_DOM_CHART_GET", tokenKey: context?.sourceKey, metric: type,
        endTimestamp: node("chartView").value === "recorded" ? chosenEnd() : null}, response => {
        if (requestId !== hydrationId) return;
        if (chrome.runtime.lastError || !response?.ok) {
          node("chartArchiveStatus").textContent = chrome.runtime.lastError?.message || response?.error || "Reconnect by reloading the dashboard."; return;
        }
        for (const history of response.histories ?? []) if (!charts.get(history.tokenKey)) charts.restore([history]);
        if (context && response.recorded) {
          const key = cacheKey(context.sourceKey, type);
          savedSeries.delete(key);
          if (response.recorded.samples.length) savedSeries.set(key, response.recorded);
          while (savedSeries.size > 8) savedSeries.delete(savedSeries.keys().next().value);
          if (response.recorded.samples.length && (node("chartView").value === "live" || automaticallySaved) &&
              snapshot?.chartContext?.sourceKey === context.sourceKey && node("chartMetric").value === type &&
              response.recorded.end < Math.floor(Date.now() / 1000) - 900 && !charts.get(context.sourceKey)?.series[type]?.samples.length) {
            node("chartView").value = "recorded"; automaticallySaved = true;
            node("chartRecordedEnd").value = new Date(response.recorded.end * 1000).toISOString().slice(0, 19);
          }
        }
        archiveStatus(response); render();
      });
    } catch { node("chartArchiveStatus").textContent = "Reload the extension dashboard to reconnect."; }
  }
  function download(format) {
    if (!currentSeries?.samples.length) return;
    const content = format === "jsonl" ? AxiomRollingChart.toJSONL(currentSeries) : AxiomRollingChart.toCSV(currentSeries);
    const url = URL.createObjectURL(new Blob([content + "\n"], {type: format === "jsonl" ? "application/x-ndjson" : "text/csv;charset=utf-8"}));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = `axiom-dom-${node("chartMetric").value}-${currentEnd}-1s-15m.${format}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  node("chartMetric").addEventListener("change", () => { render(); hydrate(); });
  node("chartView").addEventListener("change", () => {
    automaticallySaved = false;
    if (node("chartView").value === "recorded" && !node("chartRecordedEnd").value) {
      const saved = savedSeries.get(cacheKey(snapshot?.chartContext?.sourceKey, node("chartMetric").value));
      node("chartRecordedEnd").value = new Date((saved?.end ?? Math.floor(Date.now() / 1000)) * 1000).toISOString().slice(0, 19);
    }
    render(); hydrate();
  });
  node("chartRecordedEnd").addEventListener("change", () => { automaticallySaved = false; render(); hydrate(); });
  node("chartRefresh").addEventListener("click", hydrate);
  node("chartExportJSONL").addEventListener("click", () => download("jsonl"));
  node("chartExportCSV").addEventListener("click", () => download("csv"));
  for (const id of ["chartRetention", "chartRecordLimit"]) node(id).addEventListener("change", () => { settingsDirty = true; });
  node("chartSaveRetention").addEventListener("click", () => {
    chrome.runtime.sendMessage({type: "AXIOM_DOM_ARCHIVE_SETTINGS", settings: {
      retentionHours: Number(node("chartRetention").value), maxRecords: Number(node("chartRecordLimit").value)}}, response => {
      if (!response?.ok || chrome.runtime.lastError) { archiveStatus({error: response?.error || chrome.runtime.lastError?.message}); return; }
      settingsDirty = false; savedSeries.clear(); archiveStatus(response); hydrate();
    });
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === "AXIOM_DOM_ARCHIVE_STATUS") { archiveStatus({...message, archiveError: message.error}); return; }
    if (message?.type !== "AXIOM_DOM_CHART_LIVE") return;
    if (charts.merge(message.packet, Date.now())) {
      if (automaticallySaved && message.packet.tokenKey === snapshot?.chartContext?.sourceKey) { node("chartView").value = "live"; automaticallySaved = false; }
      render();
    }
  });
  setInterval(render, 1000);
  globalThis.AxiomChartUI = {setSnapshot(next) {
    const changed = snapshot?.chartContext?.sourceKey !== next?.chartContext?.sourceKey;
    snapshot = next;
    if (changed) { node("chartView").value = "live"; node("chartRecordedEnd").value = ""; automaticallySaved = false; render(); hydrate(); }
  }, inspectChart: renderer.inspect};
  hydrate(); render();
})();
