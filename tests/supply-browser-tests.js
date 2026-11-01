(async () => {
  "use strict";
  const tests = [], errors = [], root = document.getElementById("fixture"), S = AxiomSupply;
  const assert = (value, message) => { if (!value) throw new Error(message); }, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const test = async (name, run) => { document.getElementById("results").textContent = JSON.stringify({passed: tests.length, running: name}); await run(); tests.push(name); };
  const addr = n => "0x" + n.toString(16).padStart(40, "0"), context = {sourceKey: "supply-a", routeKey: "route-a", blockchain: "eth", mintAddress: addr(1), poolAddress: addr(2)};
  const markup = items => items.map(([label, value]) => `<div><span>${label}</span><span>${value}</span></div>`).join("");
  const labels = () => [...root.querySelectorAll("span")].filter(node => S.labels.includes(node.textContent.trim()));
  const script = (doc, file) => new Promise((resolve, reject) => { const item = doc.createElement("script"); item.src = new URL(file, location.href).href; item.onload = resolve; item.onerror = reject; doc.head.append(item); });
  window.addEventListener("error", e => errors.push(e.message)); window.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
  let normalPacket, ui, doc, win;
  try {
    await test("DOM capture preserves raw price/supply/cap with exact normalization and leaves generic supply untyped", () => {
      root.innerHTML = markup([["Price", "$0.1"], ["Supply", "1.001K"], ["Market Cap", "$999K"]]);
      const packet = AxiomSupplyExtractor.createReader().read(labels(), context);
      assert(packet.fields.price.rawText === "$0.1" && packet.fields.displayedSupply.normalizedValue === "1001", "Raw and exact displayed values");
      assert(packet.fields.displayedSupply.supplyType === "unspecified" && packet.fields.circulatingSupply.status === "missing", "Generic supply has no inferred classification");
      assert(packet.fields.marketCap.normalizedValue === "999000" && packet.fields.marketCap.source === "Axiom-reported", "Observed cap remains independent");
      assert(packet.fields.price.observedAt && packet.fields.price.context.mintAddress === context.mintAddress, "Actual read time and identity retained");
    });
    await test("Explicit circulating/total/maximum labels remain independent, including zero and unbounded maximum", () => {
      root.innerHTML = markup([["Price", "$2"], ["Circulating Supply", "0"], ["Total Supply", "150"], ["Max Supply", "Unlimited"], ["Supply", "99"]]);
      const reader = AxiomSupplyExtractor.createReader(), packet = reader.read(labels(), context), result = S.analyze(packet);
      assert(result.calculations[0].normalizedValue === "0" && result.calculations[1].normalizedValue === "300", "Zero circulating and distinct total");
      assert(packet.fields.maximumSupply.status === "unbounded" && result.calculations[2].status === "unavailable", "No finite maximum invented");
      root.querySelectorAll("div")[3].lastElementChild.textContent = "200";
      assert(S.analyze(reader.read(labels(), context)).calculations[2].normalizedValue === "400", "Explicit maximum provides the documented FDV basis");
    });
    await test("Extraction preserves display precision, tiny subscript prices and large quantities without using tooltip or token decimals twice", () => {
      root.innerHTML = markup([["Price", "$0.0<sub>5</sub>123"], ["Supply", "9007199254740993"], ["Total Supply", "1.001K"]]);
      root.lastElementChild.lastElementChild.title = "999999";
      const packet = AxiomSupplyExtractor.createReader().read(labels(), {...context, decimals: 18});
      assert(packet.fields.price.rawText === "$0.0₅123" && packet.fields.price.normalizedValue === "0.00000123", "Subscript display preserved and parsed");
      assert(packet.fields.displayedSupply.normalizedValue === "9007199254740993" && packet.fields.totalSupply.normalizedValue === "1001", "No tooltip substitution or precision loss");
      assert(packet.fields.totalSupply.normalization.includes("no decimals applied"), "Already displayed units preserved");
    });
    await test("Missing, conflicting, hidden and malformed fields do not borrow nearby values or hide unrelated valid figures", () => {
      root.innerHTML = markup([["Price", "$2"], ["Total Supply", "oops"], ["Supply", "100"], ["Supply", "200"], ["Maximum Supply", "300"]]) + '<div><span>Circulating Supply</span></div><div><span>50%</span></div>';
      root.querySelectorAll("div")[4].hidden = true;
      const fields = AxiomSupplyExtractor.createReader().read(labels(), context).fields;
      assert(fields.price.normalizedValue === "2" && fields.totalSupply.status === "malformed", "Unrelated price remains valid");
      assert(fields.displayedSupply.status === "conflicting" && fields.displayedSupply.observations.length === 2, "Conflicting candidates retained");
      assert(fields.maximumSupply.status === "hidden" && fields.circulatingSupply.normalizedValue === null, "No hidden or neighboring substitution");
    });
    await test("Token and network changes guard reused cells through rapid hops, then accept each updated field or replaced node", () => {
      root.innerHTML = markup([["Price", "$2"], ["Total Supply", "100"]]);
      const reader = AxiomSupplyExtractor.createReader(); reader.read(labels(), context);
      const other = {...context, sourceKey: "supply-b", mintAddress: addr(3)};
      assert(reader.read(labels(), other).fields.totalSupply.status === "awaiting-token", "Reused prior-token supply blocked");
      assert(reader.read(labels(), {...other, sourceKey: "supply-c", blockchain: "bsc"}).fields.price.status === "awaiting-token", "Guard survives rapid hops");
      const next = {...other, sourceKey: "supply-c", blockchain: "bsc"}; root.firstElementChild.lastElementChild.textContent = "$3";
      const partial = reader.read(labels(), next); assert(partial.fields.price.status === "available" && partial.fields.totalSupply.status === "awaiting-token", "Each unchanged cell remains blocked independently");
      root.innerHTML = markup([["Price", "$3"], ["Total Supply", "100"]]);
      assert(S.analyze(reader.read(labels(), next)).calculations[1].normalizedValue === "300", "Replacement can legitimately contain unchanged numeric supply");
    });
    await test("Dashboard separates reported values, optional generic calculation, typed supply and unverified FDV basis", async () => {
      root.innerHTML = markup([["Price", "$2"], ["Supply", "1K"], ["Market Cap", "$999"], ["Circulating Supply", "100"], ["Total Supply", "150"], ["Maximum Supply", "200"]]);
      normalPacket = AxiomSupplyExtractor.createReader().read(labels(), context);
      const iframe = document.createElement("iframe"); iframe.style.cssText = "width:1100px;height:800px";
      const html = await (await fetch("../dashboard.html")).text(); iframe.srcdoc = html.replace(/<script[^>]*><\/script>/g, "").replace('href="dashboard.css"', 'href="../dashboard.css"');
      const ready = new Promise(resolve => iframe.onload = resolve); document.body.append(iframe); await ready;
      win = iframe.contentWindow; doc = iframe.contentDocument;
      win.addEventListener("error", e => errors.push(e.message));
      await script(doc, "../supplyValuation.js"); await script(doc, "../supplyDashboard.js"); ui = win.AxiomSupplyUI;
      ui.setSnapshot({chartContext: context, supplyValuation: normalPacket});
      assert(doc.getElementById("supplyObserved").textContent.includes("999 USD") && doc.getElementById("supplyCalculations").textContent.includes("≈ 300 USD"), "Observed cap is not replaced by total valuation");
      assert(!doc.getElementById("supplyCalculations").textContent.includes("Valuation using Axiom"), "Unknown-type calculation is opt-in");
      doc.getElementById("supplyGenericCalculation").checked = true; doc.getElementById("supplyGenericCalculation").dispatchEvent(new win.Event("change"));
      assert(doc.getElementById("supplyCalculations").textContent.includes("Valuation using Axiom-displayed supply") && doc.getElementById("supplyCalculations").textContent.includes("unspecified"), "Generic estimate honestly named");
      assert(doc.getElementById("supplyProvenance").textContent.includes("Source field/label") && doc.getElementById("supplyProvenance").textContent.includes("reported-unverified"), "Per-input provenance and quality");
    });
    await test("Dashboard uses actual observation age, rejects mismatched snapshots, and renders untrusted source text inertly", () => {
      const stale = structuredClone(normalPacket); for (const field of Object.values(stale.fields)) if (field.observedAt) field.observedAt -= 11000;
      ui.setSnapshot({chartContext: context, capturedAt: Date.now(), supplyValuation: stale});
      assert(doc.getElementById("supplyCalculations").textContent.includes("stale") && !doc.getElementById("supplyCalculations").textContent.includes("≈ 300 USD"), "Republished old data is not renewed");
      const unsafe = structuredClone(normalPacket); unsafe.fields.displayedSupply.rawText = '<img src=x onerror="throw 1">'; unsafe.fields.displayedSupply.status = "malformed"; unsafe.fields.displayedSupply.normalizedValue = null;
      ui.setSnapshot({chartContext: context, supplyValuation: unsafe}); assert(!doc.getElementById("supplyProvenance").querySelector("img") && doc.getElementById("supplyProvenance").textContent.includes("<img"), "Source text inert");
      ui.setSnapshot({chartContext: {...context, sourceKey: "other", mintAddress: addr(9)}, supplyValuation: normalPacket});
      assert(ui.inspect().analysis.fields.price.status === "context-mismatch", "Old token snapshot rejected");
      ui.setSnapshot({chartContext: {...context, conflict: "identity unresolved"}, supplyValuation: normalPacket});
      assert(ui.inspect().analysis.calculations.every(row => row.status === "unavailable"), "Current identity conflict rejects older compatible-looking inputs");
      ui.setSnapshot({chartContext: context, supplyValuation: normalPacket});
    });
    await test("Optional provider fields preserve global scope and fetch time; quote-token mismatch and API failure do not change DOM calculations", () => {
      const data = {blockchain: "eth", mintAddress: context.mintAddress, poolAddress: context.poolAddress, fetchedAt: Date.now() - 61000, fields: {market_cap_usd: "500", fdv_usd: null}};
      ui.setProvider(data);
      assert(doc.getElementById("supplyProvider").textContent.includes("market_cap_usd") && doc.getElementById("supplyProvider").textContent.includes("cross-chain"), "Original field and global-scope warning");
      assert(doc.getElementById("supplyProvider").textContent.includes("Stale provider") && doc.getElementById("supplyProvider").textContent.includes("provider-null"), "Own fetch age and missing value");
      ui.providerError("HTTP 503"); assert(doc.getElementById("supplyProviderStatus").textContent.includes("503") && ui.inspect().analysis.calculations[1].normalizedValue === "300", "Provider failure does not block DOM estimate");
      ui.setProvider({...data, mintAddress: addr(99)}); assert(!doc.getElementById("supplyProvider").textContent.includes("500 USD") && doc.getElementById("supplyProviderStatus").textContent.includes("cannot be matched"), "Base-token valuation not assigned to quote token");
    });
    await test("Real content messaging retains supply provenance while market-cap chart packets remain independently observed", async () => {
      root.replaceChildren(); const market = document.getElementById("market");
      market.innerHTML = markup([["Price", "$2"], ["Supply", "100"], ["Total Supply", "150"], ["Market Cap", "$999"], ["Global Fees Paid", "1 ETH"], ["Liquidity", "$500"]]);
      market.setAttribute("data-chain", "eth"); market.setAttribute("data-token-mint", context.mintAddress); market.setAttribute("data-pool-address", context.poolAddress);
      const messages = []; window.chrome = {runtime: {sendMessage(message, callback) { messages.push(message); callback?.(); }}};
      await script(document, "../content.js"); await pause(1550);
      const snapshot = messages.filter(row => row.type === "AXIOM_STATS_UPDATE").at(-1)?.snapshot;
      assert(snapshot?.stats.price === "$2" && snapshot.stats.supply === "100" && snapshot.stats.marketCap === "$999", "Existing displayed stats preserved");
      assert(snapshot.supplyValuation.fields.totalSupply.normalizedValue === "150", "Supply evidence travels in existing atomic snapshot");
      const chartRows = messages.filter(row => row.type === "AXIOM_DOM_CHART_UPDATE").flatMap(row => row.packet.series.marketCap?.samples ?? []).filter(row => row.value !== null);
      assert(chartRows.length && chartRows.every(row => row.value === 999), "Calculated total valuation 300 never overwrites observed cap 999");
      const observedAt = snapshot.supplyValuation.fields.price.observedAt;
      await pause(150); assert(messages.filter(row => row.type === "AXIOM_STATS_UPDATE").at(-1).snapshot.supplyValuation.fields.price.observedAt === observedAt, "Rereading a snapshot is not a fresh extraction");
      window.dispatchEvent(new Event("pagehide"));
    });
    assert(!errors.length, errors.join("; "));
    document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests}); document.body.dataset.testStatus = "passed";
  } catch (error) {
    window.dispatchEvent(new Event("pagehide")); document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests, error: error.stack}); document.body.dataset.testStatus = "failed";
  }
})();
