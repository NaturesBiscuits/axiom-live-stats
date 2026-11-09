// Explainable local pattern evidence. Scores are engineering heuristics, not probabilities.
(() => {
  "use strict";
  const VERSION = 1, MAX_AGE_MS = 10000, WINDOW_MS = 300000, BURST_MS = 5000, MIN_GROUP = 3, MAX_TRADE_EVENTS = 1000;
  const WEIGHTS = Object.freeze({balances: 10, bought: 15, holdings: 10, funding: 25, fundingLabels: 5,
    buyBursts: 10, sellBursts: 10, axiomFlags: 5, developerFunding: 10});
  const addresses = () => globalThis.AxiomHolderTableExtractor ?? require("./holderTableExtractor.js");
  const validAddress = value => addresses().isAddress(value);
  const keyOf = value => addresses().addressKey(value);
  const sameContext = (a, b) => Boolean(a?.sourceKey && b?.sourceKey && !a.conflict && !b.conflict &&
    ["sourceKey", "blockchain", "mintAddress", "poolAddress", "routeAddress", "routeKey"].every(key => (a[key] ?? null) === (b[key] ?? null)));
  const fresh = (at, now) => Number.isFinite(at) && at <= now && now - at <= MAX_AGE_MS;
  const pct = (n, d) => d ? n / d * 100 : null;
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const exchangeLabel = value => /^(?:binance|coinbase|kraken|okx|bybit|mexc|kucoin|bitget|gate(?:\.io)?)(?:\s|$)/i.test(clean(value));
  function amount(raw, unit = null) {
    const match = clean(raw).match(/^([$€£])?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*([KMBT])?\s*(SOL|ETH|BNB|USD|EUR|GBP|USDC|USDT)?$/);
    if (!match) return null;
    const symbol = {"$": "USD", "€": "EUR", "£": "GBP"}[match[1]], suffix = match[4]?.toUpperCase();
    const units = new Set([symbol, suffix, unit].filter(Boolean));
    if (units.size !== 1) return null;
    const [whole, fraction = ""] = match[2].replace(/,/g, "").split(".");
    const shift = ({K: 3, M: 6, B: 9, T: 12}[match[3]?.toUpperCase()] ?? 0) - fraction.length;
    let digits = (whole + fraction).replace(/^0+/, "") || "0";
    if (digits === "0") return {value: "0", unit: [...units][0], key: `0 ${[...units][0]}`};
    let value = shift >= 0 ? digits + "0".repeat(shift) : digits.padStart(1 - shift, "0");
    if (shift < 0) value = (value.slice(0, shift) + "." + value.slice(shift)).replace(/0+$/, "").replace(/\.$/, "");
    return {value, unit: [...units][0], key: `${value} ${[...units][0]}`};
  }
  function share(raw) {
    const match = clean(raw).match(/^(\d+(?:\.\d+)?)\s*%$/);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }
  function member(row, index) {
    return {ref: `${row.extractionId ?? "row"}:${index}`, address: validAddress(row.walletAddress) && row.identityStatus === "resolved" ? row.walletAddress : null,
      label: row.walletDisplay ?? null, rank: row.rank ?? null, identityStatus: row.identityStatus ?? "unresolved",
      nativeBalance: row.nativeBalance ?? row.solBalance ?? null, balanceCurrency: row.balanceCurrency ?? null,
      boughtAmount: row.boughtAmount ?? null, remainingPercentage: row.remainingPercentage ?? null,
      fundingSourceLabel: row.fundingSourceLabel ?? null, fundingSourceAddress: row.fundingSourceAddress ?? null,
      fundingTransactionUrl: row.fundingTransactionUrl ?? null, observedAt: row.observedAt ?? null};
  }
  function groupRows(rows, getter, denominator) {
    const groups = new Map();
    for (const row of rows) {
      const value = getter(row);
      if (value === null || value === undefined) continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row);
    }
    return [...groups].filter(([, entries]) => entries.length >= 2).map(([value, entries]) => ({value,
      count: entries.length, percentage: pct(entries.length, denominator), members: entries.map(row => row.member)}))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  function signal(id, label, groups, denominator, {status, reason, numerator, scoreNumerator, ...extras} = {}) {
    const refs = new Set(groups.flatMap(group => group.members.map(row => row.ref)));
    const supported = new Set(groups.filter(group => group.count >= MIN_GROUP).flatMap(group => group.members.map(row => row.ref)));
    const n = numerator ?? refs.size, scoreN = scoreNumerator ?? supported.size;
    return {id, label, status: status ?? (denominator ? "observed-partial" : "unavailable"), numerator: denominator ? n : null,
      denominator, percentage: pct(n, denominator), weight: WEIGHTS[id] ?? 0,
      contribution: denominator ? (WEIGHTS[id] ?? 0) * scoreN / denominator : 0, groups,
      reason: reason ?? "Current eligible rows; groups of 2 shown, groups of 3+ contribute to score.", ...extras};
  }
  function excluded(row, context) {
    const c = row.classification;
    return validAddress(row.walletAddress) && (validAddress(context?.poolAddress) && keyOf(context.poolAddress) === keyOf(row.walletAddress) ||
      c?.source === "axiom-reported" && c.verificationStatus === "axiom-reported" &&
      ["pool", "burn", "locker", "other-contract"].includes(c.category) && c.evidence?.some(item => item.kind === "explicit-wallet-classification" &&
        clean(item.text).toLowerCase() === {pool: "pool", burn: "burn destination", locker: "locker", "other-contract": "other known contract"}[c.category]));
  }
  function burstSignal(side, events, coverage, now) {
    // Initial table synchronization and coarse relative ages cannot establish bursts.
    const candidates = events.filter(event => event.direction === side && event.appearance === "newly-observed" &&
      event.identityStatus === "resolved" && validAddress(event.makerAddress) &&
      event.timing && Number.isFinite(event.timing.earliestAt) && Number.isFinite(event.timing.latestAt) &&
      event.timing.earliestAt > now - WINDOW_MS && event.timing.latestAt <= now &&
      event.timing.latestAt >= event.timing.earliestAt && event.timing.latestAt - event.timing.earliestAt <= BURST_MS);
    const denominator = new Set(candidates.map(event => keyOf(event.makerAddress))).size;
    const sized = [];
    for (const event of candidates) for (const [unit, total] of Object.entries(event.totals ?? {})) {
      if (total.status !== "valid") continue;
      const parsed = amount(total.displayText ?? total.rawText ?? String(total.value), unit);
      if (parsed && parsed.value !== "0") sized.push({event, value: parsed.key});
    }
    const grouped = new Map();
    for (const item of sized) {
      if (!grouped.has(item.value)) grouped.set(item.value, []);
      grouped.get(item.value).push(item.event);
    }
    const groups = [], covered = new Set();
    for (const [value, list] of grouped) {
      list.sort((a, b) => a.timing.earliestAt - b.timing.earliestAt);
      for (let first = 0; first < list.length; first++) {
        const through = list[first].timing.earliestAt + BURST_MS, wallets = new Map();
        for (let index = first; index < list.length && list[index].timing.earliestAt <= through; index++) {
          const event = list[index];
          if (event.timing.latestAt <= through) wallets.set(keyOf(event.makerAddress), event);
        }
        if (wallets.size < MIN_GROUP) continue;
        const signature = [...wallets.keys()].sort().join(",") + value;
        if (covered.has(signature)) continue;
        covered.add(signature);
        groups.push({value, count: wallets.size, percentage: pct(wallets.size, denominator),
          from: list[first].timing.earliestAt, through,
          members: [...wallets.values()].map(event => ({ref: keyOf(event.makerAddress), address: event.makerAddress,
            label: event.traderDisplay ?? null, identityStatus: "resolved", eventKey: event.eventKey,
            earliestAt: event.timing.earliestAt, latestAt: event.timing.latestAt, direction: side}))});
        // Nonoverlapping windows avoid repeatedly presenting one burst as new evidence.
        while (first + 1 < list.length && list[first + 1].timing.earliestAt <= through) first++;
      }
    }
    const restricted = coverage?.filters?.status !== "unrestricted" || candidates.some(event =>
      event.filters?.status !== "unrestricted" || event.hadRestrictedFilters || event.hadUnknownFilters);
    return signal(side === "buy" ? "buyBursts" : "sellBursts", `Similar-size ${side}s within 5s`, groups, denominator,
      {reason: "Last 5m; 3+ resolved wallets, same displayed Total/unit, complete approximate time span <=5s; excludes initial sync. Busy launches can produce this pattern.",
        filtered: restricted, sourceCoverage: coverage ?? null, excludedEvents: events.filter(event => event.direction === side).length - candidates.length});
  }
  function analyze({snapshot = null, trades = [], coverage = null, sourceTabId = null, now = Date.now()} = {}) {
    const context = snapshot?.chartContext, data = snapshot?.holdersIntelligence;
    const sourceFresh = fresh(snapshot?.marketObservedAt, now), matches = sameContext(data?.context, context) &&
      data?.tokenKey === (snapshot?.tokenKey ?? snapshot?.url);
    const usable = sourceFresh && matches && fresh(data?.extractedAt, now) && data?.extractionId &&
      data.activeTable?.kind === "holders" && ["available", "unsupported"].includes(data.tableStatus);
    const raw = usable ? data.rawRows ?? data.rows ?? [] : [], keyed = new Map(), unresolved = [], duplicateGroups = new Map(), conflicts = new Set();
    let rejected = 0, excludedRows = 0;
    for (const [index, row] of raw.entries()) {
      if (!sameContext(row.tokenContext, context) || row.extractionId !== data.extractionId || row.observedAt !== data.extractedAt) { rejected++; continue; }
      if (excluded(row, context)) { excludedRows++; continue; }
      const entry = {...row, member: member(row, index)};
      if (!entry.member.address) { unresolved.push(entry); continue; }
      const key = keyOf(entry.member.address), old = keyed.get(key);
      if (old) {
        if (!duplicateGroups.has(key)) duplicateGroups.set(key, [old]);
        duplicateGroups.get(key).push(entry);
        if (["nativeBalance", "balanceCurrency", "boughtAmount", "boughtCurrency", "remainingPercentage", "fundingSourceAddress", "fundingSourceIdentityStatus", "fundingSourceLabel", "axiomBundler"]
          .some(field => old[field] !== row[field])) conflicts.add(key);
      } else keyed.set(key, entry);
    }
    const rows = [...keyed].filter(([key]) => !conflicts.has(key)).map(([, row]) => row).concat(unresolved), signals = [];
    const balances = rows.map(row => ({...row, parsed: amount(row.nativeBalance ?? row.solBalance, row.balanceCurrency)})).filter(row => row.parsed && row.parsed.value !== "0");
    signals.push(signal("balances", "Repeated native balances", groupRows(balances, row => row.parsed.key, balances.length), balances.length));
    const bought = rows.map(row => ({...row, parsed: amount(row.boughtAmount, row.boughtCurrency)})).filter(row => row.parsed && row.parsed.value !== "0");
    signals.push(signal("bought", "Repeated Bought totals", groupRows(bought, row => row.parsed.key, bought.length), bought.length,
      {reason: "Displayed cumulative Bought totals, not individual purchase sizes; currencies stay separate."}));
    const holdings = rows.map(row => ({...row, share: share(row.remainingPercentage)})).filter(row => row.share > 0 && row.share <= 5).sort((a, b) => a.share - b.share);
    const holdingSum = rows.reduce((sum, row) => sum + (share(row.remainingPercentage) ?? 0), 0), invalidHoldingSum = holdingSum > 100 + 1e-9;
    const holdingGroups = [];
    for (let first = 0; first < holdings.length;) {
      const base = holdings[first].share; let end = first + 1;
      while (end < holdings.length && holdings[end].share <= base * 1.1 + Number.EPSILON * base) end++;
      const entries = holdings.slice(first, end);
      if (entries.length >= 2) holdingGroups.push({value: `${base}%–${entries.at(-1).share}%`, count: entries.length,
        percentage: pct(entries.length, holdings.length), combinedHoldingPercentage: invalidHoldingSum ? null : entries.reduce((sum, row) => sum + row.share, 0), members: entries.map(row => row.member)});
      first = end;
    }
    signals.push(signal("holdings", "Similar small holdings", holdingGroups, holdings.length,
      {scoreNumerator: invalidHoldingSum ? 0 : undefined,
        reason: invalidHoldingSum ? "Displayed row percentages exceed 100%; combined exposure and holdings score unavailable." :
          "Positive holdings <=5% each, max/min <=1.10 in each group; group sum uses Axiom's supply denominator. Unresolved rows may not be distinct wallets."}));
    const funded = rows.filter(row => row.fundingSourceIdentityStatus === "resolved" && validAddress(row.fundingSourceAddress));
    const fundingGroups = groupRows(funded, row => keyOf(row.fundingSourceAddress), funded.length)
      .map(group => ({...group, exchangeLabel: group.members.some(member => exchangeLabel(member.fundingSourceLabel))}));
    signals.push(signal("funding", "Shared displayed funding addresses", fundingGroups, funded.length,
      {scoreNumerator: fundingGroups.filter(group => group.count >= MIN_GROUP && !group.exchangeLabel).reduce((sum, group) => sum + group.count, 0),
        reason: "Full funding addresses exposed by Axiom; exchange-labeled groups contribute 0. Transaction direction, common ownership and pre-launch timing unverified."}));
    const labels = rows.filter(row => !validAddress(row.fundingSourceAddress) && clean(row.fundingSourceLabel) &&
      !/^(?:-|—|unknown|n\/?a)$/i.test(clean(row.fundingSourceLabel)) && !exchangeLabel(row.fundingSourceLabel));
    signals.push(signal("fundingLabels", "Repeated funding labels (weak)", groupRows(labels, row => clean(row.fundingSourceLabel), labels.length), labels.length,
      {reason: "Identical displayed labels/short addresses only; collisions possible. Common exchange labels do not contribute."}));
    const marketFresh = sourceFresh && fresh(snapshot?.tokenInfo?.developer?.observedAt ?? snapshot?.tokenInfo?.observedAt, now) &&
      snapshot?.tokenInfo?.status !== "awaiting-token";
    const developer = marketFresh && snapshot?.tokenInfo?.developer?.status === "resolved" ? snapshot.tokenInfo.developer.address : null;
    const devRows = validAddress(developer) ? funded.filter(row => !exchangeLabel(row.fundingSourceLabel) && keyOf(row.fundingSourceAddress) === keyOf(developer)) : [];
    const devGroups = devRows.length ? [{value: developer, count: devRows.length, percentage: pct(devRows.length, funded.length), members: devRows.map(row => row.member)}] : [];
    signals.push(signal("developerFunding", "Displayed developer funding match", devGroups, validAddress(developer) ? funded.length : 0,
      {reason: "Full displayed funding source matches Axiom DA; direction and token transfers need independent verification."}));
    const flagRows = rows.filter(row => typeof row.axiomBundler === "boolean");
    const flags = flagRows.filter(row => row.axiomBundler === true), flaggedGroups = flags.length ? [{value: "Axiom Bundler badge", count: flags.length,
      percentage: pct(flags.length, flagRows.length), combinedHoldingPercentage: !invalidHoldingSum && flags.every(row => share(row.remainingPercentage) !== null) ? flags.reduce((sum, row) => sum + share(row.remainingPercentage), 0) : null,
      members: flags.map(row => row.member)}] : [];
    signals.push(signal("axiomFlags", "Axiom-flagged rendered rows", flaggedGroups, flagRows.length,
      {numerator: flags.length, scoreNumerator: flags.length, reason: "Axiom's classification; observed holdings shown per group, no independent bundle verification."}));
    const tradeCandidates = sourceFresh && Number.isInteger(sourceTabId) ? trades.filter(row => row.source === "axiom-trade-dom" &&
      typeof row.eventKey === "string" && row.eventKey.length > 0 && row.sourceTabId === sourceTabId && sameContext(row.context, context) &&
      row.tokenKey === snapshot?.tradingContext?.tokenKey && row.firstSeenAt <= now && row.firstSeenAt > now - WINDOW_MS) : [];
    const tradeMap = new Map(), eventConflicts = new Set();
    for (const event of tradeCandidates) {
      const old = tradeMap.get(event.eventKey);
      if (old && (old.makerAddress !== event.makerAddress || old.direction !== event.direction)) eventConflicts.add(event.eventKey);
      else tradeMap.set(event.eventKey, event);
    }
    const uniqueTrades = [...tradeMap.values()].filter(row => !eventConflicts.has(row.eventKey)).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
    const tradeRows = uniqueTrades.slice(0, MAX_TRADE_EVENTS);
    for (const side of ["buy", "sell"]) signals.push(burstSignal(side, tradeRows, coverage, now));
    const external = sourceFresh ? share(snapshot?.stats?.bundlers) : null;
    signals.push(signal("axiomReported", "Axiom Bundlers (token-wide)", [], 0, {status: external === null ? "unavailable" : "axiom-reported",
      reason: "Axiom-reported supply percentage; separate from this local score.", reportedPercentage: external}));
    for (const [id, label, reason] of [
      ["prelaunch", "Shared funding before launch", "Requires verified funder, directed transactions and launch time; current DOM cannot establish these."],
      ["slots", "First-slot / same-slot buys", "No slot numbers or verified launch time collected."],
      ["transfers", "Developer-to-wallet token transfers", "Requires decoded, directed transfers for this token; a displayed funding link is insufficient."],
      ["relayExits", "Transfer-to-wallet then sale", "Requires verified token transfers and decoded sales; transfers alone are not sales."]
    ]) signals.push(signal(id, label, [], 0, {reason}));
    const duplicateAddresses = [...duplicateGroups].map(([address, entries]) => ({address, occurrences: entries.length,
      percentageOfRawRows: pct(entries.length, raw.length), conflicting: conflicts.has(address), members: entries.map(row => row.member)}));
    const identified = rows.filter(row => row.member.address).length, sampleFactor = rows.length ? Math.min(1, rows.length / 10) : 1;
    const tradeAvailable = signals.some(item => ["buyBursts", "sellBursts"].includes(item.id) && item.denominator > 0);
    const hasData = signals.some(item => item.weight > 0 && item.denominator > 0) || tradeAvailable;
    const rawScore = signals.reduce((sum, item) => sum + item.contribution, 0);
    const identityCap = rows.length && identified / rows.length < 0.5 ? 45 : 100;
    const score = hasData ? Math.round(Math.min(identityCap, rawScore * sampleFactor)) : null;
    return {version: VERSION, source: "Local Axiom DOM pattern heuristics", evaluatedAt: now, context: context ?? null, sourceTabId,
      status: !sourceFresh ? "stale-or-missing-source" : hasData ? "observed-partial" : "insufficient-data", score,
      scoreMeaning: "Heuristic suspicion score, not a calibrated probability or verified bundle classification",
      scoreFormula: "Sum(weight × supported ratio); size/label groups require 3+ rows. Multiply by min(current rows/10, 1) when holder rows exist; use 1 for trade-only evidence. Cap at 45 when fewer than half of rows have full wallet identities. Missing signals contribute 0; weights are not renormalized.",
      sampleFactor, identityCap, evidenceCoveragePercentage: signals.filter(item => item.denominator > 0).reduce((sum, item) => sum + item.weight, 0),
      coverage: {kind: "partial-virtualized", tableStatus: matches ? data?.tableStatus ?? "unavailable" : "context-mismatch",
        extractedAt: usable ? data.extractedAt : null, rawRows: raw.length, analyzedRows: rows.length, identifiedWallets: identified,
        unresolvedRows: unresolved.length, excludedRows, rejectedRows: rejected, conflictingWallets: conflicts.size,
        duplicateRows: [...duplicateGroups.values()].reduce((sum, entries) => sum + entries.length - 1, 0),
        tradeEvents: tradeRows.length, tradeEventsOmitted: Math.max(0, uniqueTrades.length - MAX_TRADE_EVENTS), conflictingTradeEvents: eventConflicts.size,
        totalReported: matches ? data.totalReported ?? null : null, cacheTruncated: matches ? data.cacheTruncated ?? false : false,
        renderedLimitReached: matches ? data.renderedLimitReached ?? false : false, unsupportedRows: matches ? data.unsupportedRows ?? 0 : 0},
      duplicateAddresses, signals};
  }
  const api = {VERSION, WEIGHTS, MAX_AGE_MS, WINDOW_MS, BURST_MS, MIN_GROUP, MAX_TRADE_EVENTS, amount, sameContext, analyze};
  globalThis.AxiomBundlerDetection = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
