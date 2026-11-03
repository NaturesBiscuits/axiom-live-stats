(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  let source = null, tab = null, state = null, generation = 0, busy = false, message = "", initialized = false;
  const utc = at => Number.isFinite(at) ? new Date(at).toISOString() : "Unavailable";
  const number = value => Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : "Unavailable";
  const list = (id, items) => $(id).replaceChildren(...items.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
  const parameters = {lookbackMs: "Preceding price window (ms)", evaluationIntervalMs: "Evaluation interval (ms)", freshMs: "Maximum source age (ms)", maxGapMs: "Maximum confirmation gap (ms)",
    minimumCoverage: "Minimum coverage (0–1)", breakoutBufferPct: "Breakout buffer %", resetBufferPct: "Rearm buffer % below reference", confirmations: "Entry confirmations", recoveryConfirmations: "Rearm confirmations",
    minBuyShare: "Minimum buy volume share (0–1)", minTrades: "Minimum observed trades (60s)", minUnique: "Minimum unique wallets when available", maxTop1Pct: "Maximum observed top-wallet volume %", minLiquidityChangePct: "Minimum liquidity change % (60s)",
    maxTop10Pct: "Top 10 concentration veto %", maxDeveloperPct: "Developer holdings veto %", stopLossPct: "Default stop loss % (0 disables)", takeProfitPct: "Default take profit % (0 disables)", trailingStopPct: "Default trailing stop % (0 disables)", exitConfirmations: "Default exit confirmations"};
  for (const [key, label] of Object.entries(parameters)) {
    const wrap = document.createElement("label"), input = document.createElement("input");
    wrap.append(document.createTextNode(label)); input.type = "number"; input.step = "any"; input.required = true;
    input.dataset.parameter = key; input.value = AxiomLiveSignals.DEFAULTS[key]; wrap.append(input); $("signalsParameters").append(wrap);
  }
  function matches(result) {
    if (result.key === "@waiting") return !result.current;
    try { const scope = JSON.parse(result.key); return scope[0] === tab && scope[1] === source?.chartContext?.sourceKey; } catch { return false; }
  }
  function render() {
    const current = state?.current, position = state?.position, age = Number.isFinite(current?.observedAt) ? Date.now() - current.observedAt : null;
    const delayed = !current?.live || !Number.isFinite(current?.observedAt) || age > (state?.settings.freshMs ?? 10000);
    $("signalsStatus").textContent = current ? `${delayed ? "Data delayed / interrupted" : current.phase.replace(/-/g, " ")} · source age ${age === null ? "unavailable" : `${number(age)}ms`} · tab ${tab}` : state?.interrupted ? "Monitoring interrupted by worker/browser restart. Waiting for a new source observation and price window." : "Warming up: open the Axiom token and keep its source available.";
    $("signalsStrength").textContent = !delayed && current?.score.bullish !== null ? `Bullish ${number(current.score.bullish)}% · Bearish ${number(current.score.bearish)}%` : "Insufficient data";
    $("signalsEntry").textContent = delayed ? "Waiting for data" : current.phase === "buy-trigger" ? "Configured entry conditions met" : current.phase.replace(/-/g, " ");
    $("signalsStrategy").textContent = `${current?.strategy.name ?? "Momentum Breakout"} · ${state?.settings.profile ?? "Starter"}${current ? ` · ${current.signal}` : ""}`;
    $("signalsMessage").textContent = [message, state?.storageError ? `Storage error: ${state.storageError}; export before closing.` : "", state?.notificationError].filter(Boolean).join(" · ");
    list("signalsWarnings", current?.warnings.map(w => `${w.label}: ${w.value ?? w.eventIds?.join(", ") ?? "active"}${w.threshold === undefined ? "" : `; threshold ${w.threshold}`}. Entry veto remains independent of strength.`) ?? []);
    list("signalsConditions", current?.conditions.map(c => `${c.status.toUpperCase()} · ${c.id}${c.optional ? " (optional evidence)" : ""}: ${c.detail}`) ?? ["Required inputs and confirmation will appear with fresh observations."]);
    list("signalsUnknowns", current?.unknowns ?? ["Market, participation, liquidity and risk inputs are not yet available."]);
    $("signalsFactors").replaceChildren(...(current?.score.factors ?? []).map(f => {
      const row = document.createElement("tr"); for (const text of [`${f.id} / ${f.window}`, number(f.value), f.direction, f.weight, number(f.contribution)]) { const cell = document.createElement("td"); cell.textContent = text; row.append(cell); } return row;
    }));
    $("signalsCoverage").textContent = current ? `Available factor weight: ${number(current.score.coverage * 100)}%. Price-window coverage: ${number(current.range.coverage * 100)}%. Partial DOM coverage; original field times remain in evaluation exports.` : "";
    let description = "No tracked position in this token/source/currency context.";
    if (position) {
      const stale = !position.priceObservedAt || Date.now() - position.priceObservedAt > position.settings.freshMs;
      description = `${position.mode === "paper" ? "PAPER" : "MANUALLY REPORTED REAL"} · ${position.status}${stale && !position.closedAt ? " · observation delayed" : ""} · Entry ${position.entryPrice} ${position.currency} at ${utc(position.entryAt)} · Gross estimated PnL ${stale ? "Unavailable" : number(position.pnlPct)}%${position.size === null ? "" : ` / ${stale ? "Unavailable" : number(position.estimatedPnl)} ${position.currency}`} · Post-entry high ${position.highWater}. ${position.reason ?? "Waiting for a post-entry observation."} ${position.assumptions} Exit plan: stop ${position.settings.stopLossPct}%, target ${position.settings.takeProfitPct}%, trail ${position.settings.trailingStopPct}%, ${position.settings.exitConfirmations} confirmations. ${(position.exitConditions ?? []).filter(c => c.met).map(c => c.id).join(", ")}`;
    }
    $("signalsPosition").textContent = description;
    $("signalsLogPosition").disabled = busy || delayed || Boolean(position && !position.closedAt);
    $("signalsClosePosition").disabled = busy || !position || Boolean(position.closedAt);
    $("signalsNotifications").checked = state?.notifications === true;
    list("signalsHistory", (state?.history ?? []).slice().reverse().map(e => {
      const status = e.type.startsWith("position-") ? "Manual tracking record; no execution" : e.recoveredAt ? `Recovery/invalidation confirmed ${utc(e.recoveredAt)}` : e.outdated || Date.now() - e.triggeredAt > 15000 ? "Historical/outdated; recovery unconfirmed" : "Current event";
      return `${e.type} · ${utc(e.triggeredAt)} · ${e.price ?? "No execution price"} ${e.currency} · ${e.settings.profile} / ${e.strategy.id} v${e.strategy.version} · ${status} · ${e.reason}`;
    }));
    $("signalsDiagnostics").textContent = JSON.stringify({context: current?.context, sourceTabId: tab, observationTime: utc(current?.observedAt), evaluationTime: utc(current?.evaluatedAt), eventTime: "Unknown; DOM observation time only", latency: current?.latency, provenance: current?.provenance, retention: state?.retention, retainedEvaluationObservations: state?.journalCount}, null, 2);
  }
  function request(type, values = {}) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage({type, sourceTabId: tab, sourceKey: source?.chartContext?.sourceKey, ...values}, result => {
      const error = chrome.runtime.lastError?.message; if (error || !result?.ok) reject(new Error(error ?? result?.error ?? "Signal service unavailable")); else resolve(result);
    }));
  }
  function accept(result) {
    if (!matches(result)) return;
    if (state?.current && result.current && result.current.evaluatedAt < state.current.evaluatedAt) return;
    state = result;
    if (!initialized && result.settings) {
      $("signalsProfile").value = result.settings.profile;
      for (const input of $("signalsParameters").querySelectorAll("input")) input.value = result.settings[input.dataset.parameter]; initialized = true;
    }
    if (!$("signalsCurrency").value && result.current) $("signalsCurrency").value = result.current.currency;
    for (const [id, key] of [["signalsStop", "stopLossPct"], ["signalsTarget", "takeProfitPct"], ["signalsTrailing", "trailingStopPct"], ["signalsExitConfirmations", "exitConfirmations"]]) {
      if (!$(id).dataset.edited && result.settings) $(id).value = result.settings[key];
    }
    render();
  }
  for (const id of ["signalsStop", "signalsTarget", "signalsTrailing", "signalsExitConfirmations"]) $(id).addEventListener("input", () => { $(id).dataset.edited = "true"; });
  async function refresh() {
    if (busy || !source) return;
    const current = ++generation;
    try { const result = await request("AXIOM_SIGNALS_STATUS"); if (current === generation) accept(result); }
    catch (error) { if (current === generation) { message = error.message; render(); } }
  }
  async function action(type, values) {
    busy = true; generation++; message = ""; render();
    try { accept(await request(type, values)); } catch (error) { message = error.message; }
    finally { busy = false; render(); }
  }
  $("signalsSettingsForm").addEventListener("submit", event => {
    event.preventDefault(); const settings = {strategyId: $("signalsStrategySelect").value, profile: $("signalsProfile").value};
    for (const input of $("signalsParameters").querySelectorAll("input")) settings[input.dataset.parameter] = Number(input.value);
    void action("AXIOM_SIGNALS_SETTINGS", {settings});
  });
  $("signalsPositionForm").addEventListener("submit", event => {
    event.preventDefault(); void action("AXIOM_SIGNALS_POSITION", {key: state?.key, position: {mode: $("signalsPositionMode").value, entryPrice: Number($("signalsEntryPrice").value),
      currency: $("signalsCurrency").value.trim().toUpperCase(), entryAt: new Date($("signalsEntryTime").value).getTime(), size: $("signalsSize").value === "" ? null : Number($("signalsSize").value),
      exits: {stopLossPct: Number($("signalsStop").value), takeProfitPct: Number($("signalsTarget").value), trailingStopPct: Number($("signalsTrailing").value), exitConfirmations: Number($("signalsExitConfirmations").value)}}});
  });
  $("signalsClosePosition").addEventListener("click", () => void action("AXIOM_SIGNALS_CLOSE", {key: state?.key}));
  $("signalsNotifications").addEventListener("change", async event => {
    const enabled = event.target.checked;
    try { if (enabled && !await chrome.permissions.request({permissions: ["notifications"]})) throw new Error("Notification permission was not granted. In-dashboard alerts remain available.");
      await action("AXIOM_SIGNALS_NOTIFICATIONS", {enabled});
    } catch (error) { message = error.message; render(); }
  });
  $("signalsExport").addEventListener("click", async () => {
    try { const result = await request("AXIOM_SIGNALS_EXPORT"); $("signalsEvaluation").value = result.text;
      try { await navigator.clipboard.writeText(result.text); message = "Paper evaluation data copied."; }
      catch { $("signalsEvaluation").hidden = false; $("signalsEvaluation").focus(); $("signalsEvaluation").select(); message = "Evaluation data selected. Press Ctrl+C / Cmd+C."; }
    } catch (error) { message = error.message; } render();
  });
  chrome.runtime.onMessage.addListener(result => { if (result?.type === "AXIOM_SIGNALS_STATE" && !busy) accept(result); });
  globalThis.AxiomLiveSignalsUI = {setSnapshot(snapshot, sourceTabId) {
    if (source?.chartContext?.sourceKey !== snapshot?.chartContext?.sourceKey || tab !== sourceTabId) {
      state = null; generation++;
      for (const id of ["signalsEntryPrice", "signalsEntryTime", "signalsCurrency", "signalsSize"]) $(id).value = "";
    }
    source = snapshot; tab = sourceTabId; render(); void refresh();
  }, inspect: () => state};
  setInterval(() => { render(); void refresh(); }, 3000); render();
})();
