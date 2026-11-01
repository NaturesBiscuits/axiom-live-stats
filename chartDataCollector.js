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
  // Some provider pools (for example EVM v4 pools) use a bytes32 pool ID, not a token address.
  const isPoolAddress = (address, network) => isAddress(address, network) ||
    (network !== "solana" && typeof address === "string" && /^0x[\da-fA-F]{64}$/.test(address));
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
      if (!Array.isArray(item) || item.length !== 6 || !item.slice(0, 5).every(Number.isFinite) ||
          (item[5] !== null && (!Number.isFinite(item[5]) || item[5] < 0))) { rejectedRows++; continue; }
      const [timestamp, open, high, low, close, volume] = item;
      if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp % 60 !== 0 ||
          timestamp > Math.floor(fetchedAt / 1000) || Math.min(open, high, low, close) < 0 ||
          high < Math.max(open, close, low) || low > Math.min(open, close, high)) { rejectedRows++; continue; }
      byTimestamp.set(timestamp, {timestamp, open, high, low, close, volume,
        finalized: timestamp + 60 <= Math.floor(fetchedAt / 1000)});
    }
    return {candles: [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-MAX_CANDLES), rejectedRows};
  }
  const exportFields = ["timestamp", "open", "high", "low", "close", "volume", "finalized",
    "blockchain", "mintAddress", "poolAddress", "timeframe", "intervalSeconds", "quoteCurrency",
    "volumeCurrency", "valueType", "dataSource", "poolSelection", "tokenSelection", "fetchedAt", "sourceUrl", "finalizationBasis",
    "timestampUTC", "intervalStatus", "incomplete", "tokenSide", "pairBaseAddress", "pairQuoteAddress", "selectedPeriodSeconds", "stale", "volumeAvailable"];
  function records(dataset, includeIncomplete = false) {
    return (dataset?.candles ?? []).filter(row => includeIncomplete || row.finalized).map(row => {
      const record = {};
      for (const field of exportFields) record[field] = row[field] ?? dataset.metadata[field] ?? null;
      record.timestampUTC = new Date(row.timestamp * 1000).toISOString();
      record.intervalStatus = row.finalized ? "interval-ended; provider revisions possible" : "incomplete";
      record.incomplete = !row.finalized; record.volumeAvailable = Number.isFinite(row.volume);
      record.stale = Boolean(dataset.stale);
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
  function summarize(dataset, seconds = 900) {
    if (![900, 3600].includes(seconds)) throw new Error("Choose a 15m or 1h viewing period.");
    const end = Math.floor(dataset.metadata.fetchedAt / 60000) * 60, start = end - seconds + 60;
    const rows = dataset.candles.filter(row => row.timestamp >= start && row.timestamp <= end);
    const volumes = rows.filter(row => Number.isFinite(row.volume)), first = rows[0], last = rows.at(-1);
    const change = first?.open > 0 ? (last.close - first.open) / first.open * 100 : null;
    const total = volumes.length ? volumes.reduce((sum, row) => sum + row.volume, 0) : null;
    return {rows, start, end, seconds, expected: seconds / 60, missingIntervals: seconds / 60 - rows.length,
      complete: rows.length === seconds / 60, firstOpen: first?.open ?? null, latestClose: last?.close ?? null,
      highest: rows.length ? Math.max(...rows.map(row => row.high)) : null, lowest: rows.length ? Math.min(...rows.map(row => row.low)) : null,
      changePercent: Number.isFinite(change) ? change : null, volume: Number.isFinite(total) ? total : null,
      volumeCount: volumes.length, missingVolumes: rows.length - volumes.length, incomplete: rows.filter(row => !row.finalized).length};
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
    let loading = null;
    let cache = [];
    let budget = {nextRequestAt: 0, cooldownUntil: 0, failures: 0};
    let queue = Promise.resolve();
    const poolCache = new Map();
    const candidatesCache = new Map();
    async function load() {
      if (loaded) return;
      loading ||= (async () => {
        const saved = storage ? await storage.get(["chartCache", "chartApiBudget"]) : {};
        cache = Array.isArray(saved.chartCache) ? saved.chartCache.filter(entry => entry?.key &&
          entry?.metadata?.valueType === "price" && entry.metadata.quoteCurrency === "USD" && entry.metadata.volumeCurrency === "USD" &&
          ["base", "quote"].includes(entry.metadata.tokenSide) && Number.isFinite(entry.metadata.fetchedAt) &&
          NETWORKS[entry.metadata.blockchain] && isAddress(entry.metadata.mintAddress, entry.metadata.blockchain) &&
          isPoolAddress(entry.metadata.poolAddress, entry.metadata.blockchain) &&
          equalAddress(entry.metadata.mintAddress, entry.metadata.tokenSide === "base" ? entry.metadata.pairBaseAddress : entry.metadata.pairQuoteAddress) && Array.isArray(entry.candles))
          .slice(-MAX_DATASETS).map(entry => ({...entry, candles: normalizeCandles({data: {attributes: {
            ohlcv_list: entry.candles.map(row => [row?.timestamp, row?.open, row?.high, row?.low, row?.close, row?.volume])}}}, entry.metadata.fetchedAt).candles})) : [];
        if (saved.chartApiBudget) for (const key of Object.keys(budget)) {
          if (Number.isFinite(saved.chartApiBudget[key]) && saved.chartApiBudget[key] >= 0) budget[key] = saved.chartApiBudget[key];
        }
        loaded = true;
      })().catch(error => { loading = null; throw error; });
      await loading;
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
        if (!response.ok) throw new ApiError(`GeckoTerminal HTTP ${response.status}.${response.status === 401 || response.status === 403 ? " Public API access was denied; no paid or authenticated fallback is used." : response.status === 404 ? " Network, pool or token is unsupported or not indexed; check the selection or find pools." : ""}`, response.status);
        budget.failures = 0; budget.cooldownUntil = 0;
        await saveBudget();
        try { return await response.json(); } catch { throw new ApiError("GeckoTerminal returned malformed JSON.", response.status); }
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
      if ((pool?.id && (typeof pool.id !== "string" || !pool.id.startsWith(network + "_") || !equalAddress(pool.id.slice(network.length + 1), address))) ||
          !isPoolAddress(address, network) || (expectedPool && !equalAddress(address, expectedPool)) ||
          !isAddress(base, network) || !isAddress(quote, network) || equalAddress(base, quote) || equalAddress(address, base) || equalAddress(address, quote)) {
        throw new Error("Pool metadata could not verify separate pool and token addresses.");
      }
      return {address, base, quote, createdAt: pool.attributes.pool_created_at ?? null,
        reportedFields: Object.fromEntries(["market_cap_usd", "fdv_usd"].filter(key => Object.hasOwn(pool.attributes, key)).map(key => [key, pool.attributes[key]]))};
    }
    async function getPool(network, address, signal) {
      const key = network + ":" + canonical(address);
      const saved = poolCache.get(key);
      if (saved && now() - saved.fetchedAt < 600000) return saved.details;
      const details = {...poolDetails(await request(`/networks/${network}/pools/${address}?include=base_token,quote_token`, signal), network, address), fetchedAt: now()};
      poolCache.delete(key); poolCache.set(key, {details, fetchedAt: now()});
      if (poolCache.size > 8) poolCache.delete(poolCache.keys().next().value);
      return details;
    }
    async function resolveContext(context, signal) {
      const network = NETWORKS[context?.blockchain];
      if (!network) throw new Error("Blockchain unavailable or unsupported. A verified network is required.");
      if (context.conflict) throw new Error(context.conflict);
      const mint = context.mintAddress, pool = context.poolAddress;
      if (!isAddress(mint, network)) throw new Error("Enter the selected token's full address; an untyped route or pool base token is not a token selection.");
      if (!isPoolAddress(pool, network)) throw new Error("Select a pool explicitly. Use Find pools when the pool address is unknown.");
      if (mint && equalAddress(mint, pool)) throw new Error("Mint and liquidity pool addresses must be different.");
      const details = await getPool(network, pool, signal);
      if (mint && !equalAddress(mint, details.base) && !equalAddress(mint, details.quote)) {
        throw new Error("Detected mint is not a token in the verified liquidity pool.");
      }
      return {blockchain: network, mintAddress: mint, poolAddress: details.address,
        tokenSide: equalAddress(mint, details.base) ? "base" : "quote", pairBaseAddress: details.base,
        pairQuoteAddress: details.quote, poolCreatedAt: details.createdAt,
        poolSelection: ["user-selected-candidate", "axiom-explicit-pool"].includes(context.poolSelection) ? context.poolSelection : "user-selected-pool",
        tokenSelection: "explicit-selected-token", providerValuations: {
          source: SOURCE, blockchain: network, mintAddress: details.base, poolAddress: details.address,
          fetchedAt: details.fetchedAt, fields: details.reportedFields,
          sourceUrl: `${API}/networks/${network}/pools/${pool}?include=base_token,quote_token`,
          tokenBasis: "pool-base-token; not automatically the selected quote token",
          definitionSource: "https://docs.coingecko.com/reference/pool-address"}};
    }
    return {
      async findPools(context, {signal} = {}) {
        signal?.throwIfAborted();
        const network = NETWORKS[context?.blockchain], mint = context?.mintAddress;
        if (!network) throw new Error("Select a supported network before finding pools.");
        if (!isAddress(mint, network)) throw new Error("Enter a valid full token address before finding pools.");
        const key = network + ":" + canonical(mint), cached = candidatesCache.get(key);
        if (cached && now() - cached.fetchedAt < CACHE_TTL) return {...cached, cacheHit: true};
        const body = await request(`/networks/${network}/tokens/${mint}/pools?include=base_token,quote_token&page=1`, signal);
        if (!Array.isArray(body?.data)) throw new Error("GeckoTerminal returned a malformed candidate-pool list.");
        const pools = new Map(); let rejectedPools = 0;
        for (const pool of body.data.slice(0, 100)) {
          try {
            const details = poolDetails({data: pool}, network);
            if (!equalAddress(details.base, mint) && !equalAddress(details.quote, mint)) throw new Error("Unrelated pool");
            const raw = pool.attributes.reserve_in_usd;
            const reserve = (typeof raw === "number" || typeof raw === "string" && raw.trim() && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(raw.trim())) ? Number(raw) : NaN;
            pools.set(canonical(details.address), {network, poolAddress: details.address, baseAddress: details.base, quoteAddress: details.quote,
              liquidityUSD: Number.isFinite(reserve) && reserve >= 0 ? reserve : null,
              name: typeof pool.attributes.name === "string" ? pool.attributes.name.slice(0, 160) : "Unnamed pool"});
          } catch { rejectedPools++; }
        }
        if (body.data.length && !pools.size && rejectedPools) throw new Error("No candidate pool could verify this network and token; provider data was malformed or unrelated.");
        signal?.throwIfAborted();
        const result = {network, mintAddress: mint, candidates: [...pools.values()], fetchedAt: now(), page: 1, rejectedPools};
        candidatesCache.set(key, result); if (candidatesCache.size > 8) candidatesCache.delete(candidatesCache.keys().next().value);
        return {...result, cacheHit: false};
      },
      async cached(context, timeframe = "1m") {
        await load(); return cache.find(entry => entry.key === contextKey(context, timeframe)) ?? null;
      },
      async collect(context, {timeframe = "1m", signal, force = false} = {}) {
        if (timeframe !== "1m") throw new Error("1-second candles are unsupported by this public historical collector. Select 1 minute.");
        signal?.throwIfAborted();
        if (context?.conflict) throw new Error(context.conflict);
        const network = NETWORKS[context?.blockchain];
        if (!network) throw new Error("Blockchain unavailable or unsupported. A verified network is required.");
        if (!isAddress(context?.mintAddress, network)) throw new Error("Enter the selected token's full address.");
        if (!isPoolAddress(context?.poolAddress, network)) throw new Error("Select a pool explicitly. Use Find pools when the pool address is unknown.");
        if (equalAddress(context.mintAddress, context.poolAddress)) throw new Error("Mint and liquidity pool addresses must be different.");
        await load();
        const key = contextKey(context, timeframe);
        const prior = cache.find(entry => entry.key === key);
        signal?.throwIfAborted();
        if (!force && prior && now() - prior.metadata.fetchedAt < CACHE_TTL &&
            equalAddress(prior.metadata.mintAddress, context.mintAddress) && equalAddress(prior.metadata.poolAddress, context.poolAddress) &&
            prior.metadata.blockchain === network) return {...prior, cacheHit: true};
        const identity = await resolveContext(context, signal);
        const path = `/networks/${identity.blockchain}/pools/${identity.poolAddress}/ohlcv/minute?aggregate=1&limit=100&currency=usd&token=${identity.tokenSide}&include_empty_intervals=false`;
        const response = await request(path, signal);
        const fetchedAt = now();
        const normalized = normalizeCandles(response, fetchedAt);
        if (!normalized.candles.length && normalized.rejectedRows) throw new Error("All returned OHLCV rows failed field or price validation.");
        // OHLCV meta is oriented to the selected token, unlike pool relationship ordering.
        const counterToken = identity.tokenSide === "base" ? identity.pairQuoteAddress : identity.pairBaseAddress;
        const responseBase = response?.meta?.base?.address, responseQuote = response?.meta?.quote?.address;
        if ((responseBase && !equalAddress(responseBase, identity.mintAddress)) ||
            (responseQuote && !equalAddress(responseQuote, counterToken)) ||
            (normalized.candles.length && (!equalAddress(responseBase, identity.mintAddress) || !equalAddress(responseQuote, counterToken)))) {
          throw new Error("OHLCV token metadata does not match the selected token and verified pool; metadata may be missing.");
        }
        const dataset = {key, metadata: {...identity, timeframe: "1m", intervalSeconds: 60,
          quoteCurrency: "USD", volumeCurrency: "USD", valueType: "price", dataSource: SOURCE,
          fetchedAt, sourceUrl: API + path, finalizationBasis: "interval-end-at-fetch; provider revisions possible",
          rejectedRows: normalized.rejectedRows, includeEmptyIntervals: false},
          candles: normalized.candles};
        signal?.throwIfAborted();
        cache = [...cache.filter(entry => entry.key !== key), dataset].slice(-MAX_DATASETS);
        if (storage) await storage.set({chartCache: cache});
        return {...dataset, cacheHit: false};
      }
    };
  }
  const exported = {createCollector, normalizeCandles, summarize, toJSONL, toCSV, records, contextKey,
    isAddress, isPoolAddress, NETWORKS, API, SOURCE, MAX_CANDLES, MAX_DATASETS, CACHE_TTL, REQUEST_GAP};
  globalThis.AxiomChartData = Object.freeze(exported);
  if (typeof module !== "undefined") module.exports = exported;
})();
