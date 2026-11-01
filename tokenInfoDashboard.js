(() => {
  "use strict";
  const titles = {
    tax: "Displayed tax — Axiom-reported", developerHoldings: "Developer holdings — Axiom-reported",
    sniperHoldings: "Sniper holdings — Axiom-reported", insiders: "Insider share — Axiom-reported classification",
    lpBurned: "LP burned — Axiom-reported", holderCount: "Holders tile — Axiom-reported",
    proTraders: "Pro Traders — Axiom-reported", dexPaid: "Dex Paid — Axiom-reported payment status"
  };
  const time = at => Number.isFinite(at) ? new Date(at).toISOString() : "Unavailable";
  let latest = null;
  let lastValidity = null;
  const validity = (snapshot, holders, now) => JSON.stringify([snapshot.tokenInfo?.observedAt,
    Number.isFinite(snapshot.tokenInfo?.observedAt) && now >= snapshot.tokenInfo.observedAt && now - snapshot.tokenInfo.observedAt <= 10000,
    Number.isFinite(holders?.extractedAt) && now >= holders.extractedAt && now - holders.extractedAt <= 10000]);
  function detail(parent, label, value, href = null, kind = "address") {
    const line = document.createElement("p"); line.className = "section-note";
    const prefix = document.createElement("strong"); prefix.textContent = label + ": "; line.append(prefix);
    const safe = AxiomTokenInfo.explorerLink(href, kind);
    const node = document.createElement(safe ? "a" : "span"); node.textContent = value ?? "Unavailable";
    if (safe) { node.href = safe.url; node.target = "_blank"; node.rel = "noopener noreferrer"; }
    line.append(node); parent.append(line);
  }
  function render(snapshot, holders, now = Date.now()) {
    latest = [snapshot, holders];
    lastValidity = validity(snapshot, holders, now);
    const candidate = snapshot.tokenInfo;
    const current = candidate?.routeKey === (snapshot.chartContext?.routeKey ?? snapshot.tokenKey ?? snapshot.url) &&
      candidate?.status === "observed" && Number.isFinite(candidate.observedAt) && now >= candidate.observedAt && now - candidate.observedAt <= 10000;
    const info = current ? candidate : null;
    document.getElementById("tokenInfoObservation").textContent = `Source: Axiom-reported DOM · observed ${time(candidate?.observedAt)} · ${current ? "Public display; independently unverified" : candidate?.status === "awaiting-token" ? "Waiting for the selected token" : "Unavailable or stale (10s limit)"}`;
    const tiles = document.getElementById("tokenInfoTiles");
    for (const [key, title] of Object.entries(titles)) {
      let card = document.getElementById("tokenInfo-" + key);
      if (!card) {
        card = document.createElement("article"); card.className = "card"; card.id = "tokenInfo-" + key;
        const label = document.createElement("div"); label.className = "label"; label.textContent = title;
        const value = document.createElement("div"); value.className = "value";
        const note = document.createElement("p"); note.className = "card-note";
        card.append(label, value, note); tiles.append(card);
      }
      const observation = info?.tiles?.[key];
      card.querySelector(".value").textContent = observation?.status === "available" ? observation.displayText : "Unavailable";
      card.querySelector(".card-note").textContent = `Axiom DOM · ${time(observation?.observedAt)} · ${observation?.status ?? "unavailable"}`;
    }
    for (const key of ["top10Holders", "bundlers"]) {
      const observation = info?.tiles?.[key];
      // Legacy snapshots retain their existing reported cards and never become new observations.
      document.getElementById(key).textContent = candidate ? observation?.displayText ?? "Unavailable" : snapshot.stats[key] ?? "—";
    }
    document.getElementById("top10HoldersObservedAt").textContent = `DOM observation: ${time(candidate ? info?.tiles?.top10Holders?.observedAt : snapshot.marketObservedAt)}`;
    const tileCount = info?.tiles?.holderCount?.value;
    const tabCount = snapshot.stats.holders;
    document.getElementById("tokenInfoHolderCounts").textContent = `Holders tile: ${tileCount ?? "Unavailable"} · Holders tab: ${tabCount ?? "Unavailable"} (separate source; observed ${time(snapshot.marketObservedAt)}).` +
      (tileCount != null && tabCount != null && Number(String(tabCount).replace(/,/g, "")) !== tileCount ? " Counts disagree; both sources preserved." : "");
    const identity = document.getElementById("tokenInfoIdentity"); identity.replaceChildren();
    detail(identity, "Token CA — Axiom-reported", info?.token?.address ?? `Unavailable (${info?.token?.status ?? "unresolved"})`, info?.token?.explorerUrl);
    detail(identity, "Developer identity and funding context — Axiom-reported", info?.developer?.address ?? `Unavailable (${info?.developer?.status ?? "unresolved"})`, info?.developer?.explorerUrl);
    if (info?.developer?.username) {
      detail(identity, "Displayed developer username", info.developer.username + " · " +
        (info.developer.usernameVerification === "self-chosen-unverified" ? "Self-chosen pump.fun username; not a verified identity" : "Unverified username"));
      detail(identity, "Username source title", info.developer.usernameTitle);
    }
    if (snapshot.chartContext?.conflict) detail(identity, "Token context conflict", snapshot.chartContext.conflict);
    const funding = info?.funding;
    detail(identity, "Funding observation status", funding?.status);
    detail(identity, "Developer funding source", funding?.sourceAddress ?? `Unavailable (${funding?.sourceAddressStatus ?? funding?.status ?? "unresolved"})`, funding?.sourceExplorerUrl);
    detail(identity, "Displayed funding", funding?.amount && funding?.currency ? `${funding.amount} ${funding.currency}` : null);
    detail(identity, "Funding relative age (Axiom display)", funding?.relativeAgeText, funding?.transactionUrl, "transaction");
    detail(identity, "Funding transaction", funding?.transactionUrl ? "View public transaction" : null, funding?.transactionUrl, "transaction");
    detail(identity, "Funding source text", funding?.sourceText);
    detail(identity, "Funding observed at", time(funding?.observedAt));
    const match = AxiomTokenInfo.matchDeveloper(info, holders, snapshot.chartContext, now);
    document.getElementById("developerHolderMatch").textContent = match.status === "matched" ?
      `Full-address developer match in current Holders rows · ${match.rows[0].walletAddress} · observed holdings ${match.rows[0].remainingPercentage ?? "percentage unavailable"} · value ${match.rows[0].remainingTokenValue ?? "unavailable"} · quantity ${match.rows[0].tokenQuantity ?? "unavailable"} · Axiom DOM observed ${time(match.observedAt)}` :
      `Developer holder match: ${match.status === "not-observed" ? "Not observed in current rendered rows (partial coverage)" : "Unavailable (" + match.status + ")"}`;
  }
  globalThis.AxiomTokenInfoUI = Object.freeze({render, refresh: () => {
    if (latest && validity(...latest, Date.now()) !== lastValidity) render(...latest);
  }});
})();
