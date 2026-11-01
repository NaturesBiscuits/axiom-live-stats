// Public DOM/URL hints only. Untyped route addresses remain separate from mint/pool hints.
(() => {
  "use strict";
  const aliases = {sol: "solana", solana: "solana", bnb: "bsc", bsc: "bsc", eth: "eth", ethereum: "eth", base: "base"};
  const addressLike = text => /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|0x[\da-fA-F]{40})$/.test(text || "");
  const poolLike = text => addressLike(text) || /^0x[\da-fA-F]{64}$/.test(text || "");
  const canonical = address => address?.startsWith("0x") ? address.toLowerCase() : address;
  const excluded = node => node.closest('[data-perf-id*="table"], [role="row"], .holder-table, [data-perf-id="token-trades-panel"]');
  function routeKey(locationLike = location) {
    const url = new URL(locationLike.href);
    // Never collect referral/session/auth query parameters.
    const identity = ["chain", "network", "mint", "tokenAddress", "pool", "poolAddress", "pairAddress"]
      .map(name => [name, url.searchParams.get(name)]).filter(([, value]) => value);
    return url.origin + url.pathname + (identity.length ? "?" + new URLSearchParams(identity) : "");
  }
  function detect(doc = document, locationLike = location, explicitToken = null, relatedIdentities = null) {
    const url = new URL(locationLike.href);
    const chains = new Set();
    const mints = new Map();
    const pools = new Map();
    const evidence = [];
    const nonTokenAddresses = new Set([...(relatedIdentities?.developer?.candidates ?? []),
      ...(relatedIdentities?.funding?.sourceAddressCandidates ?? [])].map(canonical));
    const addChain = value => { const chain = aliases[value?.toLowerCase()]; if (chain) chains.add(chain); };
    const add = (target, value, source) => {
      if (!(target === pools ? poolLike(value) : addressLike(value))) return;
      target.set(canonical(value), value); evidence.push(source);
    };
    addChain(url.searchParams.get("chain")); addChain(url.searchParams.get("network"));
    add(mints, url.searchParams.get("mint"), "url-mint");
    add(mints, url.searchParams.get("tokenAddress"), "url-token-address");
    for (const field of ["pool", "poolAddress", "pairAddress"]) add(pools, url.searchParams.get(field), `url-${field}`);
    const parts = url.pathname.split("/").filter(Boolean);
    let routeAddress = null;
    if (parts[0] === "meme" && poolLike(parts.at(-1))) routeAddress = parts.at(-1);
    if (aliases[parts[1]]) addChain(parts[1]);

    for (const node of doc.querySelectorAll("[data-token-mint], [data-mint-address], [data-token-address], [data-pool-address], [data-pair-address], [data-chain], [data-network]")) {
      if (excluded(node)) continue;
      addChain(node.getAttribute("data-chain")); addChain(node.getAttribute("data-network"));
      for (const field of ["data-token-mint", "data-mint-address", "data-token-address"]) add(mints, node.getAttribute(field), field);
      for (const field of ["data-pool-address", "data-pair-address"]) add(pools, node.getAttribute(field), field);
    }
    for (const anchor of doc.querySelectorAll('a[href*="geckoterminal.com/"], a[href*="solscan.io/token/"], a[href*="bscscan.com/token/"], a[href*="etherscan.io/token/"], a[href*="basescan.org/token/"]')) {
      if (excluded(anchor)) continue;
      try {
        const link = new URL(anchor.getAttribute("href"), url);
        if (link.protocol !== "https:") continue;
        const match = link.pathname.match(/^\/([^/]+)\/pools\/([^/]+)\/?$/);
        if (["www.geckoterminal.com", "geckoterminal.com"].includes(link.hostname) && match) {
          addChain(match[1]); add(pools, match[2], "geckoterminal-pool-link");
        }
        const explorers = {"solscan.io": "solana", "bscscan.com": "bsc", "etherscan.io": "eth", "basescan.org": "base"};
        const token = link.pathname.match(/^\/token\/([^/]+)\/?$/);
        if (explorers[link.hostname] && token) {
          if (nonTokenAddresses.has(canonical(token[1]))) continue;
          addChain(explorers[link.hostname]); add(mints, token[1], "token-explorer-link");
        }
      } catch { /* Unavailable public identity hint. */ }
    }
    // Only an exactly scoped CA observation establishes a displayed token address.
    // DA/funding links and untyped route addresses never become mints.
    if (explicitToken?.status === "resolved") {
      add(mints, explicitToken.address, "axiom-explicit-ca");
      addChain(explicitToken.chain);
    }
    const blockchain = chains.size === 1 ? [...chains][0] : null;
    const mintAddress = mints.size === 1 ? [...mints.values()][0] : null;
    const poolAddress = pools.size === 1 ? [...pools.values()][0] : null;
    let conflict = chains.size > 1 || mints.size > 1 || pools.size > 1 ?
      "Multiple current-token identity hints disagree; waiting for unambiguous token metadata." : null;
    if (explicitToken?.status === "conflicting") conflict = "Axiom CA explorer links disagree; token identity unresolved.";
    if (routeAddress && poolAddress && canonical(routeAddress) !== canonical(poolAddress) &&
        canonical(routeAddress) !== canonical(mintAddress)) conflict = "Route and displayed pool disagree; waiting for current-token metadata.";
    const route = routeKey(locationLike);
    const sourceKey = JSON.stringify([route, blockchain, canonical(mintAddress), canonical(poolAddress), canonical(routeAddress)]);
    return {sourceKey, routeKey: route, blockchain, mintAddress, poolAddress, routeAddress,
      conflict, evidence: [...new Set(evidence)], identityStatus: conflict ? "conflict" : blockchain &&
        (mintAddress || poolAddress || routeAddress) ? "dom-hints" : "unavailable"};
  }
  globalThis.AxiomTokenContextDetector = Object.freeze({detect, routeKey});
})();
