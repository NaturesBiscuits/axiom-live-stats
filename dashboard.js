"use strict";
const fields = [
  "globalFees", "price", "liquidity", "supply", "ath",
  "volume5m", "buys", "sells", "netVolume", "holders", "bundlers", "top10Holders"
];
let lastSeenAt = null;
let lastHolderFingerprint = "";
let currentHolderData = null;
const holderTime = at => Number.isFinite(at) ? new Date(at).toISOString() : "Unavailable";

function renderConcentration() {
  const data = currentHolderData;
  const result = AxiomHolderConcentration.analyze(data, {excludePools: document.getElementById("excludeHolderPools").checked});
  const context = data?.context;
  const sort = data?.sort?.column ? `${data.sort.label} · ${data.sort.direction} (${data.sort.source})` : "Sort order unknown";
  document.getElementById("concentrationContext").textContent = `${result.source} · observed ${holderTime(result.observedAt)} · ` +
    `${context?.blockchain ?? "Network unresolved"} · mint ${context?.mintAddress ?? "unresolved"} · route hint ${context?.routeAddress ?? context?.routeKey ?? "unresolved"} · ` +
    `view ${data?.activeTable?.kind ?? "unknown"} · ${sort}`;
  document.getElementById("concentrationCoverage").textContent = `${result.identifiableWallets} current identifiable wallets · ${result.unresolvedRows} unresolved rows · ` +
    `${result.duplicateRows} duplicate DOM rows · ${data?.unsupportedRows ?? 0} unsupported · partial virtualized coverage. ` +
    `Separate session cache: ${data?.observedHolders ?? 0}/${data?.cacheLimit ?? 1000} retained identities${data?.cacheTruncated ? " · truncated" : ""}; ` +
    `observations ${holderTime(data?.sessionOldestObservedAt)} to ${holderTime(data?.sessionNewestObservedAt)}. Matching the reported count does not establish completeness.`;
  const fragment = document.createDocumentFragment();
  for (const entry of result.results) {
    const card = document.createElement("article"); card.className = "card";
    const label = document.createElement("div"); label.className = "label"; label.textContent = entry.label;
    const amount = document.createElement("div"); amount.className = "value";
    amount.textContent = entry.percentage === null ? "Unavailable" : `≈ ${Number(entry.percentage.toPrecision(12))}%`;
    const reason = document.createElement("p"); reason.className = "card-note"; reason.textContent = entry.reason;
    card.append(label, amount, reason); fragment.appendChild(card);
  }
  document.getElementById("concentrationResults").replaceChildren(fragment);
  document.getElementById("concentrationDenominator").textContent = `Percentage denominator: ${result.denominator}. Excluded addresses: ${result.excluded.length}.`;
  const excluded = document.getElementById("concentrationExcluded");
  excluded.replaceChildren(...result.excluded.map(entry => {
    const item = document.createElement("li");
    const evidence = entry.evidence.map(item => item.kind === "pool-address-match" ? `Axiom pool address ${item.address}` : `Axiom classification: ${item.text}`).join("; ");
    item.textContent = `${entry.address} · ${entry.percentage} · ${entry.reason} · source ${entry.source} · ${evidence}`;
    return item;
  }));
}

function cell(text, className) {
  const node = document.createElement("td");
  node.textContent = text ?? "—";
  if (className) node.className = className;
  return node;
}

function secondary(node, text, className = "cell-secondary") {
  const detail = document.createElement("span");
  detail.className = className;
  detail.textContent = text;
  node.appendChild(detail);
}

function renderHolders(snapshot) {
  const candidate = snapshot.holdersIntelligence;
  const contextMatches = !snapshot.chartContext?.sourceKey || ["sourceKey", "blockchain", "mintAddress", "poolAddress", "routeAddress", "routeKey"]
    .every(field => (candidate?.context?.[field] ?? null) === (snapshot.chartContext[field] ?? null));
  const data = candidate?.tokenKey === (snapshot.tokenKey || snapshot.url) && contextMatches ? candidate : null;
  currentHolderData = data;
  renderConcentration();
  const fingerprint = JSON.stringify({url: snapshot.url, reported: snapshot.stats.holders, data}, (key, value) =>
    ["observedAt", "extractedAt", "extractionId", "rawRows", "sessionOldestObservedAt", "sessionNewestObservedAt"].includes(key) ? undefined : value);
  if (fingerprint === lastHolderFingerprint) return;
  lastHolderFingerprint = fingerprint;
  document.getElementById("holderTotal").textContent = data?.totalReported?.toLocaleString() ?? snapshot.stats.holders ?? "—";
  const available = data && ["available", "empty", "unsupported"].includes(data.tableStatus);
  document.getElementById("holderRendered").textContent = available ? data.renderedHolders.toLocaleString() : "—";
  document.getElementById("holderBundlers").textContent = available ? data.renderedBundlers.toLocaleString() : "—";
  document.getElementById("holderObserved").textContent = data ? `${data.observedHolders.toLocaleString()} resolved` : "—";
  document.getElementById("holderObservedNote").textContent = data ?
    `${data.unresolvedRendered} current unresolved; unique session total unavailable.${data.cacheTruncated ? ` Cache limited to ${data.cacheLimit.toLocaleString()} identities.` : ""}` :
    "Full-address identities only";
  document.getElementById("holderCoverage").textContent = available ? "Partial" : "Unavailable";
  const messages = {
    available: "Only currently rendered rows are shown. Scrolling Axiom manually changes the rows observed here.",
    unavailable: "Holders table not loaded. Open the Holders tab on Axiom.",
    hidden: "Holders table is hidden or collapsed. Open the Holders tab on Axiom.",
    empty: "Holders table is present, but no holder rows are currently rendered.",
    unsupported: "Some rendered rows could not be read. Axiom's row layout needs further HTML inspection.",
    "awaiting-token": "Waiting for the Holders table to update for the selected token.",
    "other-view": "Top Traders or another view is active. Open Holders to calculate holder concentration.",
    "unknown-view": "The active table cannot be identified as Holders.",
    inactive: "Waiting for a loaded Axiom token page."
  };
  const status = messages[data?.tableStatus] || "Open a token's Holders tab on Axiom.";
  document.getElementById("holderTableStatus").textContent = status;
  document.getElementById("holderCoverageNote").textContent = available ?
    (data.renderedLimitReached ? "Rendered-row safety limit reached" : "Virtualized list · No overall Bundler % calculated") : status;

  const currencies = new Set((data?.rows ?? []).map(holder => holder.balanceCurrency).filter(Boolean));
  const balanceCurrency = data?.balanceCurrency || (currencies.size === 1 ? [...currencies][0] : null);
  document.getElementById("holderBalanceHeader").textContent = balanceCurrency ? `${balanceCurrency} balance` : "Native balance";
  const showFees = Boolean(data?.hasFeesPaid || data?.rows?.some(holder => holder.feesPaid != null));
  document.getElementById("holderFeesHeader").hidden = !showFees;
  const amountText = (amount, unit) => amount == null ? null :
    unit && !String(amount).includes(unit) ? `${amount} ${unit}` : amount;

  const body = document.getElementById("holderRows");
  const fragment = document.createDocumentFragment();
  for (const holder of data?.rows ?? []) {
    const row = document.createElement("tr");
    row.appendChild(cell(holder.rank));
    const wallet = cell(holder.walletDisplay, "wallet-cell");
    secondary(wallet, holder.walletAddress || (holder.identityStatus === "conflicting" ? "Conflicting address hints · identity unresolved" : "Identity unresolved"), holder.walletAddress ? "cell-secondary wallet-address" : "cell-secondary unresolved");
    const classification = holder.classification;
    const classLabel = {pool: "Pool", burn: "Burn destination", locker: "Locker", "other-contract": "Other known contract"}[classification?.category];
    secondary(wallet, classLabel ? `${classLabel} · Axiom-reported hint · not independently verified` : "Classification unknown · not independently verified");
    row.appendChild(wallet);
    const balance = Object.hasOwn(holder, "nativeBalance") ? holder.nativeBalance : holder.solBalance;
    row.appendChild(cell(amountText(balance, holder.balanceCurrency)));
    row.appendChild(cell(holder.lastActive));
    const bought = cell(holder.boughtAmount);
    secondary(bought, holder.buyCount === null ? "Buys: unavailable" : `${holder.buyCount} buys`);
    row.appendChild(bought);
    const sold = cell(holder.soldAmount);
    secondary(sold, holder.sellCount === null ? "Sells: unavailable" : `${holder.sellCount} sells`);
    row.appendChild(sold);
    row.appendChild(cell(holder.unrealizedPnl));
    if (showFees) row.appendChild(cell(amountText(holder.feesPaid, holder.feesPaidCurrency)));
    const remaining = cell(holder.remainingTokenValue);
    secondary(remaining, holder.remainingPercentage ?? "% unavailable");
    if (holder.tokenQuantity != null) secondary(remaining, `${holder.tokenQuantity} tokens · explicit DOM quantity`);
    row.appendChild(remaining);
    const funding = cell(holder.fundingSourceLabel);
    if (holder.fundingTransactionUrl) {
      try {
        const url = new URL(holder.fundingTransactionUrl);
        if (url.protocol === "https:") {
          const link = document.createElement("a");
          link.href = url.href;
          link.textContent = "Funding transaction ↗";
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.className = "cell-secondary";
          funding.appendChild(link);
        }
      } catch { /* No safe funding link. */ }
    }
    row.appendChild(funding);
    row.appendChild(cell(holder.holdingDuration));
    const flag = cell(null);
    flag.textContent = "";
    secondary(flag, holder.axiomBundler ? "Axiom flagged" : "Not flagged in row", holder.axiomBundler ? "bundler-badge" : "cell-secondary");
    row.appendChild(flag);
    fragment.appendChild(row);
  }
  if (!fragment.childNodes.length) {
    const row = document.createElement("tr");
    const empty = cell(status, "empty-holders");
    empty.colSpan = showFees ? 12 : 11;
    row.appendChild(empty);
    fragment.appendChild(row);
  }
  body.replaceChildren(fragment);
}

function render(snapshot) {
  if (!snapshot?.stats) return;
  lastSeenAt = snapshot.capturedAt || Date.now();
  document.getElementById("tokenTitle").textContent = snapshot.title || "Axiom token";
  const link = document.getElementById("tokenLink");
  try {
    const url = new URL(snapshot.url);
    if (url.origin === "https://axiom.trade") {
      link.href = url.href;
      link.textContent = "View current token in Axiom ↗";
    }
  } catch { /* Keep default link. */ }
  for (const field of fields) {
    document.getElementById(field).textContent = snapshot.stats[field] ?? "—";
  }
  document.getElementById("top10HoldersObservedAt").textContent = `DOM observation: ${holderTime(snapshot.marketObservedAt)}`;
  const net = document.getElementById("netVolume");
  net.classList.remove("positive", "negative");
  if ((snapshot.stats.netVolume || "").startsWith("+")) net.classList.add("positive");
  if ((snapshot.stats.netVolume || "").startsWith("-")) net.classList.add("negative");
  document.getElementById("updatedAt").textContent = new Date(lastSeenAt).toLocaleTimeString();
  renderHolders(snapshot);
  AxiomTokenInfoUI.render(snapshot, currentHolderData);
  AxiomTradingUI.setSnapshot(snapshot);
  AxiomChartUI.setSnapshot(snapshot);
  globalThis.AxiomLiquidityUI?.setContext(snapshot.liquidityContext);
  const lpBurned = snapshot.tokenInfo?.tiles?.lpBurned;
  document.getElementById("liquidityLPContext").textContent = `LP Burned — Axiom-reported: ${lpBurned?.status === "available" ? lpBurned.displayText : "Unavailable"}. Separate context; it does not suppress liquidity alerts or establish safety.`;
  updateStatus();
}

function updateStatus() {
  const indicator = document.getElementById("status");
  const text = document.getElementById("statusText");
  indicator.classList.remove("live", "stale", "waiting");
  if (lastSeenAt === null) {
    indicator.classList.add("waiting");
    text.textContent = "Waiting for Axiom…";
  } else if (Date.now() - lastSeenAt > 10000) {
    indicator.classList.add("stale");
    text.textContent = "No recent updates";
  } else {
    indicator.classList.add("live");
    text.textContent = "Connected to Axiom";
  }
}

AxiomTokenInfoUI.render({stats: {}}, null);
chrome.storage.session.get("latestSnapshot").then(({latestSnapshot}) => render(latestSnapshot));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.latestSnapshot?.newValue) {
    render(changes.latestSnapshot.newValue);
  }
});
setInterval(updateStatus, 1000);
document.getElementById("excludeHolderPools").addEventListener("change", renderConcentration);
setInterval(renderConcentration, 1000);
setInterval(() => AxiomTokenInfoUI.refresh(), 1000);
