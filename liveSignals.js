// Deterministic observation analysis. No orders, provider requests, timers or AI.
(() => {
  "use strict";
  const copy = value => value === undefined ? null : JSON.parse(JSON.stringify(value));
  const finite = Number.isFinite, clamp = n => Math.max(-1, Math.min(1, n));
  const fresh = (time, at, limit) => finite(time) && time <= at + 1000 && at - time <= limit;
  const DEFAULTS = Object.freeze({strategyId: "momentum-breakout", profile: "Starter", lookbackMs: 60000,
    evaluationIntervalMs: 5000, freshMs: 10000, maxGapMs: 7500, minimumCoverage: 0.8,
    breakoutBufferPct: 0.2, resetBufferPct: 0.2, confirmations: 3, recoveryConfirmations: 2,
    minBuyShare: 0.6, minTrades: 5, minUnique: 3, maxTop1Pct: 60, minLiquidityChangePct: -5,
    maxTop10Pct: 50, maxDeveloperPct: 10, stopLossPct: 5, takeProfitPct: 10, trailingStopPct: 5, exitConfirmations: 2});
  const REGISTRY = Object.freeze({"momentum-breakout": Object.freeze({id: "momentum-breakout", version: "1.0.0",
    name: "Momentum Breakout", description: "Confirmed breakout above a preceding observed range, supported by buying and liquidity.",
    required: ["freshPrice", "precedingRange", "buying", "liquidity", "liquidityRules"],
    optional: ["participation", "volumeConcentration", "holderConcentration", "developerExposure"],
    assessEntry: momentumConditions,
    entry: "Range breakout + supporting buying + liquidity + no applicable risk veto, confirmed on distinct observations.",
    invalidation: "Observed momentum at or below -1% with buying share below 45%, or price back below the entry reference.",
    exits: ["active-risk", "stop-loss", "trailing-stop", "take-profit", "strategy-invalidation"]})});
  const LIMITS = Object.freeze({events: 500, journal: 2000, bytes: 4 * 1024 * 1024, contexts: 16, retentionMs: 86400000});
  function settings(input = {}, base = DEFAULTS) {
    const out = {...base, ...input};
    if (!REGISTRY[out.strategyId] || typeof out.profile !== "string" || !out.profile.trim() || out.profile.length > 60) throw new Error("Select a supported strategy and a profile name (1–60 characters).");
    const ranges = {lookbackMs: [30000, 300000], evaluationIntervalMs: [1000, 30000], freshMs: [3000, 15000], maxGapMs: [2000, 30000],
      minimumCoverage: [0.5, 1], breakoutBufferPct: [0.01, 10], resetBufferPct: [0.01, 10], confirmations: [1, 20], recoveryConfirmations: [1, 20],
      minBuyShare: [0.5, 0.99], minTrades: [1, 1000], minUnique: [1, 1000], maxTop1Pct: [1, 100], minLiquidityChangePct: [-99, 0],
      maxTop10Pct: [1, 100], maxDeveloperPct: [0, 100], stopLossPct: [0, 99], takeProfitPct: [0, 1000], trailingStopPct: [0, 99], exitConfirmations: [1, 20]};
    for (const [key, [min, max]] of Object.entries(ranges)) if (!finite(out[key]) || out[key] < min || out[key] > max ||
      /(?:Ms|confirmations|Confirmations|Trades|Unique)$/.test(key) && !Number.isInteger(out[key])) throw new Error(`Invalid ${key}: expected ${min}–${max}.`);
    if (out.maxGapMs < out.evaluationIntervalMs) throw new Error("Maximum confirmation gap must be at least the evaluation interval.");
    return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, out[key]]));
  }
  const identity = (context, tab, currency) => JSON.stringify([tab, context?.sourceKey, context?.blockchain ?? null, context?.mintAddress ?? null, context?.poolAddress ?? null, currency]);
  function buildSnapshot({snapshot, extras = {}, row, sourceTabId, at}) {
    const context = snapshot?.chartContext;
    if (!context?.sourceKey || context.conflict || !Number.isInteger(sourceTabId) || !row || row.restored || row.gap ||
        row.stale || row.source && row.source !== "axiom-dom-sample" || !finite(at) ||
        !finite(row.domReadAt) || !finite(row.sampledAt) || row.domReadAt > at + 1000 || row.sampledAt > at + 1000 ||
        row.domReadAt > row.sampledAt + 1000 || !finite(row.value) || row.value < 0 || !row.unit || row.unit === "unspecified") return null;
    const trade = extras.trading?.windows?.find(item => item.currency === row.unit) ?? null;
    const liquidity = extras.liquidity?.series?.find(item => item.unit === row.unit) ?? null;
    const tokenInfo = snapshot.tokenInfo ?? null;
    return {version: 1, key: identity(context, sourceTabId, row.unit), context: copy(context), sourceTabId, currency: row.unit,
      title: String(snapshot.title ?? "Axiom token"), provenance: "Axiom DOM observations; not historical API candles",
      evaluatedAt: at, observationId: `${row.domReadAt}:${row.sampledAt}`, observedAt: row.domReadAt,
      sampledAt: row.sampledAt, deliveredAt: row.deliveredAt ?? at, eventTime: null,
      latency: {sourceToEvaluationMs: at - row.domReadAt, sampleToDeliveryMs: (row.deliveredAt ?? at) - row.sampledAt},
      price: {value: row.value, displayText: row.displayText ?? null, currency: row.unit, observedAt: row.domReadAt},
      trading: {summary: trade, observedAt: extras.trading?.observedAt ?? null, filters: extras.trading?.filters ?? null, error: extras.trading?.archiveError ?? null},
      liquidity: {summary: liquidity?.summary ?? null, activity: extras.liquidity?.activity ?? null},
      holders: extras.holders ?? null, tokenInfo,
      market: {observedAt: snapshot.marketObservedAt ?? null, values: snapshot.stats ?? {}},
      sourceLimitations: ["Partial rendered DOM/trade coverage", "Observation times are not verified trade occurrence times", "Upstream feed freshness unknown"]};
  }
  function priceWindow(history, current, p) {
    const rows = history.filter(row => row.at < current.observedAt && row.at >= current.observedAt - p.lookbackMs - 2500);
    const target = current.observedAt - p.lookbackMs;
    const baseline = rows.filter(row => Math.abs(row.at - target) <= 2500).sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))[0];
    const range = rows.filter(row => row.at >= target);
    const coverage = Math.min(1, new Set(range.map(row => Math.floor((row.at - target) / 1000))).size / (p.lookbackMs / 1000));
    const ready = baseline && range.length && current.observedAt - baseline.at >= p.lookbackMs && coverage >= p.minimumCoverage;
    return {status: ready ? "available" : "unavailable", reason: ready ? null : "A complete preceding price window with sufficient one-second coverage is required.",
      from: baseline?.at ?? null, through: rows.at(-1)?.at ?? null, coverage,
      baselineValue: baseline?.value ?? null, highAt: ready ? range.reduce((a, b) => a.value >= b.value ? a : b).at : null,
      lowAt: ready ? range.reduce((a, b) => a.value <= b.value ? a : b).at : null,
      high: ready ? Math.max(...range.map(row => row.value)) : null, low: ready ? Math.min(...range.map(row => row.value)) : null,
      changePct: ready && baseline.value > 0 ? (current.price.value / baseline.value - 1) * 100 : null};
  }
  function momentumConditions(input, range, a, p, state) {
    const conditions = [];
    const add = (id, available, met, detail, optional = false) => conditions.push({id, status: !available ? "unavailable" : met ? "passed" : "failed", optional, detail});
    const threshold = (state.reference ?? range.high) * (1 + p.breakoutBufferPct / 100);
    add("freshPrice", true, a.live, `${input.evaluatedAt - input.observedAt}ms source age`);
    add("precedingRange", range.status === "available", range.status === "available" && input.price.value > threshold,
      `Price ${input.price.value}; preceding high ${state.reference ?? range.high}; buffer ${p.breakoutBufferPct}%; current observation excluded`);
    add("buying", a.tradeReady, a.buyShare >= p.minBuyShare && input.trading.summary?.events >= p.minTrades,
      `60s observed buy share ${a.buyShare}; minimum ${p.minBuyShare}, ${p.minTrades} trades`);
    add("liquidity", a.liquidityReady, a.liquidityReady && input.liquidity.summary.windows[60].change >= p.minLiquidityChangePct,
      `60s same-currency change must be >= ${p.minLiquidityChangePct}%`);
    add("liquidityRules", a.rulesReady, a.rulesReady, "Existing liquidity warning engine must be available");
    add("participation", a.tradeReady && a.unique !== null, a.unique >= p.minUnique, `Unique observed wallets ${a.unique}; minimum ${p.minUnique}`, true);
    add("volumeConcentration", a.top1 !== null, a.top1 <= p.maxTop1Pct, `Largest observed volume share ${a.top1}; maximum ${p.maxTop1Pct}%`, true);
    add("riskVeto", true, !a.warnings.some(w => w.veto), "Available risk evidence is evaluated independently of direction strength");
    return conditions;
  }
  function assess(input, range, p) {
    const at = input.evaluatedAt, live = fresh(input.observedAt, at, p.freshMs), t = input.trading.summary;
    const tradeReady = live && fresh(input.trading.observedAt, at, p.freshMs) && t?.recordingCoversWindow === true &&
      [t?.volumeEvents, t?.missingVolumeEvents, t?.otherCurrencyEvents, t?.unknownDirection, t?.initialSyncEvents, t?.events].every(value => finite(value) && value >= 0) &&
      !t.losses?.length && !input.trading.error && input.trading.filters?.status !== "restricted" &&
      t.volumeEvents > 0 && finite(t.buyVolume) && finite(t.sellVolume) && t.buyVolume + t.sellVolume > 0 &&
      !t.missingVolumeEvents && !t.otherCurrencyEvents && !t.unknownDirection && t.initialSyncEvents < t.events;
    const buyShare = tradeReady ? t.buyVolume / (t.buyVolume + t.sellVolume) : null;
    const ls = input.liquidity.summary, activity = input.liquidity.activity;
    const liquidityReady = live && fresh(ls?.latest?.domReadAt, at, p.freshMs) && ls?.lastAttempt?.status === "valid" &&
      ls.windows?.[60]?.status === "available" && finite(ls.windows[60].change) && ls.coverage >= p.minimumCoverage;
    const rulesReady = activity?.ruleLoaded === true && !activity.error;
    const tile = key => {
      const field = input.tokenInfo?.tiles?.[key];
      return field?.status === "available" && fresh(field.observedAt ?? input.tokenInfo.observedAt, at, p.freshMs) && finite(field.value) ? field.value : null;
    };
    const warnings = [], unknowns = [], riskChecks = [];
    const risk = (id, value, threshold, label) => { riskChecks.push({id, available: value !== null, met: value !== null && value > threshold}); if (value === null) unknowns.push(`${label}: unavailable or stale`);
      else if (value > threshold) warnings.push({id, label, value, threshold, veto: true}); };
    risk("top10-concentration", tile("top10Holders"), p.maxTop10Pct, "Axiom-reported Top 10 concentration");
    risk("developer-exposure", tile("developerHoldings"), p.maxDeveloperPct, "Axiom-reported developer holdings");
    const observedTen = input.holders?.concentration?.results?.find(row => row.n === 10);
    const observedHolding = fresh(input.holders?.extractedAt, at, p.freshMs) && fresh(input.holders?.concentration?.observedAt, at, p.freshMs) && finite(observedTen?.percentage) ? observedTen.percentage : null;
    risk("observed-holder-concentration", observedHolding, p.maxTop10Pct, "Largest ten current observed holdings; partial coverage and original supply denominator");
    const top1 = t && t.unresolvedVolume === 0 && fresh(input.trading.observedAt, at, p.freshMs) ? t.shares?.find(s => s.n === 1)?.percentage ?? null : null;
    risk("observed-volume-concentration", finite(top1) ? top1 : null, p.maxTop1Pct, "Largest observed wallet volume share; partial coverage");
    const active = activity?.history?.filter(event => event.recoveredAt === null && !event.monitoringEndedAt && (event.currency ?? event.evidence?.currency) === input.currency) ?? [];
    const activeIds = [...new Set([...active.map(event => event.id), ...(activity?.states ?? []).filter(s => s.activeId && s.currency === input.currency).map(s => s.activeId)])];
    if (activeIds.length) warnings.push({id: "liquidity-drop", label: "Existing confirmed liquidity drop; cause unverified", veto: true,
      eventIds: activeIds, evidence: active.map(event => event.latestEvidence ?? event.evidence)});
    riskChecks.push({id: "liquidity-drop", available: rulesReady, met: activeIds.length > 0});
    if (!rulesReady) unknowns.push("Liquidity warning rules/evidence unavailable");
    if (!liquidityReady) unknowns.push("Fresh same-currency liquidity and 60-second comparison unavailable");
    if (!tradeReady) unknowns.push("Fresh same-currency observed volume, full window, newly observed events and usable coverage required");
    if (input.trading.filters?.status !== "known" && input.trading.filters?.status !== "unrestricted") unknowns.push(`Trade filters: ${input.trading.filters?.status ?? "unknown"}`);
    if (!fresh(input.holders?.extractedAt, at, p.freshMs)) unknowns.push("Current holder table unavailable or stale");
    unknowns.push("Mint/freeze permissions, ownership, LP locks and contract behavior are not independently verified");
    const factors = [];
    const factor = (id, weight, value, signed, required, window, reason) => factors.push({id, weight, value, window,
      direction: signed === null ? "unavailable" : signed === 0 ? "neutral" : signed > 0 ? "bullish" : "bearish", signed, required,
      contribution: signed === null ? null : signed * weight, reason: signed === null ? reason : null});
    const momentum = live && range.status === "available" && finite(range.changePct) ? range.changePct : null;
    factor("price-momentum", 40, momentum, momentum === null ? null : Math.abs(momentum) < 0.1 ? 0 : clamp(momentum / 2), true, `${p.lookbackMs / 1000}s`, range.reason ?? "Fresh price required");
    factor("observed-volume-pressure", 35, buyShare, buyShare === null ? null : Math.abs(buyShare - 0.5) <= 0.05 ? 0 : clamp((buyShare - 0.5) * 2), true, "60s", "Comparable fresh buy/sell volume unavailable");
    const count = tradeReady && finite(t.buys) && finite(t.sells) && t.buys + t.sells > 0 ? (t.buys - t.sells) / (t.buys + t.sells) : null;
    factor("observed-count-pressure", 15, count, count === null ? null : Math.abs(count) <= 0.1 ? 0 : count, false, "60s", "Usable trade counts unavailable");
    const liquidityChange = liquidityReady ? ls.windows[60].change : null;
    factor("liquidity-change", 10, liquidityChange, liquidityChange === null ? null : Math.abs(liquidityChange) < 0.5 ? 0 : clamp(liquidityChange / 5), false, "60s", "Fresh liquidity baseline unavailable");
    const weight = factors.filter(f => f.signed !== null).reduce((sum, f) => sum + f.weight, 0);
    const sufficient = live && factors.filter(f => f.required).every(f => f.signed !== null);
    const bullish = sufficient ? Math.max(0, Math.min(100, 50 + 50 * factors.reduce((sum, f) => sum + (f.contribution ?? 0), 0) / weight)) : null;
    return {riskChecks, score: {status: sufficient ? "available" : "Insufficient data", bullish, bearish: bullish === null ? null : 100 - bullish, coverage: weight / 100, factors,
      meaning: "Technical-condition strength; not a probability or forecast"}, live, tradeReady, buyShare, liquidityReady, rulesReady, warnings, unknowns,
      unique: t && [t.buyers, t.sellers, t.bothSides].every(finite) ? t.buyers + t.sellers - t.bothSides : null,
      top1: finite(top1) ? top1 : null};
  }
  function createEngine({now = Date.now} = {}) {
    let profile = settings(), events = [], journal = [], journalBytes = 0, positions = new Map(), states = new Map(), interrupted = false, actionSequence = 0;
    function prune(at = now()) {
      events = events.filter(e => e.evaluatedAt >= at - LIMITS.retentionMs).slice(-LIMITS.events);
      journal = journal.filter(e => { if (e.evaluatedAt >= at - LIMITS.retentionMs) return true; journalBytes -= JSON.stringify(e).length * 2; return false; });
      while ((journalBytes > LIMITS.bytes || journal.length > LIMITS.journal) && journal.length) journalBytes -= JSON.stringify(journal.shift()).length * 2;
      while (states.size > LIMITS.contexts) { const key = states.keys().next().value; states.delete(key); }
    }
    function emit(type, state, input, reason) {
      const p = positions.get(input.key), strategy = REGISTRY[(type.startsWith("exit") || type === "sell-trigger") && p ? p.settings.strategyId : profile.strategyId];
      const event = {id: `${input.key}:${strategy.id}:${type}:${input.observedAt}`, type, key: input.key,
        title: input.title,
        strategy: {id: strategy.id, version: strategy.version}, settings: copy(type.startsWith("exit") || type === "sell-trigger" ? p?.settings ?? profile : profile),
        context: copy(input.context), sourceTabId: input.sourceTabId, currency: input.currency, triggeredAt: input.observedAt, evaluatedAt: input.evaluatedAt,
        observationId: input.observationId, supportingObservations: {price: input.price, range: state.referenceWindow ?? state.view.range, tradingObservedAt: input.trading.observedAt,
          liquidityObservedAt: input.liquidity.summary?.latest?.domReadAt ?? null, trading: copy(input.trading), liquidity: copy(input.liquidity),
          holders: copy(input.holders), tokenInfo: copy(input.tokenInfo)},
        price: input.price.value, priceObservedAt: input.observedAt, sourceEventTime: null, observationAgeMs: input.evaluatedAt - input.observedAt, conditions: copy(state.view.conditions),
        warnings: copy(state.view.warnings), unknowns: copy(state.view.unknowns), coverage: state.view.score.coverage,
        latency: copy(input.latency), reason, recoveredAt: null, outdated: false, positionId: p?.id ?? null};
      if (!events.some(e => e.id === event.id)) events.push(event);
      return event;
    }
    function positionCheck(position, input, state, distinct) {
      const p = position.settings, at = input.evaluatedAt, price = input.price.value;
      const ownRange = priceWindow(state.history, input, p), own = assess(input, ownRange, p);
      const usable = fresh(input.observedAt, at, p.freshMs) && input.observedAt >= position.entryAt;
      if (!usable) { position.pending = 0; position.status = position.status === "sell-trigger" ? position.status : "exit-warning";
        position.reason = "No fresh post-entry observation; exit/recovery unconfirmed."; return; }
      if (!distinct) return;
      if (position.lastObservedAt && input.observedAt - position.lastObservedAt > p.maxGapMs) { position.pending = 0; for (const risk of Object.values(position.risks ?? {})) risk.recovery = 0; }
      position.lastObservedAt = input.observedAt; position.highWater = Math.max(position.highWater, price);
      position.lastPrice = price; position.priceObservedAt = input.observedAt;
      position.pnlPct = (price / position.entryPrice - 1) * 100;
      position.estimatedPnl = position.size === null ? null : (price - position.entryPrice) * position.size;
      position.risks ??= {};
      for (const warning of own.warnings) position.risks[warning.id] = {...warning, recovery: 0};
      for (const [id, warning] of Object.entries(position.risks)) {
        if (own.warnings.some(w => w.id === id)) continue;
        const check = own.riskChecks.find(c => c.id === id);
        const recovered = id !== "liquidity-drop" || warning.eventIds.every(eventId => input.liquidity.activity?.history?.some(e => e.id === eventId && e.recoveredAt !== null));
        warning.recovery = check?.available && !check.met && recovered ? warning.recovery + 1 : 0;
        if (warning.recovery >= (id === "liquidity-drop" ? 1 : p.recoveryConfirmations)) delete position.risks[id];
      }
      const rangeHigh = position.entryReference;
      const checks = [
        ["active-risk", Object.values(position.risks).some(w => w.veto)],
        ["stop-loss", p.stopLossPct > 0 && price <= position.entryPrice * (1 - p.stopLossPct / 100)],
        ["trailing-stop", p.trailingStopPct > 0 && price <= position.highWater * (1 - p.trailingStopPct / 100)],
        ["take-profit", p.takeProfitPct > 0 && price >= position.entryPrice * (1 + p.takeProfitPct / 100)],
        ["strategy-invalidation", finite(rangeHigh) && price < rangeHigh || finite(ownRange.changePct) && ownRange.changePct <= -1 && own.buyShare !== null && own.buyShare < 0.45]
      ];
      position.exitConditions = checks.map(([id, met]) => ({id, met: Boolean(met)}));
      const reason = checks.find(([, met]) => met)?.[0] ?? null;
      if (position.status === "sell-trigger") return;
      if (reason === "active-risk" && !own.warnings.length) {
        position.status = "exit-warning"; position.pending = 0; position.reason = "Previous risk remains active; fresh supporting evidence/recovery is unavailable."; return;
      }
      position.pending = reason ? position.pendingReason === reason ? position.pending + 1 : 1 : 0; position.pendingReason = reason;
      if (reason) {
        position.status = position.pending >= p.exitConfirmations ? "sell-trigger" : "exit-warning";
        position.reason = `${reason}: ${position.pending}/${p.exitConfirmations} distinct observations. No order executed.`;
        if (position.pending === 1) emit("exit-warning", state, input, position.reason);
        if (position.status === "sell-trigger") emit("sell-trigger", state, input, position.reason);
      } else { position.status = "holding"; position.reason = "No configured position exit threshold met; unknown checks remain visible."; }
    }
    function observe(input) {
      if (!input || !finite(input.evaluatedAt) || !finite(input.observedAt) || !finite(input.price?.value) || input.price.value < 0 || !input.key) return {changed: false};
      const p = profile, at = input.evaluatedAt;
      for (const [key, prior] of states) if (key !== input.key && prior.sourceTabId === input.sourceTabId && prior.active) {
        prior.pending = prior.recovery = 0; prior.history = []; prior.active = false;
        if (prior.view) { prior.view.live = false; prior.view.observedAt = null; }
      }
      let state = states.get(input.key);
      if (!state) { state = {history: [], lastObservedAt: null, lastEvaluatedAt: null, pending: 0, recovery: 0, latched: false, reference: null}; states.set(input.key, state); }
      state.sourceTabId = input.sourceTabId; state.active = true;
      if (input.observedAt <= (state.lastObservedAt ?? -Infinity)) return {changed: false};
      const gap = state.lastObservedAt !== null && input.observedAt - state.lastObservedAt > p.maxGapMs;
      state.lastObservedAt = input.observedAt;
      if (gap || !fresh(input.observedAt, at, p.freshMs)) { state.pending = 0; state.recovery = 0; for (const risk of Object.values(state.risks ?? {})) risk.recovery = 0; if (!state.latched) state.reference = null; }
      const range = priceWindow(state.history, input, p);
      state.history.push({at: input.observedAt, value: input.price.value});
      state.history = state.history.filter(row => row.at >= input.observedAt - 305000).slice(-1800);
      if (state.lastEvaluatedAt !== null && input.observedAt - state.lastEvaluatedAt < p.evaluationIntervalMs && !gap) return {changed: false};
      state.lastEvaluatedAt = input.observedAt;
      input = copy(input);
      const a = assess(input, range, p);
      state.risks ??= {};
      const newRiskIds = a.warnings.filter(w => !state.risks[w.id]).map(w => w.id);
      for (const warning of a.warnings) state.risks[warning.id] = {...warning, recovery: 0};
      for (const [id, warning] of Object.entries(state.risks)) {
        if (a.warnings.some(w => w.id === id)) continue;
        const check = a.riskChecks.find(c => c.id === id);
        const liquidityRecovered = id === "liquidity-drop" && warning.eventIds.every(eventId => input.liquidity.activity?.history?.some(e => e.id === eventId && e.recoveredAt !== null));
        warning.recovery = check?.available && !check.met && a.live && (id !== "liquidity-drop" || liquidityRecovered) ? warning.recovery + 1 : 0;
        if (warning.recovery >= (id === "liquidity-drop" ? 1 : p.recoveryConfirmations)) {
          delete state.risks[id];
          for (const event of events) if (event.key === input.key && event.type.startsWith("risk-warning:") && event.riskId === id && event.recoveredAt === null) {
            event.recoveredAt = id === "liquidity-drop" ? Math.max(...warning.eventIds.map(eventId => input.liquidity.activity.history.find(e => e.id === eventId).recoveredAt)) : input.observedAt;
            event.recoveryEvaluatedAt = input.evaluatedAt;
            event.recoveryReason = id === "liquidity-drop" ? "Existing liquidity engine recorded recovery." : "Fresh below-threshold observations confirmed recovery.";
          }
        } else warning.recoveryUnconfirmed = true;
      }
      a.warnings = Object.values(state.risks);
      const conditions = REGISTRY[p.strategyId].assessEntry(input, range, a, p, state);
      const eligible = conditions.filter(c => !c.optional).every(c => c.status === "passed") && conditions.filter(c => c.optional && c.status !== "unavailable").every(c => c.status === "passed");
      if (state.latched) {
        const invalid = a.live && finite(state.reference) && input.price.value <= state.reference * (1 - p.resetBufferPct / 100);
        state.recovery = invalid ? state.recovery + 1 : 0;
        if (state.recovery >= p.recoveryConfirmations) {
          state.latched = false; state.reference = null; state.recovery = 0;
          for (const event of events) if (event.key === input.key && event.type === "buy-trigger" && event.recoveredAt === null) { event.recoveredAt = input.observedAt; event.recoveryReason = "Price invalidation confirmed below the original range."; }
        }
      }
      if (!state.latched && eligible) { if (state.reference === null) { state.reference = range.high; state.referenceWindow = copy(range); } state.pending++; }
      else if (!state.latched) { state.pending = 0; state.reference = null; state.referenceWindow = null; }
      let phase = range.status !== "available" || !a.live ? "warming-up" : state.latched ? eligible ? "buy-trigger" : "watching" : state.pending ? "setup-forming" : "watching";
      const trigger = !state.latched && state.pending >= p.confirmations;
      if (trigger) { state.latched = true; phase = "buy-trigger"; }
      conditions.push({id: "confirmation", status: !a.live ? "unavailable" : state.latched ? "passed" : state.pending ? "pending" : "failed", optional: false,
        detail: `${state.pending}/${p.confirmations} eligible observations; recovery ${state.recovery}/${p.recoveryConfirmations}`});
      state.view = {...a, key: input.key, context: input.context, sourceTabId: input.sourceTabId, currency: input.currency, title: input.title,
        observedAt: input.observedAt, evaluatedAt: at, range, conditions, phase,
        signal: phase === "buy-trigger" ? "Configured entry conditions met. Informational trigger; no order executed." : state.latched ? "Previous entry trigger retained; current conditions are not met. Waiting for reference invalidation to rearm." : "Entry conditions are not confirmed.",
        strategy: REGISTRY[p.strategyId], settings: copy(p), latency: input.latency, provenance: input.provenance,
        observations: {price: input.price, trading: input.trading, liquidity: input.liquidity, holders: input.holders, tokenInfo: input.tokenInfo, market: input.market ?? null}};
      if (trigger) emit("buy-trigger", state, input, "Configured entry conditions met.");
      for (const riskId of newRiskIds) emit(`risk-warning:${riskId}`, state, input, "Available risk threshold reached; cause/contract checks remain unverified.").riskId = riskId;
      const position = positions.get(input.key); if (position && !position.closedAt) positionCheck(position, input, state, true);
      const recorded = {id: `${input.key}:${input.observedAt}`, observationId: input.observationId, type: "observation", key: input.key, context: input.context, sourceTabId: input.sourceTabId,
        currency: input.currency, observedAt: input.observedAt, evaluatedAt: at, price: input.price, eventTime: input.eventTime,
        strategy: {id: p.strategyId, version: REGISTRY[p.strategyId].version}, settings: copy(p), range, score: a.score, conditions,
        warnings: copy(a.warnings), unknowns: a.unknowns, trading: input.trading, liquidity: input.liquidity, holders: input.holders, tokenInfo: input.tokenInfo, latency: input.latency};
      journal.push(recorded); journalBytes += JSON.stringify(recorded).length * 2;
      interrupted = false; prune(at); return {changed: true, key: input.key};
    }
    function view(key, at = now()) {
      prune(at); const state = states.get(key), position = positions.get(key), result = state?.view ? copy(state.view) : null;
      if (result && !fresh(result.observedAt, at, profile.freshMs)) {
        result.phase = "data-delayed"; result.live = false; result.signal = "Source delayed; last signal/recovery unconfirmed.";
        result.score.status = "Insufficient data"; result.score.bullish = result.score.bearish = null;
      }
      const tracked = position ? copy(position) : null;
      if (tracked && !tracked.closedAt && (!result?.live || !fresh(tracked.priceObservedAt, at, tracked.settings.freshMs))) {
        tracked.status = tracked.status === "sell-trigger" ? tracked.status : "exit-warning"; tracked.reason = "Position observation delayed; exit/recovery unconfirmed.";
        tracked.pnlPct = tracked.estimatedPnl = null;
      }
      return {key, current: result, position: tracked, settings: copy(profile), strategies: Object.values(REGISTRY).map(({assessEntry, ...metadata}) => metadata),
        history: copy(events.filter(event => !key || event.key === key).slice(-50)), interrupted, trackedPositions: [...positions.values()].filter(p => !p.closedAt).length,
        retention: LIMITS, journalCount: journal.length};
    }
    function openPosition(key, values) {
      const state = states.get(key), current = state?.view;
      if (!current?.live || !fresh(current.observedAt, now(), profile.freshMs)) throw new Error("Select a token with a fresh observation before logging a position.");
      if (positions.get(key) && !positions.get(key).closedAt) throw new Error("Close the existing tracked position first.");
      if (!["paper", "reported-real"].includes(values.mode) || !finite(values.entryPrice) || values.entryPrice <= 0 || values.currency !== current.currency ||
          !finite(values.entryAt) || values.entryAt > now() || values.entryAt < now() - LIMITS.retentionMs || values.size !== null && (!finite(values.size) || values.size <= 0)) throw new Error("Enter a positive entry price, matching currency, entry time within the last 24h, and optional positive token size.");
      const plan = settings({...profile, ...values.exits});
      positions.set(key, {id: `${key}:${now()}:${++actionSequence}`, key, mode: values.mode, entryPrice: values.entryPrice, currency: values.currency, entryAt: values.entryAt,
        size: values.size, context: copy(current.context), sourceTabId: current.sourceTabId,
        settings: plan, strategyVersion: REGISTRY[plan.strategyId].version, entryReference: state.reference ?? null,
        highWater: values.entryPrice, lastObservedAt: null, priceObservedAt: null, pending: 0, status: "holding", closedAt: null,
        pnlPct: null, estimatedPnl: null, assumptions: "Gross estimate in quote currency; fees and slippage excluded; not an executable quote."});
      if (positions.size > LIMITS.contexts) { const closed = [...positions.values()].find(p => p.closedAt); if (closed) positions.delete(closed.key); else { positions.delete(key); throw new Error("Maximum tracked positions reached."); } }
      recordPosition("position-logged", positions.get(key), current);
    }
    function recordPosition(type, position, current) {
      events.push({id: `${position.id}:${type}:${++actionSequence}`, type, key: position.key, positionId: position.id,
        strategy: {id: position.settings.strategyId, version: position.strategyVersion}, settings: copy(position.settings),
        context: copy(position.context), sourceTabId: position.sourceTabId, currency: position.currency, triggeredAt: now(), evaluatedAt: now(),
        price: type === "position-logged" ? position.entryPrice : null, priceObservedAt: null, sourceEventTime: null,
        position: copy(position), conditions: copy(current?.conditions ?? []), warnings: copy(current?.warnings ?? []), unknowns: copy(current?.unknowns ?? []),
        supportingObservations: {userReportedEntry: {price: position.entryPrice, at: position.entryAt, size: position.size, mode: position.mode}, lastSourceObservedAt: position.priceObservedAt},
        reason: type === "position-logged" ? "User logged a position; reported entry is not a verified execution." : "User marked tracking closed; no exit price or execution asserted.",
        recoveredAt: null, outdated: false}); prune();
    }
    return {observe, view, openPosition, closePosition(key) { const p = positions.get(key); if (!p || p.closedAt) throw new Error("No open position in this source/currency context."); p.closedAt = now(); p.status = "closed"; recordPosition("position-closed", p, states.get(key)?.view); },
      setSettings(input) { profile = settings(input, profile); for (const s of states.values()) { s.pending = s.recovery = 0; for (const risk of Object.values(s.risks ?? {})) risk.recovery = 0; if (!s.latched) s.reference = null; } return copy(profile); },
      interrupt(tab) { for (const state of states.values()) if (state.sourceTabId === tab) { if (state.view) { state.view.live = false; state.view.observedAt = null; } state.pending = state.recovery = 0; state.history = []; state.active = false; } },
      exportState() { prune(); return copy({version: 1, actionSequence, settings: profile, events, journal, positions: [...positions.values()],
        checkpoints: [...states].map(([key, s]) => ({key, sourceTabId: s.sourceTabId, lastObservedAt: s.lastObservedAt, latched: s.latched, reference: s.reference, referenceWindow: s.referenceWindow ?? null, risks: s.risks ?? {}}))}); },
      restore(saved) {
        if (!saved) return; if (saved.version !== 1) throw new Error("Unsupported live-signal storage version.");
        actionSequence = Number.isSafeInteger(saved.actionSequence) ? saved.actionSequence : 0;
        profile = settings(saved.settings); events = copy(saved.events ?? []).map(e => ({...e, outdated: true})); journal = copy(saved.journal ?? []);
        journalBytes = journal.reduce((sum, row) => sum + JSON.stringify(row).length * 2, 0);
        positions = new Map((saved.positions ?? []).map(p => [p.key, {...copy(p), pending: 0}]));
        states = new Map((saved.checkpoints ?? []).map(s => [s.key, {...s, history: [], lastEvaluatedAt: null, pending: 0, recovery: 0}]));
        for (const saved of [...positions.values(), ...states.values()]) for (const risk of Object.values(saved.risks ?? {})) risk.recovery = 0;
        interrupted = true; prune();
      }};
  }
  // Outcome inspection is separate from generation; no return is fed back into rules.
  function outcomes(events, observations, horizons = [30, 60, 300]) {
    return events.filter(e => e.type === "buy-trigger" && e.price > 0).flatMap(event => horizons.map(seconds => {
      const target = event.evaluatedAt + seconds * 1000;
      const next = observations.filter(row => row.key === event.key && row.observedAt >= target && row.observedAt <= target + DEFAULTS.maxGapMs && row.evaluatedAt >= event.evaluatedAt)
        .sort((a, b) => a.observedAt - b.observedAt)[0];
      return {signalId: event.id, horizonSeconds: seconds, status: next ? "observed" : "unavailable", observedAt: next?.observedAt ?? null,
        grossObservedReturnPct: next ? (next.price.value / event.price - 1) * 100 : null, assumptions: "Observed gross price change, not an execution, win rate or net return"};
    }));
  }
  const api = {DEFAULTS, REGISTRY, LIMITS, settings, identity, buildSnapshot, priceWindow, assess, createEngine, outcomes};
  globalThis.AxiomLiveSignals = Object.freeze(api); if (typeof module !== "undefined") module.exports = api;
})();
