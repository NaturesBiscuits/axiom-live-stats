"use strict";
const fields = [
  "globalFees", "price", "liquidity", "supply", "ath",
  "volume5m", "buys", "sells", "netVolume", "holders", "bundlers", "top10Holders"
];
let lastSeenAt = null;
let lastHolderFingerprint = "";

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
  const data = snapshot.holdersIntelligence?.tokenKey === (snapshot.tokenKey || snapshot.url) ? snapshot.holdersIntelligence : null;
  const fingerprint = JSON.stringify({url: snapshot.url, reported: snapshot.stats.holders, data});
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
    secondary(wallet, holder.walletAddress || "Identity unresolved", holder.walletAddress ? "cell-secondary wallet-address" : "cell-secondary unresolved");
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
  const net = document.getElementById("netVolume");
  net.classList.remove("positive", "negative");
  if ((snapshot.stats.netVolume || "").startsWith("+")) net.classList.add("positive");
  if ((snapshot.stats.netVolume || "").startsWith("-")) net.classList.add("negative");
  document.getElementById("updatedAt").textContent = new Date(lastSeenAt).toLocaleTimeString();
  renderHolders(snapshot);
  AxiomChartUI.setSnapshot(snapshot);
  globalThis.AxiomLiquidityUI?.setContext(snapshot.liquidityContext);
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

chrome.storage.session.get("latestSnapshot").then(({latestSnapshot}) => render(latestSnapshot));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.latestSnapshot?.newValue) {
    render(changes.latestSnapshot.newValue);
  }
});
setInterval(updateStatus, 1000);
