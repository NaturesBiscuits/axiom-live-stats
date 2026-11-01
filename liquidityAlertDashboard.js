// Rendering consumes worker state; rerenders and history reloads never evaluate alerts.
(() => {
  "use strict";
  const A = AxiomLiquidityAlerts, H = AxiomLiquidityHistory, node = id => document.getElementById(id);
  let current = null, settingsKey = "", historyKey = "", busy = false;
  const at = value => Number.isFinite(value) ? new Date(value).toISOString() : "Unavailable";
  const number = value => Number.isFinite(value) ? new Intl.NumberFormat("en-US", {maximumSignificantDigits: 8}).format(value) : "Unavailable";
  function detail(parent, label, value) {
    const p = document.createElement("p"); p.className = "card-note"; p.textContent = `${label}: ${value}`; parent.append(p);
  }
  function showEvidence(parent, e, label) {
    if (!e) return;
    detail(parent, label, `${number(e.baselineValue)} → ${number(e.currentValue)} ${e.currency}; ${e.signedChangePercent.toFixed(2)}%; absolute change ${number(e.absoluteChange)} ${e.currency}`);
    detail(parent, "Observation times", `${at(e.baselineAt)} → ${at(e.currentAt)}; actual interval ${number(e.intervalMs / 1000)}s`);
    detail(parent, "Sampling times", `${at(e.baselineSampledAt)} → ${at(e.currentSampledAt)}`);
    detail(parent, "Coverage", `${e.coverage.complete ? "Complete" : "Incomplete"} (${number(e.coverage.ratio * 100)}%; ${e.coverage.validSlots}/${e.coverage.expected} expected 5s slots). Valid endpoints permit this comparison.`);
  }
  function renderHistory(events) {
    const key = JSON.stringify(events);
    if (historyKey === key) return;
    historyKey = key;
    const container = node("liquidityAlertHistory"), opened = new Set([...container.children].filter(item => item.open).map(item => item.dataset.eventId));
    container.replaceChildren();
    node("liquidityAlertHistoryCount").textContent = String(events.length);
    if (!events.length) { detail(container, "History", "No retained alerts for this token/source context."); return; }
    for (const event of [...events].sort((a, b) => b.triggeredAt - a.triggeredAt)) {
      const item = document.createElement("details"), title = document.createElement("summary");
      title.textContent = `${event.recoveredAt === null ? "Last confirmed: drop detected" : "Recovered"} · ${at(event.triggeredAt)} · ${event.evidence.currency} · Cause unverified`;
      item.className = "liquidity-alert-event"; item.dataset.eventId = event.id; item.open = opened.has(event.id); item.append(title);
      const c = event.evidence.context;
      detail(item, "Identity", `${c.blockchain ?? "Network unresolved"} · token ${c.mintAddress ?? c.routeAddress ?? "unresolved"} · pool ${c.poolAddress ?? "unresolved (token/source session scope)"}`);
      detail(item, "Data source", "Axiom-reported liquidity · Cause unverified");
      showEvidence(item, event.evidence, "Trigger evidence");
      showEvidence(item, event.latestEvidence, "Latest episode evidence (original trigger baseline)");
      detail(item, "Applicable rule", A.describe(event.rule));
      detail(item, "Trigger / recovery", `${at(event.triggeredAt)} / ${event.recoveredAt === null ? "Recovery unconfirmed" : at(event.recoveredAt)}`);
      if (event.monitoringEndedAt) detail(item, "Monitoring interrupted", `${at(event.monitoringEndedAt)} · ${event.monitoringEndReason}`);
      detail(item, "Connection", "Retained event; this record does not establish a live connection.");
      container.append(item);
    }
  }
  function render(data) {
    current = data;
    const activity = data.activity ?? {settings: A.DEFAULTS, history: [], states: []};
    const settings = activity.settings ?? A.DEFAULTS, key = JSON.stringify(settings);
    if (settingsKey !== key) {
      settingsKey = key;
      for (const name of ["windowSeconds", "dropPercent", "confirmations", "recoveryPercent", "recoveryConfirmations"]) node(`alert-${name}`).value = settings[name];
      node("alert-absoluteEnabled").checked = settings.minimumAbsoluteDrop !== null;
      node("alert-minimumAbsoluteDrop").value = settings.minimumAbsoluteDrop ?? "";
      toggleAbsolute();
    }
    node("liquidityActiveRule").textContent = activity.ruleLoaded === false ? "Saved alert rule unavailable; retry loading local history." : A.describe(settings);
    node("liquidityAlertSave").disabled = busy || activity.ruleLoaded === false;
    const last = [...data.rows].sort((a, b) => a.sampledAt - b.sampledAt).at(-1);
    const state = (activity.states ?? []).filter(item => item.currency === data.unit &&
      (!data.context?.recordingId || item.recordingId === data.context.recordingId)).sort((a, b) => b.lastSampledAt - a.lastSampledAt)[0];
    const fresh = state && state.live && !state.stale && Date.now() - state.lastFreshAt <= A.FRESH_MS && data.liveAt !== null && Date.now() - data.liveAt <= A.FRESH_MS;
    let status = "Data delayed/unavailable", reason = "Waiting for a fresh sampling attempt. Restored records do not establish a live connection.";
    if (fresh) { status = state.status; reason = state.reason; }
    else if (state?.activeId) reason = "Data is delayed/unavailable. Last confirmed state: liquidity drop detected; recovery unconfirmed.";
    if (!data.context) reason = "Waiting for an Axiom token/source context.";
    node("liquidityAlertStatus").textContent = status;
    node("liquidityAlertStatus").dataset.state = status === "Liquidity drop detected" ? "drop" : status === "Data delayed/unavailable" ? "delayed" : "neutral";
    node("liquidityAlertExplanation").textContent = reason;
    const comparison = last && last.unit === data.unit ? A.compare(data.rows, last, settings) : null;
    node("liquidityAlertComparison").textContent = comparison?.evidence ?
      `${comparison.evidence.signedChangePercent.toFixed(2)}% over ${number(comparison.evidence.intervalMs / 1000)}s · ${comparison.evidence.coverage.complete ? "Complete" : "Incomplete"} coverage (${number(comparison.evidence.coverage.ratio * 100)}%).` : comparison?.reason ?? "Comparison unavailable for this currency.";
    const active = activity.history?.find(event => event.id === state?.activeId);
    node("liquidityEpisodeRule").textContent = active && JSON.stringify(active.rule) !== key ? `The active episode retains its original rule: ${A.describe(active.rule)}` : "";
    node("liquidityAlertStorage").textContent = activity.error ? `Alert storage error: ${activity.error}. Live evaluation continues; persistence is unconfirmed.` : "Alert history: at most 200 episodes globally, retained for 7 days since the last episode update. Settings apply across tokens and currencies.";
    renderHistory(activity.history ?? []);
  }
  function toggleAbsolute() {
    const enabled = node("alert-absoluteEnabled").checked;
    node("alert-minimumAbsoluteDrop").disabled = !enabled; node("alert-minimumAbsoluteDrop").required = enabled;
  }
  node("alert-absoluteEnabled").addEventListener("change", toggleAbsolute);
  node("liquidityAlertForm").addEventListener("submit", event => {
    event.preventDefault();
    if (busy || !node("liquidityAlertForm").reportValidity()) return;
    let settings;
    try {
      const fields = Object.fromEntries(["windowSeconds", "dropPercent", "confirmations", "recoveryPercent", "recoveryConfirmations"].map(key => [key, Number(node(`alert-${key}`).value)]));
      fields.minimumAbsoluteDrop = node("alert-absoluteEnabled").checked ? Number(node("alert-minimumAbsoluteDrop").value) : null;
      settings = A.validateSettings(fields);
    } catch (error) { node("liquidityAlertSettingsStatus").textContent = error.message; return; }
    busy = true; node("liquidityAlertSave").disabled = true;
    const tokenKey = current?.context?.tokenKey;
    const finish = response => {
      busy = false; node("liquidityAlertSave").disabled = false;
      const error = chrome.runtime.lastError?.message ?? (!response?.ok ? response?.error ?? "Settings could not be saved." : response.activity?.error);
      node("liquidityAlertSettingsStatus").textContent = error ? `Settings persistence unconfirmed: ${error}` : "Settings saved. Pending confirmation has been reset.";
      if (response?.ok) globalThis.AxiomLiquidityUI?.applyActivity(response.activity, tokenKey);
    };
    try { chrome.runtime.sendMessage({type: "AXIOM_LIQUIDITY_ALERT_SETTINGS", tokenKey, settings}, finish); }
    catch (error) { finish({ok: false, error: error.message}); }
  });
  globalThis.AxiomLiquidityAlertUI = {render};
})();
