// Pure event identity, timing, bounded retention and participation analysis.
(() => {
  "use strict";
  const SOURCE = "axiom-trade-dom", RETENTION_MS = 86400000, MAX_RECORDS = 50000, MAX_MEMORY = 20000;
  const identity = () => globalThis.AxiomHolderTableExtractor ?? require("./holderTableExtractor.js");
  const eventKey = row => JSON.stringify([row.tokenKey, row.eventKey]);
  const opaqueKey = key => typeof key === "string" && key.length > 0 && key.length <= 1024 && key.trim().length > 0 && !/[\u0000-\u001f]/.test(key);
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  function ageTiming(raw, at) {
    const match = clean(raw).match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)(?:\s+ago)?$/i);
    if (!match) return null;
    const scale = {s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000}[match[2].toLowerCase()];
    const age = Number(match[1]) * scale, precisionMs = scale / 10 ** (match[1].split(".")[1]?.length ?? 0);
    // The capture does not establish floor/nearest/ceiling rounding. Use a
    // conservative +/- one displayed unit, clamped to the actual observation.
    const earliestAt = at - age - precisionMs, latestAt = Math.min(at, at - age + precisionMs);
    if (!Number.isFinite(earliestAt) || earliestAt < 0) return null;
    return {basis: "approximate-trade-time", estimatedTradeAt: at - age,
      earliestAt, latestAt, precisionMs, ageObservedAt: at, ageDisplayText: clean(raw),
      confidence: "approximate", rounding: "Rounding rule unavailable; uncertainty +/- one displayed unit, clamped to observation time; not a blockchain timestamp"};
  }
  function sourceContext(context, sessionId, epoch) {
    const resolved = !context.conflict && context.blockchain && identity().isAddress(context.mintAddress) && identity().isAddress(context.poolAddress);
    const canonical = value => value && identity().isAddress(value) ? identity().addressKey(value) : value ?? null;
    return {...context, identityStatus: context.conflict ? "conflict" : resolved ? "resolved-dom-hints" : "unresolved",
      tokenKey: JSON.stringify(["trading-v1", resolved ? [context.blockchain, canonical(context.mintAddress), canonical(context.poolAddress)] :
        [context.sourceKey, sessionId, epoch]])};
  }
  function makeEvent(row, context, at, appearance = "newly-observed") {
    const timing = ageTiming(row.rawAge, at);
    return {...row, source: SOURCE, tokenKey: context.tokenKey, context: {...context},
      firstSeenAt: at, lastReadAt: at, appearance, timing,
      estimatedTradeAt: timing?.estimatedTradeAt ?? null, timingStatus: timing ? "approximate" : "observation-time-only",
      totals: row.total?.status === "valid" && row.total.unit !== "unspecified" ? {[row.total.unit]: {...row.total, observedAt: at}} : {}};
  }
  const validAmount = amount => amount && Number.isFinite(amount.value) && amount.value >= 0;
  function mergeEvent(old, incoming) {
    if (!old) return structuredClone(incoming);
    if (eventKey(old) !== eventKey(incoming)) throw new Error("Cannot merge different source/event identities");
    const newer = incoming.lastReadAt >= old.lastReadAt ? incoming : old;
    const first = incoming.firstSeenAt < old.firstSeenAt ? incoming : old;
    const other = newer === incoming ? old : incoming;
    const merged = {...other, ...newer, firstSeenAt: Math.min(old.firstSeenAt, incoming.firstSeenAt),
      lastReadAt: Math.max(old.lastReadAt, incoming.lastReadAt), appearance: first.appearance};
    const timings = [old.timing, incoming.timing].filter(Boolean).sort((a, b) => a.ageObservedAt - b.ageObservedAt);
    merged.timing = timings[0] ?? null; merged.estimatedTradeAt = merged.timing?.estimatedTradeAt ?? null;
    merged.timingStatus = merged.timing ? "approximate" : "observation-time-only";
    const makers = new Set([...(old.makerCandidates ?? []), ...(incoming.makerCandidates ?? []), old.makerAddress, incoming.makerAddress]
      .filter(address => identity().isAddress(address)).map(address => identity().addressKey(address)));
    merged.makerCandidates = [...makers];
    merged.identityStatus = old.identityStatus === "conflicting" || incoming.identityStatus === "conflicting" || makers.size > 1 ? "conflicting" : makers.size ? "resolved" : "unresolved";
    merged.makerAddress = merged.identityStatus === "resolved" ? [...makers][0] : null;
    const sides = new Set([...(old.directionMarkers ?? []), ...(incoming.directionMarkers ?? [])]);
    merged.directionMarkers = [...sides];
    merged.direction = sides.size === 1 ? sides.has("text-increase") ? "buy" : "sell" : "unknown";
    merged.directionEvidence = {source: "scoped-total-semantic-class", markers: [...sides], status: sides.size > 1 ? "conflicting" : sides.size ? "supported-observation" : "missing"};
    merged.totals = {};
    for (const unit of new Set([...Object.keys(old.totals ?? {}), ...Object.keys(incoming.totals ?? {})])) {
      const a = old.totals?.[unit], b = incoming.totals?.[unit];
      merged.totals[unit] = !a ? b : !b ? a : a.status === "conflicting" || b.status === "conflicting" || a.value !== b.value ?
        {...(b.observedAt >= a.observedAt ? b : a), value: null, status: "conflicting"} : b.observedAt >= a.observedAt ? b : a;
    }
    if (old.tokenAmount?.status === "valid" && incoming.tokenAmount?.status !== "valid") merged.tokenAmount = old.tokenAmount;
    if (old.tokenAmount?.status === "valid" && incoming.tokenAmount?.status === "valid" && old.tokenAmount.value !== incoming.tokenAmount.value) merged.tokenAmount = {...incoming.tokenAmount, value: null, status: "conflicting"};
    if (old.tokenAmount?.status === "conflicting" || incoming.tokenAmount?.status === "conflicting") merged.tokenAmount = {...newer.tokenAmount, value: null, status: "conflicting"};
    if (old.transactionLinkStatus === "conflicting" || incoming.transactionLinkStatus === "conflicting" ||
        old.transactionUrl && incoming.transactionUrl && old.transactionUrl !== incoming.transactionUrl) {
      merged.transactionUrl = null; merged.transactionLinkStatus = "conflicting";
    } else merged.transactionUrl = newer.transactionUrl ?? other.transactionUrl ?? null;
    merged.hadRestrictedFilters = old.hadRestrictedFilters || incoming.hadRestrictedFilters || old.filters?.status === "restricted" || incoming.filters?.status === "restricted";
    merged.hadUnknownFilters = old.hadUnknownFilters || incoming.hadUnknownFilters || old.filters?.status === "unknown" || incoming.filters?.status === "unknown";
    return merged;
  }
  function mergeRows(...collections) {
    const rows = new Map();
    for (const list of collections) for (const row of list ?? []) rows.set(eventKey(row), mergeEvent(rows.get(eventKey(row)), row));
    return [...rows.values()];
  }
  function mergeCoverage(a, b) {
    if (!a) return b ?? null;
    if (!b) return a;
    if (a.tokenKey !== b.tokenKey) throw new Error("Cannot merge coverage for different sources");
    const newer = (b.lastReadAt ?? 0) >= (a.lastReadAt ?? 0) ? b : a;
    const starts = [a.recordingStartedAt, b.recordingStartedAt].filter(Number.isFinite);
    return {...a, ...b, ...newer, recordingStartedAt: starts.length ? Math.min(...starts) : null,
      lastRenderedLimitAt: Math.max(a.lastRenderedLimitAt ?? 0, b.lastRenderedLimitAt ?? 0) || null,
      multipleRecordingSessions: a.multipleRecordingSessions || b.multipleRecordingSessions || Boolean(a.recordingSessionId && b.recordingSessionId && a.recordingSessionId !== b.recordingSessionId)};
  }
  function isEvent(row, at = Date.now()) {
    return Boolean(row?.source === SOURCE && typeof row.tokenKey === "string" && row.tokenKey.length <= 4096 && opaqueKey(row.eventKey) &&
      row.context?.tokenKey === row.tokenKey && typeof row.context.sourceKey === "string" &&
      ["resolved-dom-hints", "unresolved", "conflict"].includes(row.context.identityStatus) &&
      ["buy", "sell", "unknown"].includes(row.direction) && Array.isArray(row.directionMarkers) &&
      row.directionMarkers.every(marker => ["text-increase", "text-decrease"].includes(marker)) &&
      ["resolved", "unresolved", "conflicting"].includes(row.identityStatus) &&
      (row.makerAddress === null || identity().isAddress(row.makerAddress)) &&
      Number.isFinite(row.firstSeenAt) && row.firstSeenAt >= 0 && row.firstSeenAt <= row.lastReadAt && row.lastReadAt <= at + 1000 &&
      (row.estimatedTradeAt === null || Number.isFinite(row.estimatedTradeAt) && row.estimatedTradeAt <= row.lastReadAt && row.estimatedTradeAt >= 0) &&
      (row.timing === null && row.estimatedTradeAt === null || row.timing && row.timing.estimatedTradeAt === row.estimatedTradeAt && Number.isFinite(row.timing.ageObservedAt) &&
        row.timing.ageObservedAt >= row.firstSeenAt && row.timing.ageObservedAt <= row.lastReadAt && row.timing.earliestAt <= row.estimatedTradeAt && row.timing.latestAt >= row.estimatedTradeAt) &&
      Object.entries(row.totals ?? {}).every(([unit, amount]) => /^[A-Z]{2,12}$/.test(unit) &&
        (amount.status === "conflicting" ? amount.value === null : amount.status === "valid" && validAmount(amount))));
  }
  function lossFor(row, reason) {
    return {tokenKey: row.tokenKey, from: Math.min(row.timing?.earliestAt ?? row.firstSeenAt, row.firstSeenAt),
      through: Math.max(row.timing?.latestAt ?? row.firstSeenAt, row.firstSeenAt), count: 1, reason};
  }
  const mergeLoss = (a, b) => !a ? {...b} : {...a, from: Math.min(a.from, b.from), through: Math.max(a.through, b.through), count: a.count + b.count};
  function createStore({now = Date.now, maxRecords = MAX_MEMORY, retentionMs = RETENTION_MS} = {}) {
    const records = new Map(), losses = new Map();
    let globalLoss = null;
    const trim = () => {
      for (const [key, row] of records) if (row.firstSeenAt < now() - retentionMs) records.delete(key);
      if (records.size > maxRecords) for (const row of [...records.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt).slice(0, records.size - maxRecords)) {
        records.delete(eventKey(row)); losses.set(row.tokenKey, mergeLoss(losses.get(row.tokenKey), lossFor(row, "memory-record-cap")));
      }
      for (const [key, loss] of losses) if (loss.through < now() - retentionMs) losses.delete(key);
      while (losses.size > 64) { const key = losses.keys().next().value; globalLoss = mergeLoss(globalLoss, losses.get(key)); losses.delete(key); }
    };
    return {ingest(rows) {
      const changed = [];
      for (const row of rows) if (isEvent(row, now())) { const key = eventKey(row), merged = mergeEvent(records.get(key), row); records.set(key, merged); changed.push(merged); }
      trim(); return changed;
    }, rows(tokenKey) { trim(); return [...records.values()].filter(row => row.tokenKey === tokenKey); },
    status(tokenKey) { trim(); return {memoryRecords: records.size, maxMemoryRecords: maxRecords, losses: [losses.get(tokenKey), globalLoss].filter(Boolean)}; }};
  }
  function analyze(events, {now = Date.now(), seconds = 60, currency = null, basis = "auto", coverage = null, losses = []} = {}) {
    if (![60, 300, 900].includes(Number(seconds))) throw new Error("Unsupported participation window");
    if (new Set(events.map(row => row.tokenKey)).size > 1) throw new Error("Analyze one source context at a time");
    const all = mergeRows(events).filter(row => row.firstSeenAt >= now - RETENTION_MS);
    const clock = basis === "auto" ? all.some(row => row.timing) ? "approximate-trade-time" : "observation-time" : basis;
    if (!["approximate-trade-time", "observation-time"].includes(clock)) throw new Error("Unsupported timing basis");
    const start = now - seconds * 1000;
    const time = row => clock === "approximate-trade-time" ? row.estimatedTradeAt : row.firstSeenAt;
    const rows = all.filter(row => Number.isFinite(time(row)) && time(row) > start && time(row) <= now);
    const units = [...new Set(rows.flatMap(row => Object.entries(row.totals ?? {}).filter(([, total]) => total.status === "valid").map(([unit]) => unit)))].sort();
    const unit = currency ?? (units.includes("USD") ? "USD" : units[0] ?? null);
    const result = {basis: clock, seconds, currency: unit, currencies: units, events: rows.length, buys: 0, sells: 0, unknownDirection: 0,
      buyers: 0, sellers: 0, bothSides: 0, repeatBuyers: 0, repeatSellers: 0, unresolvedEvents: 0,
      volumeEvents: 0, missingVolumeEvents: 0, otherCurrencyEvents: 0, totalVolume: null, buyVolume: null, sellVolume: null,
      unknownDirectionVolume: null, unresolvedVolume: null, identifiedVolume: null,
      initialSyncEvents: rows.filter(row => row.appearance !== "newly-observed").length,
      approximateEvents: rows.filter(row => row.timing).length,
      excludedUntimed: clock === "approximate-trade-time" ? all.filter(row => !row.timing && row.firstSeenAt > start).length : 0,
      boundaryUncertain: clock === "approximate-trade-time" ? all.filter(row => row.timing && row.timing.earliestAt <= start && row.timing.latestAt > start).length : 0,
      recordingDurationMs: Number.isFinite(coverage?.recordingStartedAt) ? Math.max(0, Math.min(RETENTION_MS, now - coverage.recordingStartedAt)) : null,
      recordingCoversWindow: Number.isFinite(coverage?.recordingStartedAt) && coverage.recordingStartedAt <= start,
      partialCoverage: true, wallets: [], shares: [], losses: losses.filter(loss => loss && loss.through > start && loss.from <= now),
      restrictedEvents: rows.filter(row => row.filters?.status === "restricted" || row.hadRestrictedFilters).length,
      unknownFilterEvents: rows.filter(row => row.filters?.status === "unknown" || row.hadUnknownFilters).length};
    const wallets = new Map(); let total = 0, buyVolume = 0, sellVolume = 0, unknownVolume = 0, unidentified = 0;
    for (const row of rows) {
      const side = ["buy", "sell"].includes(row.direction) ? row.direction : "unknown";
      result[side === "buy" ? "buys" : side === "sell" ? "sells" : "unknownDirection"]++;
      const address = row.identityStatus === "resolved" && identity().isAddress(row.makerAddress) ? identity().addressKey(row.makerAddress) : null;
      if (!address) result.unresolvedEvents++;
      let wallet = address ? wallets.get(address) : null;
      if (address && !wallet) { wallet = {address, label: row.traderDisplay ?? null, buys: 0, sells: 0, unknown: 0, events: 0,
        volume: 0, buyVolume: 0, sellVolume: 0, unknownVolume: 0, volumeEvents: 0, missingVolumeEvents: 0}; wallets.set(address, wallet); }
      if (wallet) { wallet[side === "buy" ? "buys" : side === "sell" ? "sells" : "unknown"]++; wallet.events++; }
      const amount = row.totals?.[unit];
      if (amount?.status !== "valid" || !validAmount(amount)) {
        result.missingVolumeEvents++; if (Object.values(row.totals ?? {}).some(item => item.status === "valid")) result.otherCurrencyEvents++;
        if (wallet) wallet.missingVolumeEvents++; continue;
      }
      result.volumeEvents++; total += amount.value;
      if (side === "buy") buyVolume += amount.value; else if (side === "sell") sellVolume += amount.value; else unknownVolume += amount.value;
      if (!wallet) unidentified += amount.value;
      else { wallet.volumeEvents++; wallet.volume += amount.value; wallet[side === "buy" ? "buyVolume" : side === "sell" ? "sellVolume" : "unknownVolume"] += amount.value; }
    }
    result.wallets = [...wallets.values()].map(wallet => ({...wallet, volume: wallet.volumeEvents ? wallet.volume : null,
      share: wallet.volumeEvents && result.volumeEvents && total > 0 && Number.isFinite(total) ? wallet.volume / total * 100 : null})).sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || b.events - a.events);
    result.buyers = result.wallets.filter(wallet => wallet.buys > 0).length; result.sellers = result.wallets.filter(wallet => wallet.sells > 0).length;
    result.bothSides = result.wallets.filter(wallet => wallet.buys > 0 && wallet.sells > 0).length;
    result.repeatBuyers = result.wallets.filter(wallet => wallet.buys >= 2).length; result.repeatSellers = result.wallets.filter(wallet => wallet.sells >= 2).length;
    if (result.volumeEvents && Number.isFinite(total)) Object.assign(result, {totalVolume: total, buyVolume, sellVolume, unknownDirectionVolume: unknownVolume, unresolvedVolume: unidentified, identifiedVolume: total - unidentified});
    const volumeWallets = result.wallets.filter(wallet => wallet.volume !== null);
    result.shares = [1, 3, 5].map(n => ({n, percentage: total > 0 && Number.isFinite(total) && volumeWallets.length >= n ? volumeWallets.slice(0, n).reduce((sum, wallet) => sum + wallet.volume, 0) / total * 100 : null,
      reason: total <= 0 ? "No positive observed-volume denominator" : volumeWallets.length < n ? `Requires ${n} resolved addresses with observed volume` : "Includes unidentified and unknown-direction volume in the denominator"}));
    result.denominator = `All valid observed Total values in ${unit ?? "an unavailable currency"} in this ${clock} window, including unresolved addresses and unknown directions; no MC, token amount or currency conversion`;
    return result;
  }
  const api = {SOURCE, RETENTION_MS, MAX_RECORDS, MAX_MEMORY, opaqueKey, eventKey, ageTiming, sourceContext, makeEvent, mergeEvent, mergeRows, mergeCoverage, isEvent, lossFor, mergeLoss, createStore, analyze};
  globalThis.AxiomTrading = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
