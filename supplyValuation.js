// Decimal strings cross messaging/storage; BigInt is used only during exact arithmetic.
(() => {
  "use strict";
  const FRESH_MS = 10000, MAX_SKEW_MS = 5000;
  const definitions = Object.freeze({
    price: {labels: ["Price"], kind: "money", definition: "Axiom-displayed token price; display precision, not an independently verified execution price."},
    marketCap: {labels: ["Market Cap", "MarketCap", "Mkt Cap"], kind: "money", definition: "Axiom-reported Market Cap; the supply denominator is not established by this label."},
    displayedSupply: {labels: ["Supply"], kind: "quantity", supplyType: "unspecified", definition: "Axiom-displayed supply with unspecified type; not assumed circulating, total or maximum."},
    circulatingSupply: {labels: ["Circulating Supply"], kind: "quantity", supplyType: "circulating", definition: "Supply explicitly labeled circulating by Axiom; circulation methodology is not independently verified."},
    totalSupply: {labels: ["Total Supply"], kind: "quantity", supplyType: "total", definition: "Supply explicitly labeled total by Axiom; not assumed circulating or maximum."},
    maximumSupply: {labels: ["Maximum Supply", "Max Supply"], kind: "quantity", supplyType: "maximum", definition: "Supply explicitly labeled maximum by Axiom; a reported cap, not independently verified issuance rules."},
    reportedFDV: {labels: ["FDV", "Fully Diluted Valuation"], kind: "money", definition: "Axiom-reported FDV; its diluted-supply denominator is not established by this label."}
  });
  function decimal(digits, scale) {
    digits = digits.replace(/^0+/, "") || "0";
    if (digits === "0") return "0";
    while (scale > 0 && digits.endsWith("0")) { digits = digits.slice(0, -1); scale--; }
    if (scale <= 0) return digits + "0".repeat(-scale);
    return scale >= digits.length ? `0.${"0".repeat(scale - digits.length)}${digits}` : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  }
  function parse(raw, kind = "quantity") {
    if (raw === null || raw === undefined || typeof raw !== "string" && typeof raw !== "number") return null;
    let text = String(raw).replace(/\s+/g, " ").trim();
    if (!text || text.length > 2048 || typeof raw === "number" && (!Number.isFinite(raw) || raw < 0 || kind === "quantity" && Number.isInteger(raw) && !Number.isSafeInteger(raw))) return null;
    const approximate = /^[≈~]/.test(text); text = text.replace(/^[≈~]\s*/, "");
    text = text.replace(/0\.0([₀₁₂₃₄₅₆₇₈₉]+)(\d+)/g, (whole, sub, rest) => {
      const zeros = Number([...sub].map(char => "₀₁₂₃₄₅₆₇₈₉".indexOf(char)).join(""));
      return zeros >= 1 && zeros <= 1000 ? `0.${"0".repeat(zeros)}${rest}` : whole;
    });
    let currency = null;
    const symbol = text.match(/^([$€£])\s*/);
    if (symbol) { currency = {"$": "USD", "€": "EUR", "£": "GBP"}[symbol[1]]; text = text.slice(symbol[0].length); }
    const unit = text.match(/\s*(USD|EUR|GBP|SOL|ETH|BNB|USDC|USDT|BTC|WETH|WSOL|WBNB)$/i);
    if (unit) {
      if (currency && currency !== unit[1].toUpperCase()) return null;
      currency = unit[1].toUpperCase(); text = text.slice(0, -unit[0].length);
    }
    if (kind === "quantity" && currency) return null;
    if (kind === "quantity") text = text.replace(/\s+tokens?$/i, "");
    const match = text.match(/^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?:\d+(?:\.\d*)?|\.\d+))(?:e([+-]?\d+))?\s*([KMBT])?$/i);
    if (!match) return null;
    const coefficient = match[1].replace(/,/g, ""), exponent = Number(match[2] ?? 0), suffix = {K: 3, M: 6, B: 9, T: 12}[match[3]?.toUpperCase()] ?? 0;
    const [whole, fraction = ""] = coefficient.split("."), scale = fraction.length - exponent - suffix;
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000 || Math.abs(scale) > 1024 || whole.length + fraction.length + Math.max(0, -scale) > 1024) return null;
    return {normalizedValue: decimal(whole + fraction, scale), currency,
      abbreviated: Boolean(match[3]), approximate: approximate || Boolean(match[3]) || typeof raw === "number" && !Number.isSafeInteger(raw)};
  }
  function fromBaseUnits(raw, decimals) {
    if (typeof raw !== "string" || !/^\d{1,1024}$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Raw base units require an integer string and explicit decimals from 0 to 255.");
    return {normalizedValue: decimal(raw, decimals), normalization: "base-units-divided-once", rawValue: raw, decimals, unit: "token-units"};
  }
  function multiply(a, b) {
    const split = value => { if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value) || value.length > 1100) throw new Error("Expected a normalized decimal string."); const parts = value.split("."); return [BigInt(parts.join("")), parts[1]?.length ?? 0]; };
    const [x, xs] = split(a), [y, ys] = split(b); return decimal(String(x * y), xs + ys);
  }
  const copy = value => JSON.parse(JSON.stringify(value));
  function observation(key, rawText, {label = definitions[key]?.labels[0], context = {}, observedAt = null, status = null} = {}) {
    const definition = definitions[key]; if (!definition) throw new Error("Unknown supply/valuation field.");
    const parsed = parse(rawText, definition.kind);
    const unbounded = key === "maximumSupply" && /^(?:∞|unlimited|uncapped|no\s+(?:finite\s+)?max(?:imum)?(?:\s+supply)?)$/i.test(String(rawText ?? "").trim());
    return {key, source: "Axiom-reported", sourceField: label, rawText: rawText ?? null,
      normalizedValue: status ? null : parsed?.normalizedValue ?? null, currency: parsed?.currency ?? null,
      unit: definition.kind === "quantity" ? "token-units" : parsed?.currency ?? "currency-unresolved",
      supplyType: definition.supplyType ?? null, definition: definition.definition,
      observedAt, fetchedAt: null, context: copy(context), normalization: "already-displayed-units; no decimals applied",
      verificationStatus: "reported-unverified", abbreviated: parsed?.abbreviated ?? false,
      approximationStatus: parsed?.approximate ? "Rounded or abbreviated displayed input" : "Displayed precision; upstream precision unknown",
      status: status ?? (unbounded ? "unbounded" : parsed ? "available" : rawText == null || /^(?:\s*|—|--?|N\/?A)$/i.test(String(rawText)) ? "missing" : "malformed")};
  }
  const canonical = value => value?.startsWith("0x") ? value.toLowerCase() : value;
  function compatible(a, b) {
    const validToken = value => value && typeof value.mintAddress === "string" && ["solana", "eth", "bsc", "base"].includes(value.blockchain) &&
      (value.blockchain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.mintAddress ?? "") : /^0x[\da-fA-F]{40}$/.test(value.mintAddress ?? ""));
    return validToken(a) && validToken(b) && a?.sourceKey && a.sourceKey === b?.sourceKey && !a.conflict && !b.conflict && a.blockchain &&
      a.blockchain === b.blockchain && a.mintAddress && canonical(a.mintAddress) === canonical(b.mintAddress) &&
      (a.poolAddress ?? null) === (b.poolAddress ?? null);
  }
  function calculate(price, supply, {now = Date.now(), expectedType, name} = {}) {
    const result = {name, source: "Calculated estimate", status: "unavailable", normalizedValue: null, currency: price?.currency ?? null,
      supplyBasis: supply?.definition ?? "Unavailable", inputs: {price: price ? copy(price) : null, supply: supply ? copy(supply) : null}, approximate: true};
    let reason;
    if (price?.status !== "available") reason = `Price input is ${price?.status ?? "missing"}.`;
    else if (supply?.status !== "available") reason = `Supply input is ${supply?.status ?? "missing"}.`;
    else if (supply.supplyType !== expectedType) reason = `An explicitly identified ${expectedType} supply basis is required.`;
    else if (supply.unit !== "token-units" || supply.currency) reason = "Supply must be a quantity of this token, not a monetary value.";
    else if (!compatible(price.context, supply.context)) reason = "Compatible token/network/source identity is unresolved or differs between inputs.";
    else if (!price.currency || price.currency === "unspecified") reason = "Price currency is unresolved; USD is not assumed.";
    else if ([price, supply].some(field => !Number.isFinite(field.observedAt) || field.observedAt > now + 1000 || now - field.observedAt > FRESH_MS)) reason = "An input is stale or has no valid observation time (maximum age 10s).";
    else if (Math.abs(price.observedAt - supply.observedAt) > MAX_SKEW_MS) reason = "Input observations are more than 5s apart.";
    if (reason) return {...result, reason};
    try { return {...result, status: "available", normalizedValue: multiply(price.normalizedValue, supply.normalizedValue),
      reason: "Exact multiplication of displayed decimal values; economic valuation remains an approximate, unverified estimate."}; }
    catch { return {...result, reason: "An input has an invalid normalized decimal quantity."}; }
  }
  function analyze(packet, now = Date.now()) {
    const fields = packet?.fields ?? {};
    const calculations = [
      ["circulatingSupply", "circulating", "Circulating market cap"], ["totalSupply", "total", "Total-supply valuation"],
      ["maximumSupply", "maximum", "FDV — explicit maximum-supply basis"], ["displayedSupply", "unspecified", "Valuation using Axiom-displayed supply"]
    ].map(([key, expectedType, name]) => calculate(fields.price, fields[key], {now, expectedType, name}));
    return {fields, calculations};
  }
  function providerFields(packet) {
    return ["market_cap_usd", "fdv_usd"].map(key => {
      const present = Object.hasOwn(packet?.fields ?? {}, key), raw = packet?.fields?.[key] ?? null, parsed = parse(raw, "money");
      return {key, source: "Provider-reported", providerName: packet?.source ?? "GeckoTerminal Public API", sourceField: `data.attributes.${key}`, rawText: raw,
        normalizedValue: parsed && !parsed.currency ? parsed.normalizedValue : null, currency: "USD", fetchedAt: packet?.fetchedAt ?? null,
        context: {blockchain: packet?.blockchain, mintAddress: packet?.mintAddress, poolAddress: packet?.poolAddress},
        verificationStatus: "provider-reported; not blockchain-verified", status: parsed && !parsed.currency ? "available" : present && raw === null ? "provider-null" : present ? "malformed" : "absent",
        definition: key === "market_cap_usd" ? "Provider-reported market cap; CoinGecko-sourced values may include other networks. Not a chain-specific supply calculation." :
          "Provider-reported fully diluted valuation in USD. The response does not establish the diluted quantity or whether it is total or maximum supply.",
        scope: key === "market_cap_usd" ? "Potentially global/cross-chain; do not equate to this chain's circulating market cap" : "Provider pool-base-token valuation; diluted supply basis not supplied",
        approximationStatus: "Provider precision and methodology; no independent verification", sourceUrl: packet?.sourceUrl ?? null, definitionSource: packet?.definitionSource ?? null};
    });
  }
  const api = {definitions, labels: [...new Set(Object.values(definitions).flatMap(item => item.labels))], FRESH_MS, MAX_SKEW_MS,
    parse, fromBaseUnits, multiply, observation, compatible, calculate, analyze, providerFields};
  globalThis.AxiomSupply = Object.freeze(api);
  if (typeof module !== "undefined") module.exports = api;
})();
