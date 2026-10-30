// Concentration from one current Axiom DOM extraction, never a session cache or on-chain proof.
(() => {
  "use strict";
  const MAX_AGE_MS = 10000;
  const identity = () => globalThis.AxiomHolderTableExtractor ?? require("./holderTableExtractor.js");
  function percentage(raw) {
    const match = String(raw ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (!match) return null;
    const [whole, fraction = ""] = match[1].split(".");
    if (BigInt(whole) > 100n || (BigInt(whole) === 100n && /[1-9]/.test(fraction))) return null;
    const value = Number(match[1]);
    if (!Number.isFinite(value) || value > 100 || (value === 0 && /[1-9]/.test(match[1]))) return null;
    return {value, text: match[1]};
  }
  function sumPercentages(values) {
    if (!values.length) return 0;
    const digits = Math.max(...values.map(value => (value.text.split(".")[1] ?? "").length));
    const total = values.reduce((sum, value) => {
      const [whole, fraction = ""] = value.text.split(".");
      return sum + BigInt(whole + fraction.padEnd(digits, "0"));
    }, 0n);
    if (total > 100n * 10n ** BigInt(digits)) return null;
    const text = total.toString().padStart(digits + 1, "0");
    return Number(digits ? text.slice(0, -digits) + "." + text.slice(-digits) : text);
  }
  function supportedPool(row) {
    const c = row.classification;
    return c?.category === "pool" && c.verificationStatus === "axiom-reported" && c.source === "axiom-reported" &&
      identity().isAddress(row.walletAddress) && c.evidence?.some(item => {
        if (item.kind === "explicit-wallet-classification") return String(item.text ?? "").trim().toLowerCase() === "pool";
        const context = row.tokenContext;
        return item.kind === "pool-address-match" && context?.blockchain && !context.conflict &&
          identity().isAddress(item.address) && identity().isAddress(context.poolAddress) &&
          identity().addressKey(item.address) === identity().addressKey(row.walletAddress) &&
          identity().addressKey(context.poolAddress) === identity().addressKey(row.walletAddress);
      });
  }
  function analyze(data, {now = Date.now(), excludePools = false} = {}) {
    const rows = data?.rawRows ?? data?.rows ?? [], keyed = new Map(), unresolved = [], conflicts = new Set();
    const problems = [];
    let duplicates = 0, conflictingDuplicates = 0;
    for (const row of rows) {
      if (!identity().isAddress(row.walletAddress)) { unresolved.push(row); continue; }
      const key = identity().addressKey(row.walletAddress), old = keyed.get(key);
      if (old) {
        duplicates++;
        const classificationConflict = old.classification?.category && row.classification?.category &&
          old.classification.category !== "unknown" && row.classification.category !== "unknown" && old.classification.category !== row.classification.category;
        if (["remainingPercentage", "remainingTokenValue", "tokenQuantity"].some(field => old[field] !== row[field]) || classificationConflict) {
          conflictingDuplicates++; conflicts.add(key);
        }
      } else keyed.set(key, row);
    }
    const wallets = [...keyed.values()];
    const excluded = excludePools ? wallets.filter(row => supportedPool(row) && !conflicts.has(identity().addressKey(row.walletAddress))).map(row => ({address: row.walletAddress,
      category: "pool", reason: "Pool exclusion selected; supported by Axiom DOM evidence, not independently verified",
      source: row.classification.source, evidence: row.classification.evidence, percentage: row.remainingPercentage})) : [];
    const excludedKeys = new Set(excluded.map(item => identity().addressKey(item.address)));
    const eligible = wallets.filter(row => !excludedKeys.has(identity().addressKey(row.walletAddress)));
    if (data?.activeTable?.kind !== "holders") problems.push("The active view is not an identified Holders table.");
    if (!["available", "unsupported"].includes(data?.tableStatus)) problems.push(`Current holder rows unavailable (${data?.tableStatus ?? "no extraction"}).`);
    if (!Number.isFinite(data?.extractedAt) || now < data.extractedAt || now - data.extractedAt > MAX_AGE_MS) problems.push("Current extraction is missing or older than 10 seconds.");
    if (!data?.extractionId || !data?.context?.sourceKey || data.context.conflict || rows.some(row =>
      row.extractionId !== data.extractionId || row.observedAt !== data.extractedAt ||
      ["sourceKey", "blockchain", "mintAddress", "poolAddress", "routeAddress", "routeKey"].some(field =>
        (row.tokenContext?.[field] ?? null) !== (data.context[field] ?? null)))) problems.push("Mixed-age or unresolved token-context observations cannot form a current snapshot.");
    if (conflictingDuplicates) problems.push("Duplicate full addresses have conflicting holdings or classifications; token accounts are not aggregated.");
    const parsed = new Map(wallets.map(row => [row, percentage(row.remainingPercentage)]));
    if (wallets.some(row => !parsed.get(row))) problems.push("An identifiable wallet has a missing or invalid supply percentage.");
    if (wallets.length && wallets.every(row => parsed.get(row)) && sumPercentages([...parsed.values()]) === null) problems.push("Displayed percentages exceed 100% of Axiom's supply denominator.");
    const sort = data?.sort;
    const ranked = [...rows].sort((a, b) => rank(a) - rank(b));
    const candidates = eligible.filter(row => parsed.get(row)).sort((a, b) => parsed.get(b).value - parsed.get(a).value);
    function rank(row) {
      const match = String(row.rank ?? "").match(/^#?([1-9]\d*)[.)]?$/);
      return match ? Number(match[1]) : Infinity;
    }
    function prove(n) {
      if (sort?.source !== "aria-sort" || sort.column !== "remaining" || sort.direction !== "descending") return "Largest-holder order requires an explicit Remaining descending sort; sort is unknown or another column/direction is active.";
      if (data.unsupportedRows || data.renderedLimitReached) return "Unsupported rows or the rendered-row limit prevent establishing a complete leading set.";
      const positions = new Map(), addressesByRank = new Map();
      let last = 100;
      for (const row of ranked) {
        const p = percentage(row.remainingPercentage);
        if (!p || p.value > last) return "Displayed percentages contradict or cannot establish the advertised descending order.";
        last = p.value;
        const key = identity().isAddress(row.walletAddress) ? identity().addressKey(row.walletAddress) : null;
        if (addressesByRank.has(rank(row)) && (!key || addressesByRank.get(rank(row)) !== key)) return "Different or unresolved addresses share one displayed rank; leading order is ambiguous.";
        addressesByRank.set(rank(row), key);
        if (identity().isAddress(row.walletAddress)) {
          if (positions.has(key) && positions.get(key) !== rank(row)) return "One address occupies multiple ranks; token-account-to-owner aggregation is not established.";
          positions.set(key, rank(row));
        }
      }
      let position = 1, previous = 100, count = 0;
      const seen = new Set();
      for (const row of ranked) {
        if (!identity().isAddress(row.walletAddress)) return "A leading row has an unresolved identity.";
        const key = identity().addressKey(row.walletAddress);
        if (seen.has(key)) {
          // Identical duplicate DOM copies at the same position do not add another holding.
          if (rank(row) === position - 1) continue;
          return "The same address occupies multiple ranks; wallet aggregation is not established.";
        }
        seen.add(key);
        const p = percentage(row.remainingPercentage);
        if (rank(row) !== position++ || !p || p.value > previous) return "Leading ranks are missing, duplicated or inconsistent with descending token holdings.";
        previous = p.value;
        if (!excludedKeys.has(key)) count++;
        if (count === n) return null;
      }
      return "The current leading set is incomplete after exclusions.";
    }
    const results = [1, 5, 10].map(n => {
      let reason = problems.join(" ");
      if (!reason && candidates.length < n) reason = `Requires ${n} identifiable wallets with valid percentages after exclusions; only ${candidates.length} available.`;
      if (reason) return {n, kind: "unavailable", label: `Largest ${n} observed wallets — partial coverage`, percentage: null, reason};
      const proofFailure = prove(n);
      return {n, kind: proofFailure ? "observed" : "top", label: proofFailure ? `Largest ${n} observed wallets — partial coverage` : `Top ${n} — Axiom table order`,
        percentage: sumPercentages(candidates.slice(0, n).map(row => parsed.get(row))),
        reason: proofFailure ?? "Contiguous leading rows in Axiom's explicitly descending Remaining table; not independently verified."};
    });
    return {source: "Current Axiom DOM rows; approximate displayed percentages", denominator: "Axiom-reported supply; exact definition unavailable; unchanged by exclusions",
      observedAt: data?.extractedAt ?? null, identifiableWallets: wallets.length, unresolvedRows: unresolved.length,
      duplicateRows: duplicates, conflictingDuplicates, excluded, eligibleWallets: eligible.length, problems, results};
  }
  const api = {analyze, percentage, sumPercentages, supportedPool, MAX_AGE_MS};
  globalThis.AxiomHolderConcentration = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
