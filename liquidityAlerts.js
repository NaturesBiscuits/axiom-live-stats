// Pure alert state machine. Only observe() accepts live sampling attempts; restore/view never evaluate them.
(() => {
  "use strict";
  const H = globalThis.AxiomLiquidityHistory ?? require("./liquidityHistory.js");
  const DEFAULTS = Object.freeze({windowSeconds: 60, dropPercent: 20, minimumAbsoluteDrop: null,
    confirmations: 3, recoveryPercent: 15, recoveryConfirmations: 2});
  const FRESH_MS = 12500, RETENTION_MS = 7 * 86400000, MAX_ALERTS = 200, MAX_CONTEXTS = 64;
  const copy = value => JSON.parse(JSON.stringify(value));
  function validateSettings(input = {}, previous = DEFAULTS) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Alert settings must be an object.");
    const value = {...previous, ...input};
    if (![30, 60, 300, 900].includes(value.windowSeconds)) throw new Error("Choose a 30s, 1m, 5m or 15m window.");
    if (!Number.isFinite(value.dropPercent) || value.dropPercent <= 0 || value.dropPercent > 100) throw new Error("Drop threshold must be greater than 0 and at most 100%.");
    if (!Number.isFinite(value.recoveryPercent) || value.recoveryPercent < 0 || value.recoveryPercent >= value.dropPercent) throw new Error("Recovery threshold must be at least 0 and below the drop threshold.");
    if (value.minimumAbsoluteDrop !== null && (!Number.isFinite(value.minimumAbsoluteDrop) || value.minimumAbsoluteDrop <= 0)) throw new Error("Minimum absolute drop must be disabled or greater than 0 in the observed currency.");
    for (const key of ["confirmations", "recoveryConfirmations"]) if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > 20) throw new Error("Confirmation counts must be whole numbers from 1 to 20.");
    return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, value[key]]));
  }
  const identity = row => {
    const c = row.tokenIdentity ?? {};
    return [c.sourceKey, c.blockchain, c.mintAddress, c.poolAddress, c.identityStatus];
  };
  const scopeKey = row => JSON.stringify([row.tokenKey, row.unit, row.continuityId ?? null, identity(row), row.sourceTabId ?? null]);
  const runKey = row => JSON.stringify([row.tokenKey, row.continuityId ?? null, identity(row), row.sourceTabId ?? null]);
  const sameRun = (a, b) => a.tokenKey === b.tokenKey && a.continuityId === b.continuityId &&
    JSON.stringify(identity(a)) === JSON.stringify(identity(b)) && a.sourceTabId === b.sourceTabId;
  function coverage(rows, baseline, current) {
    const relevant = rows.filter(row => sameRun(row, current) && row.sampledAt >= baseline.sampledAt && row.sampledAt <= current.sampledAt);
    const expected = Math.floor((current.sampledAt - baseline.sampledAt) / H.CADENCE_MS) + 1;
    const validSlots = new Set(relevant.filter(row => row.unit === current.unit && H.valid(row))
      .map(row => Math.floor((row.sampledAt - baseline.sampledAt) / H.CADENCE_MS))).size;
    return {expected, validSlots, ratio: Math.min(1, validSlots / expected), complete: validSlots === expected};
  }
  function evidence(rows, baseline, current, rule) {
    const signedChangePercent = (current.value - baseline.value) / baseline.value * 100;
    if (!Number.isFinite(signedChangePercent)) return null;
    return {context: copy(current.tokenIdentity), tokenKey: current.tokenKey, scopeKey: scopeKey(current),
      source: "Axiom-reported liquidity", cause: "Cause unverified", currency: current.unit,
      baselineValue: baseline.value, currentValue: current.value, signedChangePercent,
      absoluteChange: current.value - baseline.value, absoluteDrop: baseline.value - current.value,
      baselineAt: baseline.domReadAt, baselineSampledAt: baseline.sampledAt, currentAt: current.domReadAt, currentSampledAt: current.sampledAt,
      intervalMs: current.domReadAt - baseline.domReadAt,
      coverage: coverage(rows, baseline, current), rule: copy(rule)};
  }
  function compare(rows, current, rule, now = Date.now()) {
    if (!H.isAttempt(current, now) || !H.valid(current)) return {status: "Data delayed/unavailable", reason: `Current reading is ${current?.status ?? "invalid"}; no value substituted.`};
    if (now - current.domReadAt > FRESH_MS) return {status: "Data delayed/unavailable", reason: "The current DOM observation is older than 12.5 seconds."};
    const selected = rows.filter(row => sameRun(row, current) && row.unit === current.unit && row.sampledAt <= current.sampledAt && H.isAttempt(row, now));
    const summary = H.analyze(selected), window = summary.windows[rule.windowSeconds];
    if (summary.latest?.sampledAt !== current.sampledAt) return {status: "Data delayed/unavailable", reason: "Current endpoint is unavailable."};
    if (window.status === "Collecting history") return {status: "Collecting history", reason: `Recorded ${Math.floor(summary.durationMs / 1000)}s of the required ${rule.windowSeconds}s in this source context and currency.`};
    if (!window.baseline) return {status: "Data delayed/unavailable", reason: "No valid baseline within ±2.5s of the comparison window start."};
    if (window.baseline.value === 0) return {status: "Data delayed/unavailable", reason: "The baseline is zero; percentage change is unavailable."};
    const result = evidence(selected, window.baseline, current, rule);
    if (!result) return {status: "Data delayed/unavailable", reason: "Percentage change is not finite."};
    return {status: "available", evidence: result, qualifies: -result.signedChangePercent >= rule.dropPercent &&
      (rule.minimumAbsoluteDrop === null || result.absoluteDrop >= rule.minimumAbsoluteDrop)};
  }
  function describe(rule) {
    return `Drop of at least ${rule.dropPercent}% over ${rule.windowSeconds === 30 ? "30 seconds" : `${rule.windowSeconds / 60} minute${rule.windowSeconds > 60 ? "s" : ""}`}` +
      `${rule.minimumAbsoluteDrop === null ? "" : ` and at least ${rule.minimumAbsoluteDrop} in the observed currency`} for ${rule.confirmations} consecutive fresh observations. ` +
      `Recover after ${rule.recoveryConfirmations} fresh observations at a drop of ${rule.recoveryPercent}% or less from the trigger baseline.`;
  }
  function createEngine({now = Date.now} = {}) {
    let settings = {...DEFAULTS}, history = [], states = new Map(), tabs = new Map();
    function prune() {
      history = history.filter(event => event.updatedAt >= now() - RETENTION_MS).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ALERTS);
      states = new Map([...states].sort((a, b) => b[1].lastSampledAt - a[1].lastSampledAt).slice(0, MAX_CONTEXTS));
      tabs = new Map([...tabs].filter(([, key]) => states.has(key)));
    }
    const activeFor = state => history.find(event => event.id === state?.activeId && event.recoveredAt === null);
    function restore(saved) {
      if (!saved || saved.version !== 1) return;
      states = new Map(); tabs = new Map();
      try { settings = validateSettings(saved.settings); } catch { /* Invalid saved rule uses explicit starter defaults. */ }
      history = (Array.isArray(saved.history) ? saved.history : []).filter(event => {
        try { return typeof event.id === "string" && typeof event.scopeKey === "string" && Number.isFinite(event.updatedAt) &&
          Number.isFinite(event.triggeredAt) && event.evidence?.baselineValue > 0 && Number.isFinite(event.evidence?.currentValue) &&
          !!validateSettings(event.rule); } catch { return false; }
      }).map(copy);
      history = [...new Map(history.map(event => [event.id, event])).values()];
      for (const savedState of Array.isArray(saved.checkpoints) ? saved.checkpoints : []) {
        if (typeof savedState.key !== "string" || !Number.isFinite(savedState.lastSampledAt)) continue;
        states.set(savedState.key, {...savedState, pending: 0, recovery: 0, live: false, lastFreshAt: null,
          status: "Data delayed/unavailable", reason: "Restored record; a fresh source observation is required."});
      }
      prune();
    }
    function exportState() {
      prune();
      return copy({version: 1, settings, history, checkpoints: [...states.values()].map(state => ({key: state.key,
        tokenKey: state.tokenKey, currency: state.currency, runKey: state.runKey, recordingId: state.recordingId,
        lastSampledAt: state.lastSampledAt, activeId: state.activeId ?? null}))});
    }
    function setSettings(input) {
      const next = validateSettings(input, settings);
      if (JSON.stringify(settings) !== JSON.stringify(next)) for (const state of states.values()) {
        state.pending = 0; state.recovery = 0;
        if (!activeFor(state)) { state.status = "Collecting history"; state.reason = "Rule updated; waiting for a new eligible observation. Pending confirmation was reset."; }
        else state.reason = "Rule updated; this active episode retains its original recovery rule. Pending recovery was reset.";
      }
      settings = next;
      return copy(settings);
    }
    function observe(row, rows, at = now()) {
      if (!H.isAttempt(row, at) || row.restored) return {changed: false};
      const tab = row.sourceTabId ?? "source";
      const previous = states.get(tabs.get(tab)) ?? [...states.values()].find(item => item.runKey === runKey(row));
      const key = !H.valid(row) && previous?.runKey === runKey(row) ? previous.key : scopeKey(row);
      let state = states.get(key);
      const priorEpisode = history.find(event => event.scopeKey === key && event.recoveredAt === null);
      if ((state && row.sampledAt <= state.lastSampledAt) || (!state && priorEpisode?.latestEvidence.currentSampledAt >= row.sampledAt)) return {changed: false};
      // A missing unmarked amount interrupts the current currency, without guessing its unit.
      if (previous && previous.key !== key) {
        previous.pending = 0; previous.recovery = 0; previous.live = false;
        const old = activeFor(previous);
        if (old) { old.monitoringEndedAt = at; old.monitoringEndReason = "Source context or currency changed; recovery unconfirmed."; }
      }
      tabs.set(tab, key);
      if (!state) { state = {key, tokenKey: row.tokenKey, currency: row.unit, runKey: runKey(row), recordingId: row.tokenIdentity.recordingId,
        lastSampledAt: -1, pending: 0, recovery: 0, activeId: priorEpisode?.id ?? null}; states.set(key, state); }
      if (row.sampledAt - state.lastSampledAt > H.GAP_MS || !state.live) { state.pending = 0; state.recovery = 0; }
      state.lastSampledAt = row.sampledAt;
      state.live = true; state.lastFreshAt = row.domReadAt;
      const active = activeFor(state);
      if (!H.valid(row) || at - row.domReadAt > FRESH_MS) {
        state.pending = 0; state.recovery = 0;
        state.status = "Data delayed/unavailable"; state.reason = !H.valid(row) ? `Latest sampling attempt is ${row.status}; waiting for a valid reading.` : "DOM observation is older than 12.5 seconds.";
      } else if (active) {
        const baseline = {value: active.evidence.baselineValue, domReadAt: active.evidence.baselineAt, sampledAt: active.baselineSampledAt};
        const current = evidence(rows, baseline, row, active.rule);
        if (!current) { state.recovery = 0; state.status = "Data delayed/unavailable"; state.reason = "Percentage change is not finite."; }
        else {
          active.latestEvidence = current; active.updatedAt = at; delete active.monitoringEndedAt; delete active.monitoringEndReason;
          state.recovery = -current.signedChangePercent <= active.rule.recoveryPercent ? state.recovery + 1 : 0;
          state.status = "Liquidity drop detected";
          state.reason = `Confirmed drop; cause unverified. Recovery ${state.recovery}/${active.rule.recoveryConfirmations} against the original trigger baseline.`;
          if (state.recovery >= active.rule.recoveryConfirmations) {
            active.recoveredAt = row.domReadAt; active.recoveryEvidence = current; state.activeId = null; state.recovery = 0;
            state.status = "No configured drop threshold reached"; state.reason = "Recovery confirmed against the original trigger baseline. No safety verdict is implied.";
          }
        }
      } else {
        const result = compare(rows, row, settings, at);
        state.status = result.status; state.reason = result.reason;
        if (result.status !== "available") state.pending = 0;
        else {
          state.pending = result.qualifies ? state.pending + 1 : 0;
          state.status = result.qualifies ? "Collecting history" : "No configured drop threshold reached";
          state.reason = result.qualifies ? `Drop condition met; confirmation ${state.pending}/${settings.confirmations} fresh observations.` : "The configured drop conditions are not met. This is not a safety verdict.";
          if (state.pending >= settings.confirmations) {
            const event = {id: JSON.stringify([key, row.sampledAt]), scopeKey: key, tokenKey: row.tokenKey,
              triggeredAt: row.domReadAt, recoveredAt: null, updatedAt: at, rule: copy(settings), evidence: result.evidence,
              latestEvidence: result.evidence, baselineSampledAt: result.evidence.baselineSampledAt};
            history.push(event); state.activeId = event.id; state.pending = 0;
            state.status = "Liquidity drop detected"; state.reason = "The configured drop was confirmed by consecutive fresh observations. Cause unverified.";
          }
        }
      }
      prune(); return {changed: true};
    }
    function view(tokenKey) {
      prune();
      return copy({settings, history: history.filter(event => event.tokenKey === tokenKey), states: [...states.values()]
        .filter(state => state.tokenKey === tokenKey).map(state => {
          const active = activeFor(state);
          const stale = !state.live || now() - state.lastFreshAt > FRESH_MS;
          return {...state, activeId: active?.id ?? null, stale,
            status: stale ? "Data delayed/unavailable" : state.status,
            reason: stale ? `No fresh source observation within 12.5 seconds.${active ? " Last confirmed state: liquidity drop detected; recovery unconfirmed." : ""}` : state.reason};
        }), retentionMs: RETENTION_MS, maxAlerts: MAX_ALERTS});
    }
    return {restore, exportState, setSettings, observe, view};
  }
  const api = {DEFAULTS, FRESH_MS, RETENTION_MS, MAX_ALERTS, MAX_CONTEXTS, validateSettings, scopeKey, compare, coverage, describe, createEngine};
  globalThis.AxiomLiquidityAlerts = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
