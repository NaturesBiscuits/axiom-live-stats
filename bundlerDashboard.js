(() => {
  "use strict";
  const D = AxiomBundlerDetection, node = id => document.getElementById(id);
  let snapshot = null, sourceTabId = null, result = null, selection = "", generation = 0, pending = false, requestedAt = 0;
  const scope = context => JSON.stringify([context?.sourceKey, context?.blockchain, context?.mintAddress, context?.poolAddress, context?.conflict]);
  const percent = value => Number.isFinite(value) ? `${Number(value.toFixed(2))}%` : "Unavailable";
  const time = value => Number.isFinite(value) ? new Date(value).toISOString() : "Unavailable";
  function element(tag, text, className) {
    const item = document.createElement(tag); item.textContent = text ?? "Unavailable";
    if (className) item.className = className;
    return item;
  }
  function render() {
    if (!node("bundlerScore")) return;
    node("bundlerScore").textContent = percent(result?.score);
    node("bundlerEvidenceCoverage").textContent = result?.score === null || !result ? "Unavailable" : percent(result.evidenceCoveragePercentage);
    node("bundlerAxiomReported").textContent = percent(result?.signals.find(signal => signal.id === "axiomReported")?.reportedPercentage);
    const c = result?.coverage;
    node("bundlerStatus").textContent = !result ? "Open Axiom's Holders tab to analyze current rows." :
      result.status === "stale-or-missing-source" ? "Source stale or missing · waiting for fresh Axiom observations." :
      result.status === "insufficient-data" ? "Insufficient current evidence · open the Holders tab or collect fresh trade observations." :
      `Partial observed evidence · ${c.analyzedRows} rows · ${c.identifiedWallets} full wallet identities · ${c.unresolvedRows} unresolved rows`;
    node("bundlerCoverage").textContent = !c ? "" :
      `Holder observation: ${time(c.extractedAt)} · table ${c.tableStatus} · ${c.duplicateRows} duplicate rows · ${c.conflictingWallets} conflicting wallets · ` +
      `${c.excludedRows} supported pool/contract exclusions · ${c.rejectedRows} rejected observations · ${c.unsupportedRows} unsupported rows` +
      `${c.renderedLimitReached ? " · rendered limit reached" : ""}${c.cacheTruncated ? " · session cache truncated" : ""}. ` +
      `${c.tradeEvents} trade events analyzed · ${c.tradeEventsOmitted} omitted by analysis cap · ${c.conflictingTradeEvents} conflicting trade events. ` +
      `Reported holders: ${c.totalReported ?? "unavailable"}. Partial coverage; no full-token wallet coverage percentage is inferred.`;
    const rows = document.createDocumentFragment();
    for (const signal of result?.signals ?? []) {
      const tr = document.createElement("tr");
      const displayed = signal.id === "axiomReported" ? signal.reportedPercentage : signal.percentage;
      tr.append(element("td", signal.label), element("td", percent(displayed)),
        element("td", signal.denominator ? `${signal.numerator} / ${signal.denominator}` : "Unavailable"),
        element("td", signal.weight ? `${Number(signal.contribution.toFixed(2))} / ${signal.weight} pts` : "Context only"),
        element("td", `${signal.reason}${signal.filtered ? " · Trade filters restricted or unknown." : ""}`));
      rows.append(tr);
    }
    node("bundlerSignals").replaceChildren(rows);
    const openGroups = new Set([...node("bundlerGroups").querySelectorAll("details[open]")].map(item => item.dataset.groupKey));
    const groups = document.createDocumentFragment();
    for (const signal of result?.signals ?? []) for (const group of signal.groups) {
      const details = document.createElement("details"); details.className = "bundler-group";
      details.dataset.groupKey = JSON.stringify([signal.id, group.value, group.from ?? null]);
      details.open = openGroups.has(details.dataset.groupKey);
      details.append(element("summary", `${signal.label} · ${group.value} · ${group.count} rows/wallets · ${percent(group.percentage)}`));
      if (group.combinedHoldingPercentage != null) details.append(element("p", `Combined displayed holdings: ${percent(group.combinedHoldingPercentage)} of Axiom's supply denominator · row sum; unresolved independence unverified`, "card-note"));
      if (group.from != null) details.append(element("p", `Approximate time range ${time(group.from)} to ${time(group.through)}`, "card-note"));
      if (group.exchangeLabel) details.append(element("p", "Exchange label present · context only · contributes 0 points.", "card-note"));
      const list = document.createElement("ul");
      for (const member of group.members) list.append(element("li",
        `${member.address ?? member.label ?? "Unresolved wallet"}${member.address && member.label ? ` (${member.label})` : ""}` +
        ` · ${member.identityStatus}${member.rank ? ` · rank ${member.rank}` : ""}` +
        `${member.nativeBalance != null ? ` · balance ${member.nativeBalance} ${member.balanceCurrency ?? "unit unknown"}` : ""}` +
        `${member.boughtAmount != null ? ` · Bought ${member.boughtAmount}` : ""}` +
        `${member.remainingPercentage != null ? ` · Remaining ${member.remainingPercentage}` : ""}` +
        `${member.fundingSourceAddress || member.fundingSourceLabel ? ` · Funding ${member.fundingSourceAddress ?? member.fundingSourceLabel}` : ""}` +
        `${member.fundingTransactionUrl ? ` · ${member.fundingTransactionUrl}` : ""}` +
        `${member.eventKey ? ` · event ${member.eventKey}` : ""}`));
      details.append(list); groups.append(details);
    }
    if (!groups.childNodes.length) groups.append(element("p", "No matching groups in the current eligible observations.", "card-note"));
    node("bundlerGroups").replaceChildren(groups);
    const duplicates = document.createDocumentFragment();
    for (const entry of result?.duplicateAddresses ?? []) duplicates.append(element("p",
      `${entry.address} · ${entry.occurrences} DOM occurrences · ${percent(entry.percentageOfRawRows)} of raw rows · ${entry.conflicting ? "conflicting values; excluded" : "counted once"}`, "wallet-address"));
    if (!duplicates.childNodes.length) duplicates.append(element("p", "No repeated full wallet addresses in the current extraction. Shortened names are not deduplicated.", "card-note"));
    node("bundlerDuplicates").replaceChildren(duplicates);
    node("bundlerMethod").textContent = result?.scoreFormula ?? "Waiting for current observations.";
  }
  function refresh() {
    if (!snapshot) { render(); return; }
    if (Date.now() - snapshot.marketObservedAt > D.MAX_AGE_MS || Date.now() - (result?.evaluatedAt ?? 0) > D.MAX_AGE_MS) {
      result = D.analyze({snapshot, sourceTabId}); render();
    }
    if (pending || !Number.isInteger(sourceTabId) || Date.now() - requestedAt < 2500) return;
    pending = true; requestedAt = Date.now(); const current = generation;
    chrome.runtime.sendMessage({type: "AXIOM_BUNDLER_GET", sourceTabId, scope: scope(snapshot.chartContext)}, response => {
      const error = chrome.runtime.lastError;
      if (current !== generation) return;
      pending = false;
      if (error || !response?.ok || !D.sameContext(response.result?.context, snapshot.chartContext) || response.result.sourceTabId !== sourceTabId) return;
      result = response.result; render();
    });
  }
  globalThis.AxiomBundlerUI = Object.freeze({setSnapshot(next, tab) {
    const nextSelection = `${tab}:${scope(next.chartContext)}`;
    if (nextSelection !== selection) { selection = nextSelection; generation++; pending = false; requestedAt = 0; }
    snapshot = next; sourceTabId = tab;
    result = D.analyze({snapshot, sourceTabId}); render(); refresh();
  }, inspect: () => result});
  setInterval(refresh, 1000);
  render();
})();
