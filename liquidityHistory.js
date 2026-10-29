// Actual five-second DOM attempts. No snapshot timestamps, backfill or API data.
(() => {
  "use strict";
  const CADENCE_MS = 5000, TOLERANCE_MS = 2500, GAP_MS = 7500;
  const RETENTION_HOURS = 24, MAX_RECORDS = 10000, MAX_SERIES = 8;
  const SOURCE = "axiom-liquidity-dom";
  const parser = raw => (globalThis.AxiomRollingChart ?? require("./rollingChartCollector.js")).parseValue(raw);
  function parseAmount(raw) {
    const displayText = raw == null ? null : String(raw);
    const parsed = parser(displayText);
    const text = displayText?.trim() ?? "";
    // Shift the decimal exponent directly to avoid artifacts such as 1.001 * 1000.
    const scaled = text.replace(/^[$€£]\s*/, "").replace(/\s*(USD|EUR|GBP|SOL|ETH|BNB)$/i, "")
      .match(/^((?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([KMBT])$/i);
    if (parsed && scaled) {
      const [coefficient, exponent = "0"] = scaled[1].replace(/,/g, "").toLowerCase().split("e");
      parsed.value = Number(`${coefficient}e${Number(exponent) + {K: 3, M: 6, B: 9, T: 12}[scaled[2].toUpperCase()]}`);
    }
    const currency = text.match(/(?:^|\s)(USD|EUR|GBP|SOL|ETH|BNB)\s*$/i)?.[1]?.toUpperCase();
    const unit = parsed?.unit ?? ({"$": "USD", "€": "EUR", "£": "GBP"}[text[0]] ?? currency ?? "unspecified");
    return {displayText, unit, value: parsed?.value ?? null,
      status: parsed ? "valid" : !text || /^(?:—|--?|N\/?A)$/i.test(text) ? "missing" : "invalid"};
  }
  function createRecorder({now = Date.now, sessionId = globalThis.crypto?.randomUUID?.() ?? String(Math.random())} = {}) {
    let context = null, inputKey = null, epoch = 0, nextDue = 0;
    return {
      setContext(next) {
        if (!next?.sourceKey) return;
        if (next.sourceKey === inputKey) return;
        inputKey = next.sourceKey; epoch++; nextDue = 0;
        const resolved = !next.conflict && next.blockchain && next.mintAddress && next.poolAddress;
        const identityStatus = next.conflict ? "conflict" : resolved ? "resolved" : "unresolved";
        // Unknown pools are scoped to this uninterrupted page/context session, never guessed.
        context = {...next, identityStatus, tokenKey: JSON.stringify(["liquidity-v1", next.sourceKey,
          resolved ? null : `${sessionId}:${epoch}`])};
      },
      context: () => context,
      delay: (at = now()) => context ? Math.max(50, nextDue - at) : CADENCE_MS,
      sample(read, at = now(), sourceHidden = false) {
        if (!context || at < nextDue) return null;
        nextDue = at + CADENCE_MS;
        const attempt = read(); // Must execute a fresh bounded DOM read for this attempt.
        const amount = parseAmount(attempt?.displayText);
        const status = context.conflict ? "identity-conflict" : attempt?.status === "awaiting-token" ? "awaiting-token" : amount.status;
        return {...amount, status, value: status === "valid" ? amount.value : null,
          tokenKey: context.tokenKey, tokenIdentity: {...context}, valueType: "liquidity", source: SOURCE,
          timestamp: Math.floor(at / 1000), sampledAt: at, domReadAt: attempt?.domReadAt ?? at,
          observedAt: status === "valid" ? attempt?.domReadAt ?? at : null, sourceHidden, gap: false};
      }
    };
  }
  const valid = row => row?.status === "valid" && Number.isFinite(row.value) && row.value >= 0;
  const percent = (first, last) => {
    const result = first > 0 ? (last / first - 1) * 100 : null;
    return Number.isFinite(result) ? result : null;
  };
  const seriesKey = row => JSON.stringify([row.tokenKey, row.unit]);
  function isAttempt(row, at = Date.now()) {
    return row?.source === SOURCE && row.valueType === "liquidity" && typeof row.tokenKey === "string" && row.tokenKey.length <= 4096 &&
      typeof row.unit === "string" && row.unit.length <= 24 && Number.isSafeInteger(row.timestamp) && row.timestamp >= 0 &&
      Number.isFinite(row.sampledAt) && row.sampledAt >= 0 && row.sampledAt <= at + 1000 &&
      row.timestamp === Math.floor(row.sampledAt / 1000) && Number.isFinite(row.domReadAt) &&
      Math.abs(row.domReadAt - row.sampledAt) <= 1000 &&
      ["valid", "missing", "invalid", "awaiting-token", "identity-conflict"].includes(row.status) &&
      ["resolved", "unresolved", "conflict"].includes(row.tokenIdentity?.identityStatus) &&
      (row.displayText === null || typeof row.displayText === "string") &&
      (row.status === "valid" ? valid(row) && row.observedAt === row.domReadAt : row.value === null && row.observedAt === null);
  }
  function mergeRows(...collections) {
    const rows = new Map();
    for (const list of collections) for (const row of list ?? []) {
      const key = JSON.stringify([row.tokenKey, row.unit, row.timestamp]), old = rows.get(key);
      if (!old || row.sampledAt >= old.sampledAt) rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => a.sampledAt - b.sampledAt);
  }
  function analyze(attempts) {
    if (new Set(attempts.map(seriesKey)).size > 1) throw new Error("Analyze one token/pool/currency series at a time.");
    const rows = mergeRows(attempts), observations = rows.filter(valid), first = observations[0], latest = observations.at(-1);
    const durationMs = first && latest ? latest.domReadAt - first.domReadAt : 0;
    // Coverage counts occupied expected-cadence slots, never manufactured observations.
    const start = rows[0]?.sampledAt;
    const expected = start === undefined ? 0 : Math.floor((rows.at(-1).sampledAt - start) / CADENCE_MS) + 1;
    const occupied = new Set(observations.map(row => Math.floor((row.sampledAt - start) / CADENCE_MS))).size;
    const windows = {};
    for (const seconds of [30, 60, 300, 900]) {
      const target = latest ? latest.domReadAt - seconds * 1000 : null;
      const baseline = observations.filter(row => row !== latest && Math.abs(row.domReadAt - target) <= TOLERANCE_MS)
        .sort((a, b) => Math.abs(a.domReadAt - target) - Math.abs(b.domReadAt - target))[0];
      const complete = durationMs >= seconds * 1000; // A short recording never claims a complete window.
      const change = complete && baseline && latest ? percent(baseline.value, latest.value) : null;
      windows[seconds] = {change, baseline: complete ? baseline ?? null : null,
        status: !complete ? "Collecting history" : !baseline || change === null ? "Insufficient data" : "available"};
    }
    return {first, latest, lastAttempt: rows.at(-1), observations: observations.length, attempts: rows.length,
      durationMs, coverage: expected > 0 ? Math.min(1, occupied / expected) : 0, expected,
      sinceStart: first && latest ? percent(first.value, latest.value) : null, windows};
  }
  function segments(rows) {
    const groups = []; let group = null;
    for (const row of rows) {
      if (!valid(row)) { group = null; continue; }
      if (!group || row.sampledAt - group.at(-1).sampledAt > GAP_MS || seriesKey(row) !== seriesKey(group.at(-1))) {
        group = []; groups.push(group);
      }
      group.push(row);
    }
    return groups;
  }
  const api = {createRecorder, parseAmount, analyze, segments, mergeRows, seriesKey, valid, isAttempt,
    CADENCE_MS, TOLERANCE_MS, GAP_MS, RETENTION_HOURS, MAX_RECORDS, MAX_SERIES, SOURCE};
  globalThis.AxiomLiquidityHistory = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
