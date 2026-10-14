// One-second DOM observations, never exchange ticks, candles or trade volume.
(() => {
  "use strict";
  const INTERVAL_MS = 1000, WINDOW_MS = 900000, MAX_SLOTS = 900, MAX_TOKENS = 4, FRESH_MS = 5000;
  const TYPES = ["price", "marketCap"];
  const SOURCE = "axiom-dom-sample";
  function parseValue(raw) {
    let text = String(raw ?? "").replace(/\s+/g, " ").trim();
    let unit = "unspecified";
    const symbol = text.match(/^([$€£])\s*/);
    if (symbol) { unit = {"$": "USD", "€": "EUR", "£": "GBP"}[symbol[1]]; text = text.slice(symbol[0].length); }
    // Axiom's 0.0₅123 means five fractional zeros before 123: 0.00000123.
    const compressed = text.match(/^0\.0\s*([₀₁₂₃₄₅₆₇₈₉]+)\s*(\d+)(.*)$/);
    if (compressed) {
      const zeros = Number([...compressed[1]].map(char => "₀₁₂₃₄₅₆₇₈₉".indexOf(char)).join(""));
      if (!Number.isSafeInteger(zeros) || zeros < 1 || zeros > 308) return null;
      text = "0." + "0".repeat(zeros) + compressed[2] + compressed[3];
    }
    const match = text.match(/^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([KMBT])?\s*(USD|EUR|GBP|SOL|BNB|ETH)?$/i);
    if (!match) return null;
    if (match[3]) {
      if (unit !== "unspecified" && unit !== match[3].toUpperCase()) return null;
      unit = match[3].toUpperCase();
    }
    const value = Number(match[1].replace(/,/g, "")) * ({K: 1e3, M: 1e6, B: 1e9, T: 1e12}[match[2]?.toUpperCase()] || 1);
    if (value === 0 && /[1-9]/.test(match[1].split(/[eE]/)[0])) return null; // Reject underflow, not a false zero price.
    return Number.isFinite(value) && value >= 0 ? {value, unit} : null;
  }
  function identity(context) {
    return {blockchain: context.blockchain ?? null, mintAddress: context.mintAddress ?? null,
      poolAddress: context.poolAddress ?? null, routeAddress: context.routeAddress ?? null};
  }
  function createStore({now = Date.now} = {}) {
    const histories = new Map();
    let current = null;
    const observations = new Map();
    function touch(history) {
      histories.delete(history.tokenKey); histories.set(history.tokenKey, history);
      while (histories.size > MAX_TOKENS) histories.delete(histories.keys().next().value);
    }
    function trim(history, at) {
      const cutoff = Math.floor(at / INTERVAL_MS) * INTERVAL_MS - WINDOW_MS;
      for (const series of Object.values(history.series)) {
        series.samples = series.samples.filter(row => row.timestamp * 1000 > cutoff).slice(-MAX_SLOTS);
      }
    }
    function record(history, valueType, unit, fields) {
      return {...fields, tokenKey: history.tokenKey, tokenIdentity: identity(history.context), valueType, unit,
        source: fields.gap ? "unobserved-slot" : SOURCE};
    }
    function ensureSeries(valueType, unit) {
      let series = current.series[valueType];
      if (!series || series.unit !== unit) {
        // Currency changes start a separate series; never splice different units together.
        series = current.series[valueType] = {unit, samples: []};
      }
      return series;
    }
    function snapshot(at = now()) {
      const output = [];
      for (const history of histories.values()) { trim(history, at); output.push(history); }
      return output;
    }
    function merge(packet, receivedAt = now()) {
      if (typeof packet?.tokenKey !== "string" || !packet.tokenKey || packet.tokenKey.length > 2048 ||
          packet.context?.sourceKey !== packet.tokenKey || !Number.isFinite(packet.sentAt)) return false;
      let history = histories.get(packet.tokenKey);
      if (!history) history = {tokenKey: packet.tokenKey, context: packet.context, series: {}, lastReceivedAt: null};
      let accepted = false;
      for (const type of TYPES) {
        const incoming = packet.series?.[type];
        if (!incoming || typeof incoming.unit !== "string" || incoming.unit.length > 24 || !Array.isArray(incoming.samples)) continue;
        let series = history.series[type];
        const latestIncoming = incoming.samples.at(-1)?.timestamp ?? -Infinity;
        if (series && latestIncoming < (series.samples.at(-1)?.timestamp ?? -Infinity)) continue;
        if (!series || series.unit !== incoming.unit) series = history.series[type] = {unit: incoming.unit, samples: []};
        const byTime = new Map(series.samples.map(row => [row.timestamp, row]));
        for (const row of incoming.samples.slice(-MAX_SLOTS)) {
          if (!row || !Number.isSafeInteger(row.timestamp) || row.timestamp < 0 || row.timestamp * 1000 > receivedAt + 1000 ||
              (row.value !== null && (!Number.isFinite(row.value) || row.value < 0)) ||
              typeof row.stale !== "boolean" || typeof row.gap !== "boolean" ||
              ((row.stale || row.gap) && row.value !== null)) continue;
          const previous = byTime.get(row.timestamp);
          if (previous && (previous.sampledAt ?? 0) > (row.sampledAt ?? 0)) continue;
          byTime.set(row.timestamp, record(history, type, incoming.unit, {...row,
            deliveredAt: row.deliveredAt ?? null}));
          accepted = true;
        }
        const sorted = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp);
        const end = sorted.at(-1)?.timestamp;
        series.samples = [];
        // A new content-script instance may not know the previous source's last slot.
        // Missing deliveries are explicitly null even across navigation/restarts.
        for (let slot = Math.max(sorted[0]?.timestamp ?? 0, end - MAX_SLOTS + 1); slot <= end; slot++) {
          series.samples.push(byTime.get(slot) ?? record(history, type, incoming.unit, {timestamp: slot,
            value: null, observedAt: null, sourceAgeMs: null, sampledAt: null, samplingDelayMs: null,
            sourceHidden: null, stale: true, gap: true, sourceFreshness: "gap", reason: "no-sample-received"}));
        }
      }
      if (!accepted) return false;
      history.lastReceivedAt = receivedAt;
      history.restored = false;
      trim(history, receivedAt); touch(history);
      return true;
    }
    return {
      setToken(context) {
        if (!context?.sourceKey) { current = null; observations.clear(); return; }
        if (current?.tokenKey === context.sourceKey) { current.context = context; return; }
        observations.clear();
        current = histories.get(context.sourceKey) ?? {tokenKey: context.sourceKey, context, series: {}, lastReceivedAt: null};
        current.context = context; trim(current, now()); touch(current);
      },
      observe(valueType, parsed, observedAt = now(), details = {}) {
        if (!current || !TYPES.includes(valueType)) return;
        if (!parsed || !Number.isFinite(parsed.value) || parsed.value < 0 || !Number.isFinite(observedAt)) {
          const previous = observations.get(valueType);
          observations.set(valueType, {value: null, readValid: false, domReadAt: observedAt,
            lastValidValue: previous?.lastValidValue ?? previous?.value, lastValidUnit: previous?.lastValidUnit ?? previous?.unit,
            valueChangedAt: previous?.valueChangedAt ?? null, domUpdatedAt: previous?.domUpdatedAt ?? null});
          return;
        }
        ensureSeries(valueType, parsed.unit);
        const previous = observations.get(valueType);
        const changed = !previous || previous.lastValidValue !== parsed.value || previous.lastValidUnit !== parsed.unit;
        observations.set(valueType, {...parsed, observedAt, domReadAt: observedAt, readValid: true,
          lastValidValue: parsed.value, lastValidUnit: parsed.unit,
          valueChangedAt: changed ? observedAt : previous.valueChangedAt,
          domUpdatedAt: details.domUpdatedAt ?? previous?.domUpdatedAt ?? null,
          displayText: details.displayText ?? previous?.displayText ?? null,
          readReason: details.readReason ?? "dom-read"});
      },
      invalidate(valueType) { observations.delete(valueType); },
      tick(at = now(), sourceHidden = false) {
        if (!current) return null;
        const t = Math.floor(at / INTERVAL_MS) * INTERVAL_MS;
        const delta = {};
        for (const type of TYPES) {
          const series = current.series[type];
          if (!series) continue;
          const previous = series.samples.at(-1);
          if (previous && previous.timestamp * 1000 >= t) continue;
          const rows = [];
          // Only missed slots inside the rolling window; never replay a fresh value backwards.
          for (let slot = Math.max((previous?.timestamp ?? t / 1000 - 1) * 1000 + INTERVAL_MS,
            t - WINDOW_MS + INTERVAL_MS); slot < t; slot += INTERVAL_MS) {
            rows.push(record(current, type, series.unit, {timestamp: slot / 1000, value: null,
              observedAt: null, sourceAgeMs: null, sampledAt: null, samplingDelayMs: null,
              sourceHidden, stale: true, gap: true, sourceFreshness: "gap", reason: "missed-sample"}));
          }
          const latest = observations.get(type);
          const age = latest?.readValid ? at - latest.domReadAt : null;
          const fresh = age !== null && age >= 0 && age <= FRESH_MS;
          const delay = Math.max(at - t, previous?.sampledAt ? at - previous.sampledAt - INTERVAL_MS : 0);
          rows.push(record(current, type, series.unit, {timestamp: t / 1000,
            value: fresh ? latest.value : null, observedAt: latest?.readValid ? latest.domReadAt : null,
            domReadAt: latest?.domReadAt ?? null, valueChangedAt: latest?.valueChangedAt ?? null,
            domUpdatedAt: latest?.domUpdatedAt ?? null, deliveredAt: null, readReason: latest?.readReason ?? null,
            displayText: latest?.displayText ?? null,
            sourceAgeMs: age, sampledAt: at, samplingDelayMs: delay, sourceHidden,
            stale: !fresh, gap: false, sourceFreshness: fresh ? "fresh" : latest?.readValid ? "stale" : "missing",
            reason: fresh ? "observed-dom-value" : latest?.readValid ? "no-recent-dom-read" : "value-unavailable"}));
          series.samples = [...series.samples, ...rows].slice(-MAX_SLOTS);
          delta[type] = {unit: series.unit, samples: rows};
        }
        trim(current, at);
        if (!Object.keys(delta).length) return null;
        current.lastReceivedAt = at; touch(current);
        return {tokenKey: current.tokenKey, context: current.context, series: delta, sentAt: at};
      },
      merge,
      snapshot,
      get(tokenKey, at = now()) {
        const history = histories.get(tokenKey);
        if (history) trim(history, at);
        return history ?? null;
      },
      serialize(at = now()) {
        // Identity/units are stored once per series, not repeated 900 times on disk.
        return snapshot(at).map(history => ({...history, series: Object.fromEntries(Object.entries(history.series)
          .map(([type, series]) => [type, {...series, samples: series.samples.map(row => {
            const {tokenKey, tokenIdentity, valueType, unit, source, ...fields} = row; return fields;
          })}]))}));
      },
      restore(saved, at = now()) {
        for (const history of (Array.isArray(saved) ? saved : []).slice(-MAX_TOKENS)) {
          if (typeof history?.tokenKey !== "string") continue;
          merge({...history, sentAt: at}, at);
          const restored = histories.get(history.tokenKey);
          if (restored) { restored.lastReceivedAt = history.lastReceivedAt ?? null; restored.restored = true; }
        }
        // Historical samples never seed a live observation or pretend the source reconnected.
      }
    };
  }
  const fields = ["timestamp", "tokenKey", "blockchain", "mintAddress", "poolAddress", "routeAddress", "valueType", "unit",
    "value", "source", "sourceFreshness", "observedAt", "domReadAt", "valueChangedAt", "domUpdatedAt", "sampledAt", "deliveredAt",
    "sourceAgeMs", "samplingDelayMs", "deliveryDelayMs", "displayText", "readReason", "sourceHidden", "stale", "gap", "reason"];
  function records(series) { return (series?.samples ?? []).map(row => ({...row, ...row.tokenIdentity, tokenIdentity: undefined})); }
  function toJSONL(series) { return records(series).map(row => JSON.stringify(row)).join("\n"); }
  function toCSV(series) {
    const escape = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [fields.join(","), ...records(series).map(row => fields.map(field => escape(row[field])).join(","))].join("\r\n");
  }
  const api = {createStore, parseValue, toJSONL, toCSV, INTERVAL_MS, WINDOW_MS, MAX_SLOTS, MAX_TOKENS, FRESH_MS, SOURCE};
  globalThis.AxiomRollingChart = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
