// Shared, dependency-free historical price OHLCV collector and export helpers.
(() => {
  "use strict";
  const API = "https://api.geckoterminal.com/api/v2";
  const SOURCE = "GeckoTerminal Public API";
  const CACHE_TTL = 60000;
  const REQUEST_GAP = 6500; // Public API currently documents approximately 10 calls/minute.
  const MAX_DATASETS = 4;
  const MAX_CANDLES = 500;
  const NETWORKS = {sol: "solana", solana: "solana", bnb: "bsc", bsc: "bsc", ethereum: "eth", eth: "eth", base: "base"};
  const canonical = value => value?.startsWith("0x") ? value.toLowerCase() : value;
  const equalAddress = (a, b) => Boolean(a && b && canonical(a) === canonical(b));
  function isAddress(address, network) {
    if (typeof address !== "string") return false;
    if (network !== "solana") return /^0x[\da-fA-F]{40}$/.test(address);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let decoded = 0n;
    for (const char of address) decoded = decoded * 58n + BigInt(alphabet.indexOf(char));
    let bytes = 0;
    while (decoded > 0n) { bytes++; decoded >>= 8n; }
    return bytes + address.match(/^1*/)[0].length === 32;
  }
  function contextKey(context, timeframe = "1m") {
    return JSON.stringify([context?.sourceKey, context?.blockchain, context?.mintAddress,
      context?.poolAddress, context?.routeAddress, timeframe, "USD", "price"]);
  }
  function normalizeCandles(response, fetchedAt = Date.now()) {
    const list = response?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list)) throw new Error("GeckoTerminal returned no OHLCV array.");
    const byTimestamp = new Map();
    let rejectedRows = 0;
    for (const item of list) {
      if (!Array.isArray(item) || item.length !== 6 || !item.every(Number.isFinite)) { rejectedRows++; continue; }
      const [timestamp, open, high, low, close, volume] = item;
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp % 60 !== 0 ||
          timestamp > Math.floor(fetchedAt / 1000) || Math.min(open, high, low, close, volume) < 0 ||
          high < Math.max(open, close, low) || low > Math.min(open, close, high)) { rejectedRows++; continue; }
      byTimestamp.set(timestamp, {timestamp, open, high, low, close, volume,
        finalized: timestamp + 60 <= Math.floor(fetchedAt / 1000)});
    }
    return {candles: [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_CANDLES), rejectedRows};
  }
  const exportFields = ["timestamp", "open", "high", "low", "close", "volume", "finalized",
    "blockchain", "mintAddress", "poolAddress", "timeframe", "intervalSeconds", "quoteCurrency",
    "volumeCurrency", "valueType", "dataSource", "poolSelection", "tokenSelection", "fetchedAt", "sourceUrl", "finalizationBasis"];
  function records(dataset, includeIncomplete = false) {
    return (dataset?.candles ?? []).filter(row => includeIncomplete || row.finalized).map(row => {
      const record = {};
      for (const field of exportFields) record[field] = row[field] ?? dataset.metadata[field] ?? null;
      return record;
    });
  }
  function toJSONL(dataset, includeIncomplete = false) {
    return records(dataset, includeIncomplete).map(row => JSON.stringify(row)).join("\n");
  }
  function toCSV(dataset, includeIncomplete = false) {
    const escape = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
    return [exportFields.join(","), ...records(dataset, includeIncomplete)
      .map(row => exportFields.map(field => escape(row[field])).join(","))].join("\r\n");
  }
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
      signal?.addEventListener("abort", abort, {once: true});
    });
  }
  class ApiError extends Error {
    constructor(message, status = null, retryAt = null) { super(message); this.status = status; this.retryAt = retryAt; }
  }
  function createCollector({storage, fetchImpl = globalThis.fetch, now = Date.now, sleep = wait} = {}) {
    let loaded = false;
    let cache = [];
    let budget = {nextRequestAt: 0, cooldownUntil: 0, failures: 0};
    let queue = Promise.resolve();
    const poolCache = new Map();
    async function load() {
      if (loaded) return;
      const saved = storage ? await storage.get(["chartCache", "chartApiBudget"]) : {};
      cache = Array.isArray(saved.chartCache) ? saved.chartCache.filter(entry =>
        entry?.key && entry?.metadata?.valueType === "price" && Array.isArray(entry.candles))
        .slice(-MAX_DATASETS).map(entry => ({...entry, candles: entry.candles.slice(-MAX_CANDLES)})) : [];
      if (saved.chartApiBudget) budget = {...budget, ...saved.chartApiBudget};
      loaded = true;
    }
    async function saveBudget() { if (storage) await storage.set({chartApiBudget: budget}); }
    function request(path, signal) {
      const job = queue.catch(() => {}).then(async () => {
        await load();
        signal?.throwIfAborted();
        if (budget.cooldownUntil > now()) throw new ApiError("GeckoTerminal is cooling down after a rate limit or service error.", 429, budget.cooldownUntil);
        await sleep(Math.max(0, budget.nextRequestAt - now()), signal);
        signal?.throwIfAborted();
        budget.nextRequestAt = now() + REQUEST_GAP;
        await saveBudget();
        let response;
        try {
          response = await fetchImpl(API + path, {headers: {Accept: "application/json;version=20230203"},
            credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)});
        } catch (error) {
          if (signal?.aborted) throw error;
          budget.failures = Math.min(budget.failures + 1, 5);
          budget.cooldownUntil = now() + Math.min(60000 * 2 ** (budget.failures - 1), 900000);
          await saveBudget();
          throw new ApiError("GeckoTerminal request failed or timed out. Cached data is retained.", null, budget.cooldownUntil);
        }
        if (response.status === 429 || response.status >= 500) {
          budget.failures = Math.min(budget.failures + 1, 5);
          const retry = response.headers.get("Retry-After");
          const retryAt = retry && /^\d+(?:\.\d+)?$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry);
          budget.cooldownUntil = Math.max(Number.isFinite(retryAt) ? retryAt : 0,
            now() + Math.min(60000 * 2 ** (budget.failures - 1), 900000));
          await saveBudget();
          throw new ApiError(`GeckoTerminal HTTP ${response.status}; retry after the cooldown.`, response.status, budget.cooldownUntil);
        }
        if (!response.ok) throw new ApiError(`GeckoTerminal HTTP ${response.status}.`, response.status);
        budget.failures = 0; budget.cooldownUntil = 0;
        await saveBudget();
        return response.json();
      });
      queue = job;
      return job;
    }
    function poolDetails(body, network, expectedPool) {
      const pool = body?.data;
      const address = pool?.attributes?.address;
      const tokenAddress = side => {
        const id = pool?.relationships?.[`${side}_token`]?.data?.id;
        return typeof id === "string" && id.startsWith(network + "_") ? id.slice(network.length + 1) : null;
      };
      const base = tokenAddress("base"), quote = tokenAddress("quote");
      if (!isAddress(address, network) || (expectedPool && !equalAddress(address, expectedPool)) ||
          !isAddress(base, network) || !isAddress(quote, network) || equalAddress(address, base) || equalAddress(address, quote)) {
        throw new Error("Pool metadata could not verify separate pool and token addresses.");
      }
      return {address, base, quote};
    }
    async function getPool(network, address, signal) {
      const key = network + ":" + canonical(address);
      const saved = poolCache.get(key);
      if (saved && now() - saved.fetchedAt < 600000) return saved.details;
      const details = poolDetails(await request(`/networks/${network}/pools/${address}?include=base_token,quote_token`, signal), network, address);
      poolCache.delete(key); poolCache.set(key, {details, fetchedAt: now()});
      if (poolCache.size > 8) poolCache.delete(poolCache.keys().next().value);
      return details;
    }
    async function resolveContext(context, signal) {
      const network = NETWORKS[context?.blockchain];
      if (!network) throw new Error("Blockchain unavailable or unsupported. A verified network is required.");
      if (context.conflict) throw new Error(context.conflict);
      let mint = context.mintAddress;
      let pool = context.poolAddress;
      const route = context.routeAddress;
      for (const address of [mint, pool, route].filter(Boolean)) {
        if (!isAddress(address, network)) throw new Error("Invalid full token or pool address.");
      }
      if (mint && equalAddress(mint, pool)) throw new Error("Mint and liquidity pool addresses must be different.");
      if (route && pool && !equalAddress(route, pool) && !equalAddress(route, mint)) {
        throw new Error("Route and explicit pool disagree; waiting for current-token metadata.");
      }
      let details;
      let poolSelection = "axiom-explicit-pool";
      let tokenSelection = mint ? "axiom-explicit-mint" : "pool-base-token";
      if (route && !equalAddress(route, mint) && !equalAddress(route, pool)) {
        try {
          details = await getPool(network, route, signal);
          pool = route; poolSelection = "axiom-route-verified-pool";
        } catch (error) {
          if (error.status !== 404) throw error;
          if (mint && !equalAddress(mint, route)) throw new Error("Route and displayed mint disagree; waiting for current-token metadata.");
          mint = route; pool = null; tokenSelection = "axiom-route-verified-mint";
        }
      }
      if (!details && pool) details = await getPool(network, pool, signal);
      if (!details) {
        if (!mint && route) mint = route;
        if (!mint) throw new Error("No current-token mint or liquidity pool could be detected.");
        const response = await request(`/networks/${network}/tokens/${mint}/pools?include=base_token,quote_token`, signal);
        const candidates = (response.data ?? []).map(pool => {
          try { return {details: poolDetails({data: pool}, network), reserve: Number(pool.attributes.reserve_in_usd) || 0}; }
          catch { return null; }
        }).filter(pool => pool && (equalAddress(pool.details.base, mint) || equalAddress(pool.details.quote, mint)))
          .sort((a, b) => b.reserve - a.reserve);
        if (!candidates.length) throw new Error("No supported GeckoTerminal liquidity pool found for this mint.");
        details = candidates[0].details;
        poolSelection = "geckoterminal-top-pool-fallback";
      }
      if (mint && !equalAddress(mint, details.base) && !equalAddress(mint, details.quote)) {
        throw new Error("Detected mint is not a token in the verified liquidity pool.");
      }
      mint ||= details.base;
      return {blockchain: network, mintAddress: mint, poolAddress: details.address,
        tokenSide: equalAddress(mint, details.base) ? "base" : "quote", pairBaseAddress: details.base,
        pairQuoteAddress: details.quote, poolSelection, tokenSelection};
    }
    return {
      async cached(context, timeframe = "1m") {
        await load(); return cache.find(entry => entry.key === contextKey(context, timeframe)) ?? null;
      },
      async collect(context, {timeframe = "1m", signal} = {}) {
        if (timeframe !== "1m") throw new Error("1-second candles are unsupported by this public historical collector. Select 1 minute.");
        await load();
        const key = contextKey(context, timeframe);
        const prior = cache.find(entry => entry.key === key);
        if (prior && now() - prior.metadata.fetchedAt < CACHE_TTL) return {...prior, cacheHit: true};
        const identity = await resolveContext(context, signal);
        const path = `/networks/${identity.blockchain}/pools/${identity.poolAddress}/ohlcv/minute?aggregate=1&limit=100&currency=usd&token=${identity.tokenSide}&include_empty_intervals=false`;
        const response = await request(path, signal);
        if ((response.meta?.base?.address && !equalAddress(response.meta.base.address, identity.pairBaseAddress)) ||
            (response.meta?.quote?.address && !equalAddress(response.meta.quote.address, identity.pairQuoteAddress))) {
          throw new Error("OHLCV token metadata does not match the verified pool.");
        }
        const fetchedAt = now();
        const normalized = normalizeCandles(response, fetchedAt);
        if (!normalized.candles.length && normalized.rejectedRows) throw new Error("All returned OHLCV rows failed field or price validation.");
        const matchingPrior = prior && equalAddress(prior.metadata.poolAddress, identity.poolAddress) &&
          equalAddress(prior.metadata.mintAddress, identity.mintAddress) ? prior.candles : [];
        const merged = new Map(matchingPrior.map(row => [row.timestamp, row]));
        for (const row of normalized.candles) merged.set(row.timestamp, row);
        const dataset = {key, metadata: {...identity, timeframe: "1m", intervalSeconds: 60,
          quoteCurrency: "USD", volumeCurrency: "USD", valueType: "price", dataSource: SOURCE,
          fetchedAt, sourceUrl: API + path, finalizationBasis: "interval-end-at-fetch; provider revisions possible",
          rejectedRows: normalized.rejectedRows, includeEmptyIntervals: false},
          candles: [...merged.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_CANDLES)
            .map(row => ({...row, finalized: row.timestamp + 60 <= Math.floor(fetchedAt / 1000)}))};
        signal?.throwIfAborted();
        cache = [...cache.filter(entry => entry.key !== key), dataset].slice(-MAX_DATASETS);
        if (storage) await storage.set({chartCache: cache});
        return {...dataset, cacheHit: false};
      }
    };
  }
  const exported = {createCollector, normalizeCandles, toJSONL, toCSV, records, contextKey,
    isAddress, NETWORKS, API, SOURCE, MAX_CANDLES, MAX_DATASETS};
  globalThis.AxiomChartData = Object.freeze(exported);
  if (typeof module !== "undefined") module.exports = exported;
})();
