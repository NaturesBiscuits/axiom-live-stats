// Axiom-displayed observations only. No page actions or external requests.
(() => {
  "use strict";
  const definitions = {
    tax: ["Tax %", "percentage"], top10Holders: ["Top 10 H.", "percentage"],
    developerHoldings: ["Dev H.", "percentage"], sniperHoldings: ["Snipers H.", "percentage"],
    insiders: ["Insiders", "percentage"], bundlers: ["Bundlers", "percentage"],
    lpBurned: ["LP Burned", "percentage"], holderCount: ["Holders", "count"],
    proTraders: ["Pro Traders", "count"], dexPaid: ["Dex Paid", "payment-status"]
  };
  const labels = [...Object.values(definitions).map(([label]) => label), "CA:", "DA:"];
  const clean = value => String(value ?? "").replace(/\s+/g, " ").trim();
  const addressAPI = () => globalThis.AxiomHolderTableExtractor ?? require("./holderTableExtractor.js");
  const visible = node => {
    if (!node?.isConnected || node.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    if (["hidden", "collapse"].includes(style.visibility) || style.display === "none") return false;
    // display:contents wrappers have no rect of their own.
    if (style.display === "contents") return [...node.children].some(visible);
    if (node.checkVisibility && !node.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
    return Boolean(node.getClientRects().length);
  };
  function text(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node.matches("svg, img, i") || !visible(node)) return "";
    return [...node.childNodes].map(text).join(" ");
  }
  function parse(raw, kind) {
    const value = clean(raw);
    if (kind === "payment-status") return /^(?:Paid|Unpaid)$/i.test(value) ? value.toLowerCase() : null;
    if (kind === "count") {
      if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
      const count = Number(value.replace(/,/g, ""));
      return Number.isSafeInteger(count) ? count : null;
    }
    const match = value.match(/^(\d+(?:\.\d+)?)\s*%$/);
    if (!match) return null;
    const [whole, fraction = ""] = match[1].split(".");
    if (BigInt(whole) > 100n || (BigInt(whole) === 100n && /[1-9]/.test(fraction))) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) && !(number === 0 && /[1-9]/.test(match[1])) ? number : null;
  }
  function explorerLink(raw, kind = "address") {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
      const hosts = {"solscan.io": "solana", "explorer.solana.com": "solana", "etherscan.io": "eth", "bscscan.com": "bsc", "basescan.org": "base"};
      const chain = hosts[url.hostname];
      const pattern = kind === "transaction" ? /^\/(?:tx|transaction)\/([1-9A-HJ-NP-Za-km-z]{64,88}|0x[\da-fA-F]{64})\/?$/ : /^\/(?:account|address|token)\/([^/]+)\/?$/;
      const match = url.pathname.match(pattern);
      if (!chain || !match || (kind === "address" && (!addressAPI().isAddress(match[1]) ||
          (chain === "solana") === match[1].startsWith("0x")))) return null;
      url.search = ""; url.hash = "";
      return {url: url.href, address: kind === "address" ? match[1] : null, chain};
    } catch { return null; }
  }
  const observation = (observedAt, extra = {}) => ({source: "axiom-reported", observedAt, ...extra});
  const matching = (nodes, label) => nodes.filter(node => node.isConnected && !node.children.length && clean(node.textContent) === label);
  function tile(label, nodes) {
    let branch = label;
    for (let depth = 0; depth < 6 && branch.parentElement; depth++, branch = branch.parentElement) {
      const scope = branch.parentElement;
      if (nodes.some(node => node !== label && scope.contains(node) && labels.includes(clean(node.textContent)))) return null;
      const siblings = [...scope.children].filter(node => node !== branch && !node.matches("i, svg, img") &&
        !(!clean(node.textContent) && node.querySelector("i, svg, img")));
      if (siblings.length) return {scope, valueNodes: siblings};
      // An empty or removed value band still belongs to this tile. Never keep
      // climbing into an unlabeled neighboring percentage after finding it.
      if (branch.tagName === "DIV" && scope.tagName === "DIV" && !scope.hasAttribute("data-tooltip-trigger")) return {scope, valueNodes: []};
    }
    return null;
  }
  function readTile(nodes, label, kind, at) {
    const candidates = matching(nodes, label).filter(node => !node.closest('[role="tab"], [role="tablist"], [data-perf-id*="table"], [role="row"]'));
    const readings = candidates.filter(visible).map(node => {
      const binding = tile(node, nodes);
      const raw = binding ? clean(binding.valueNodes.map(text).join(" ")) : "";
      return {raw, value: parse(raw, kind)};
    });
    const values = new Set(readings.map(reading => reading.value));
    const valid = readings.length && values.size === 1 && !values.has(null);
    return observation(at, {label, kind, value: valid ? readings[0].value : null,
      displayText: valid ? readings[0].raw : null, sourceText: readings.map(item => item.raw).filter(Boolean).join(" | ") || null,
      status: valid ? "available" : values.size > 1 ? "conflicting" : readings.length ? "malformed-or-missing" : candidates.length ? "hidden" : "missing"});
  }
  function identityRow(label, nodes) {
    let branch = label;
    let fallback = null;
    for (let depth = 0; depth < 6 && branch.parentElement; depth++, branch = branch.parentElement) {
      const scope = branch.parentElement;
      if (nodes.some(node => node !== label && scope.contains(node) && ["CA:", "DA:"].includes(clean(node.textContent)))) return fallback;
      // Never expand a missing DA link into the developer's funding subsection.
      if (scope.querySelector('[data-funding-dev-badge], a[href*="/tx/"], a[href*="/transaction/"]')) return fallback;
      if ([...scope.querySelectorAll("a[href]")].some(link => !branch.contains(link))) return scope;
      if (!fallback && [...scope.children].some(node => node !== label && clean(node.textContent))) fallback = scope;
      if (scope.querySelector('button[aria-label="Blacklist dev"], button[aria-label="Scan developer address"]')) fallback = scope;
    }
    return fallback;
  }
  function readIdentity(nodes, label, at) {
    const rows = matching(nodes, label).filter(visible).map(node => identityRow(node, nodes)).filter(Boolean);
    const links = rows.flatMap(row => [...row.querySelectorAll("a[href]")].filter(visible)
      .map(link => explorerLink(link.getAttribute("href"))).filter(Boolean));
    const addresses = new Map(links.map(link => [addressAPI().addressKey(link.address), link]));
    const unique = addresses.size === 1 ? [...addresses.values()][0] : null;
    const titles = rows.flatMap(row => [...row.querySelectorAll("[title]")].filter(visible))
      .filter(node => /pump\.fun username/i.test(node.title));
    const usernames = new Set(titles.map(node => clean(text(node))).filter(Boolean));
    return {rows, data: observation(at, {label, status: addresses.size > 1 ? "conflicting" : unique ? "resolved" : "unresolved",
      address: unique?.address ?? null, explorerUrl: unique?.url ?? null, chain: unique?.chain ?? null,
      candidates: [...addresses.values()].map(link => link.address), sourceText: rows.map(row => clean(text(row))).join(" | ") || null,
      username: usernames.size === 1 ? [...usernames][0] : null,
      usernameTitle: titles.length === 1 ? clean(titles[0].title) : null,
      usernameVerification: titles.length === 1 && /self-chosen[\s\S]*not a verified identity/i.test(titles[0].title) ? "self-chosen-unverified" : "unverified"})};
  }
  function readFunding(rows, at) {
    const scopes = new Set();
    for (const row of rows) {
      const parent = row.parentElement;
      if (!parent || [...parent.querySelectorAll("span")].some(node => clean(node.textContent) === "CA:")) continue;
      for (const sibling of parent.children) if (sibling !== row && visible(sibling) &&
          sibling.querySelector('[data-funding-dev-badge], a[href*="/tx/"], a[href*="/transaction/"]')) scopes.add(sibling);
    }
    const links = [...scopes].flatMap(scope => [...scope.querySelectorAll("a[href]")].filter(visible));
    const addresses = new Map(links.map(link => explorerLink(link.getAttribute("href"))).filter(Boolean)
      .map(link => [addressAPI().addressKey(link.address), link]));
    const transactions = new Map(links.map(link => ({link, parsed: explorerLink(link.getAttribute("href"), "transaction")}))
      .filter(item => item.parsed).map(item => [item.parsed.url, item]));
    const address = addresses.size === 1 ? [...addresses.values()][0] : null;
    const transaction = transactions.size === 1 ? [...transactions.values()][0] : null;
    const amounts = [...scopes].flatMap(scope => [...scope.querySelectorAll("img[alt]")].filter(visible))
      .filter(img => /^(SOL|ETH|BNB|USD|USDC|USDT)$/.test(img.alt))
      .map(img => ({amount: clean(text(img.parentElement)), currency: img.alt}));
    const amount = amounts.length === 1 && /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(amounts[0].amount) ? amounts[0] : null;
    const badges = [...scopes].flatMap(scope => [...scope.querySelectorAll("[data-funding-dev-badge]")].filter(visible));
    return observation(at, {status: !scopes.size ? "unavailable" : addresses.size > 1 || transactions.size > 1 || amounts.length > 1 ? "conflicting" : "displayed-context",
      sourceAddress: address?.address ?? null, sourceExplorerUrl: address?.url ?? null,
      sourceAddressStatus: addresses.size > 1 ? "conflicting" : address ? "resolved" : "unresolved",
      sourceAddressCandidates: [...addresses.values()].map(item => item.address),
      transactionUrl: transaction?.parsed.url ?? null, relativeAgeText: transaction ? clean(text(transaction.link)) || null : null,
      amount: amount?.amount ?? null, currency: amount?.currency ?? null,
      badgeText: badges.length === 1 ? clean(text(badges[0])).replace(/\s*\/\s*/, " / ") : null,
      badgeMeaning: "uninterpreted", sourceText: [...scopes].map(scope => clean(text(scope))).join(" | ") || null,
      transactionTimestamp: null});
  }
  function extract(nodes, {observedAt = Date.now(), routeKey = null} = {}) {
    const tiles = Object.fromEntries(Object.entries(definitions).map(([key, [label, kind]]) => [key, readTile(nodes, label, kind, observedAt)]));
    const token = readIdentity(nodes, "CA:", observedAt), developer = readIdentity(nodes, "DA:", observedAt);
    return {source: "axiom-reported", observedAt, routeKey, status: "observed", tiles, token: token.data, developer: developer.data,
      funding: readFunding(developer.rows, observedAt), independentVerification: "unavailable",
      verifiedTransfers: null, decodedSales: null, walletClustering: null};
  }
  function unavailable(data) {
    return {...data, status: "awaiting-token", tiles: Object.fromEntries(Object.entries(data.tiles).map(([key, item]) =>
      [key, {...item, value: null, displayText: null, sourceText: null, status: "awaiting-token"}])),
      token: {...observation(data.observedAt), status: "awaiting-token", address: null, candidates: []},
      developer: {...observation(data.observedAt), status: "awaiting-token", address: null, candidates: []},
      funding: {...observation(data.observedAt), status: "awaiting-token"}};
  }
  function createReader() {
    let previous = null, previousNodes = [], route = null, waiting = false;
    const blocked = new Map();
    const signature = value => JSON.stringify(value, (key, item) => key === "observedAt" ? undefined : item);
    return {read(nodes, options = {}) {
      const data = extract(nodes, options);
      const currentNodes = nodes.filter(node => labels.includes(clean(node.textContent)));
      if (route !== null && route !== options.routeKey) waiting = true;
      if (waiting) {
        const reused = previousNodes.some(node => node.isConnected && currentNodes.includes(node));
        const caChanged = data.token.address && previous?.token.address && data.token.address !== previous.token.address;
        if (reused && !caChanged) { route = options.routeKey; return unavailable(data); }
        waiting = false;
      }
      // A changed CA can precede replacement of the other parts of the panel.
      // Hold each unchanged, reused part until its own display or DOM node changes.
      if (previous?.token.address && data.token.address && previous.token.address !== data.token.address) {
        for (const key of [...Object.keys(definitions), "developer", "funding"]) {
          const label = definitions[key]?.[0] ?? "DA:";
          const oldNodes = previousNodes.filter(node => clean(node.textContent) === label);
          const oldValue = definitions[key] ? previous.tiles[key] : previous[key];
          const value = definitions[key] ? data.tiles[key] : data[key];
          if (oldNodes.some(node => currentNodes.includes(node)) && signature(value) === signature(oldValue)) blocked.set(key, {signature: signature(value), nodes: oldNodes});
        }
      }
      route = options.routeKey; previous = structuredClone(data); previousNodes = currentNodes;
      for (const [key, guard] of blocked) {
        const value = definitions[key] ? data.tiles[key] : data[key];
        if (!guard.nodes.some(node => currentNodes.includes(node)) || signature(value) !== guard.signature) { blocked.delete(key); continue; }
        if (definitions[key]) data.tiles[key] = {...value, value: null, displayText: null, sourceText: null, status: "awaiting-token"};
        else data[key] = {...observation(data.observedAt), status: "awaiting-token", address: null, candidates: []};
      }
      return data;
    }};
  }
  function matchDeveloper(info, holders, context, now = Date.now()) {
    const dev = info?.developer;
    const unavailable = {status: "unavailable", rows: [], source: "current-axiom-holder-rows"};
    if (info?.status !== "observed" || dev?.status !== "resolved" || !addressAPI().isAddress(dev.address) ||
        !Number.isFinite(info.observedAt) || now - info.observedAt > 10000 || now < info.observedAt || context?.conflict ||
        holders?.context?.sourceKey !== context?.sourceKey || !context?.sourceKey || info.routeKey !== context.routeKey ||
        holders.activeTable?.kind !== "holders" || !["available", "unsupported"].includes(holders.tableStatus) ||
        !Number.isFinite(holders.extractedAt) || now - holders.extractedAt > 10000 || now < holders.extractedAt) return unavailable;
    const rows = (holders.rawRows ?? holders.rows ?? []).filter(row => row.identityStatus === "resolved" && addressAPI().isAddress(row.walletAddress) &&
      addressAPI().addressKey(row.walletAddress) === addressAPI().addressKey(dev.address));
    if (!rows.length) return {...unavailable, status: "not-observed"};
    if (rows.some(row => row.extractionId !== holders.extractionId || row.observedAt !== holders.extractedAt || row.tokenContext?.sourceKey !== context.sourceKey) ||
        new Set(rows.map(row => JSON.stringify([row.remainingPercentage, row.remainingTokenValue, row.tokenQuantity]))).size > 1) return {...unavailable, status: "conflicting"};
    return {status: "matched", rows: [rows[0]], source: "current-axiom-holder-rows", observedAt: holders.extractedAt};
  }
  const api = {definitions, labels, parse, explorerLink, extract, createReader, matchDeveloper};
  globalThis.AxiomTokenInfo = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
