(async () => {
  "use strict";
  const tests = [], errors = [], pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const test = async (name, run) => { document.getElementById("results").textContent = JSON.stringify({passed: tests.length, running: name}); await run(); tests.push(name); };
  const addr = n => "0x" + n.toString(16).padStart(40, "0");
  const mint = addr(1), quote = addr(2), pool = addr(100), second = addr(101), third = addr(102);
  try {
    const iframe = document.createElement("iframe"); iframe.style.cssText = "width:1100px;height:900px";
    const html = await (await fetch("../dashboard.html")).text();
    iframe.srcdoc = html.replace(/<script[^>]*><\/script>/g, "").replace('href="dashboard.css"', 'href="../dashboard.css"');
    const loaded = new Promise(resolve => iframe.onload = resolve); document.body.append(iframe); await loaded;
    const win = iframe.contentWindow, doc = iframe.contentDocument, calls = []; let permission = true, permissionCalls = 0, mode = "normal", release, offset = 0;
    win.addEventListener("error", e => errors.push(e.message)); win.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
    win.chrome = {permissions: {request: async () => { permissionCalls++; return permission; }}, storage: {local: {get: async () => ({}), set: async () => {}}}};
    const poolBody = address => ({data: {id: `eth_${address}`, attributes: {address}, relationships: {
      base_token: {data: {id: `eth_${mint}`}}, quote_token: {data: {id: `eth_${quote}`}}}}});
    const candleBody = (selectedQuote = false) => {
      const end = Math.floor((Date.now() + offset) / 60000) * 60;
      return {data: {attributes: {ohlcv_list: mode === "empty" ? [] : [
        [end - 180, 1e-30, 2e-30, 0, 2e-30, 0], [end - 60, 2e-30, 4e-30, 1e-30, 1e-30, null], [end, 1e-30, 3e-30, 0, 2e-30, 12.5]]}},
      meta: {base: {address: selectedQuote ? quote : mint}, quote: {address: selectedQuote ? mint : quote}}};
    };
    win.fetch = async url => {
      calls.push(url);
      if (mode === "network") throw new Error("Simulated network failure");
      if (mode === "403" || mode === "429") return new win.Response("{}", {status: Number(mode), headers: {"Retry-After": "60"}});
      if (mode === "malformed") return new win.Response("not json");
      if (url.includes("/tokens/")) {
        const candidates = [pool, second, third].map((address, index) => {
          const item = poolBody(address).data; item.attributes.name = index === 0 ? '<img src=x onerror="throw 1">' : "Example pool";
          item.attributes.reserve_in_usd = ["1000000", "0", null][index]; return item;
        });
        if (mode === "defer-pools") return new Promise(resolve => { release = () => resolve(new win.Response(JSON.stringify({data: candidates}))); });
        return new win.Response(JSON.stringify({data: candidates}));
      }
      if (url.includes("/ohlcv/")) {
        const body = candleBody(url.includes("token=quote"));
        if (mode === "defer-candles") return new Promise(resolve => { release = () => resolve(new win.Response(JSON.stringify(body))); });
        return new win.Response(JSON.stringify(body));
      }
      return new win.Response(JSON.stringify(poolBody(url.match(/\/pools\/([^/?]+)/)[1])));
    };
    const script = async file => { const item = doc.createElement("script"); item.src = new URL(file, location.href).href; const ready = new Promise((resolve, reject) => { item.onload = resolve; item.onerror = reject; }); doc.head.append(item); await ready; };
    await script("../vendor/lightweight-charts.standalone.production.js"); await script("../chartView.js"); await script("../chartDataCollector.js"); await script("../tokenContextDetector.js");
    const original = win.AxiomChartData;
    // Browser fixtures skip real pacing waits; collector unit tests verify measured request gaps.
    win.AxiomChartData = {...original, createCollector: options => original.createCollector({...options, sleep: async () => {}, now: () => Date.now() + offset})};
    await script("../historicalChart.js");
    const node = id => doc.getElementById(id), input = id => node(id).dispatchEvent(new win.Event("input", {bubbles: true}));
    const submit = () => node("historyForm").dispatchEvent(new win.Event("submit", {cancelable: true}));
    const settle = async () => { for (let i = 0; i < 100 && node("historyLoad").disabled; i++) await pause(10); assert(!node("historyLoad").disabled, "Request settled"); };
    const waitRelease = async () => { for (let i = 0; i < 100 && !release; i++) await pause(10); assert(release, "Deferred provider call reached"); };
    const set = (token = mint, selectedPool = "") => win.AxiomHistoricalUI.setContext({sourceKey: `test-${token}-${selectedPool}`, blockchain: "eth", mintAddress: token, poolAddress: selectedPool || null});
    await test("Historical requests require explicit actions and missing identity has field-level guidance without symbol-based chain guesses", () => {
      assert(calls.length === 0 && permissionCalls === 0, "No automatic permission prompt or fetch");
      const fixture = doc.createElement("div"); fixture.innerHTML = '<span>0.1 SOL</span><span>1 ETH</span>'; doc.body.append(fixture);
      const detected = win.AxiomTokenContextDetector.detect(fixture, {href: "https://axiom.trade/meme/example"});
      assert(detected.blockchain === null, "Native balances do not establish the network");
      const poolID = "0x" + "a".repeat(64), hints = doc.createElement("div"); fixture.append(hints);
      hints.setAttribute("data-pool-address", poolID); hints.setAttribute("data-token-mint", mint); hints.setAttribute("data-chain", "eth");
      const explicit = win.AxiomTokenContextDetector.detect(fixture, {href: "https://axiom.trade/meme/example"});
      assert(explicit.poolAddress === poolID && explicit.mintAddress === mint, "Explicit bytes32 provider pool ID stays separate from token identity");
      submit(); assert(node("historyNetworkHelp").textContent.includes("Select") && calls.length === 0, "Missing network is actionable and makes no request");
      set(); submit(); assert(node("historyPoolHelp").textContent.includes("Find pools") && calls.length === 0, "Unknown pool directs user to discovery");
    });
    await test("Permission denial makes no API calls; discovery shows safe, full pool identities and never selects the highest liquidity", async () => {
      permission = false; node("historyFindPools").click(); await settle();
      assert(calls.length === 0 && node("historyPoolStatus").textContent.includes("declined"), "Permission denial");
      permission = true; node("historyFindPools").click(); await settle();
      assert(calls.length === 1 && node("historyCandidates").children.length === 3, "Explicit pool discovery only");
      assert(!node("historyPool").value && !node("historyCandidates").querySelector("img"), "No silent selection or active source HTML");
      assert(node("historyCandidates").textContent.includes("liquidity 0 USD") && node("historyCandidates").textContent.includes("liquidity unavailable"), "Zero versus unknown liquidity");
      node("historyCandidates").children[1].click();
      assert(node("historyPool").value === second && calls.length === 1, "User selects a non-top pool; no load yet");
    });
    await test("One-minute price and volume share navigation with separate panes, tiny formatting, blank gaps and incomplete markers", async () => {
      submit(); await settle(); await pause(50);
      const view = win.AxiomHistoricalUI.inspect();
      assert(view.metadata.poolAddress === second && view.metadata.poolSelection === "user-selected-candidate", "Selected pool independently verified");
      assert(view.paneCount === 2 && view.volume?.length === 2, "Dedicated aligned provider-volume pane");
      assert(view.volume[0].value === 0 && !view.volume.some(row => row.time === view.candles[1].timestamp) && view.volume[1].value === 12.5, "Zero, missing and actual provider volume");
      assert(view.formattedPrice.includes("00000000000000000000000000000") && view.candles.length === 3, "Tiny prices readable without synthetic candles");
      assert(view.markers.length === 1 && view.markers[0].text === "Incomplete", "Incomplete current candle marked");
      assert(view.summary.missingIntervals === 12 && node("historyVolume").textContent === "12.5 USD" && node("historyCoverage").textContent.includes("Partial"), "Summaries explicitly partial");
      assert(node("historyIdentity").textContent.includes("selected base token") && node("historyTiming").textContent.includes("Candle interval: 1 minute"), "Identity, side and interval distinct from viewing period");
      assert(view.visibleRange.to - view.visibleRange.from < 900, "Short available history fitted");
      assert(node("historyResults").textContent.includes("Axiom-observed") && node("historyResults").textContent.includes("do not measure buy/sell"), "Trade counts and volume colors are not inferred");
    });
    await test("Chart zoom/reset and 15m/1h selection preserve aligned available data without new provider requests", async () => {
      node("historicalChart").scrollIntoView(); await pause(50);
      const before = win.AxiomHistoricalUI.inspect().visibleRange, logicalBefore = win.AxiomHistoricalUI.inspect().visibleLogicalRange, canvas = node("historicalChart").querySelectorAll("canvas")[1], rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new win.WheelEvent("wheel", {deltaY: -120, clientX: rect.x + 150, clientY: rect.y + 80, bubbles: true, cancelable: true})); await pause(60);
      const zoomed = win.AxiomHistoricalUI.inspect().visibleLogicalRange;
      assert(zoomed.from !== logicalBefore.from || zoomed.to !== logicalBefore.to, "Native chart wheel zoom works");
      node("historyFit").click(); await pause(30);
      const reset = win.AxiomHistoricalUI.inspect().visibleRange; assert(Math.abs(reset.from - before.from) < 1 && Math.abs(reset.to - before.to) < 1, "Reset fits available history");
      canvas.dispatchEvent(new win.MouseEvent("mouseenter", {clientX: rect.x + 150, clientY: rect.y + 80}));
      for (const ratio of [0.25, 0.5, 0.75]) {
        canvas.dispatchEvent(new win.MouseEvent("mousemove", {clientX: rect.x + rect.width * ratio, clientY: rect.y + 80, bubbles: true})); await pause(20);
        if (node("historyCursor").textContent.includes("volume:")) break;
      }
      assert(node("historyCursor").textContent.includes("volume:"), "Shared crosshair reports candle and provider volume together");
      const panBefore = win.AxiomHistoricalUI.inspect().visibleLogicalRange;
      canvas.dispatchEvent(new win.MouseEvent("mousedown", {clientX: rect.x + 150, clientY: rect.y + 80, button: 0, buttons: 1, bubbles: true}));
      doc.documentElement.dispatchEvent(new win.MouseEvent("mousemove", {clientX: rect.x + 200, clientY: rect.y + 80, button: 0, buttons: 1, bubbles: true})); await pause(20);
      doc.documentElement.dispatchEvent(new win.MouseEvent("mousemove", {clientX: rect.x + 300, clientY: rect.y + 80, button: 0, buttons: 1, bubbles: true}));
      doc.documentElement.dispatchEvent(new win.MouseEvent("mousemove", {clientX: rect.x + 450, clientY: rect.y + 80, button: 0, buttons: 1, bubbles: true}));
      doc.documentElement.dispatchEvent(new win.MouseEvent("mouseup", {clientX: rect.x + 300, clientY: rect.y + 80, button: 0, bubbles: true})); await pause(50);
      const panned = win.AxiomHistoricalUI.inspect().visibleLogicalRange;
      assert(panned.from !== panBefore.from || panned.to !== panBefore.to, "Native shared-time panning works");
      node("historyFit").click();
      const count = calls.length; node("historyRange").value = "3600"; node("historyRange").dispatchEvent(new win.Event("change"));
      assert(win.AxiomHistoricalUI.inspect().summary.expected === 60 && calls.length === count, "1h view recalculates without fetch");
      node("historyRange").value = "900"; node("historyRange").dispatchEvent(new win.Event("change"));
    });
    await test("Failed manual refresh retains only matching results and stale status survives view changes and export", async () => {
      mode = "network"; node("historyRefresh").click(); await settle();
      assert(win.AxiomHistoricalUI.inspect().stale && node("historyStatus").textContent.includes("Refresh failed"), "Failed refresh explicitly stale");
      node("historyRange").dispatchEvent(new win.Event("change")); assert(node("historyStatus").textContent.includes("stale"), "Rendering does not erase failure");
      const downloads = []; win.URL.createObjectURL = blob => { downloads.push(blob); return "blob:test"; }; win.HTMLAnchorElement.prototype.click = function() {};
      node("historyExport").click(); const csv = await downloads[0].text();
      assert(csv.includes("timestampUTC,intervalStatus,incomplete,tokenSide") && csv.includes("GeckoTerminal Public API") && csv.includes('"incomplete"'), "CSV has provenance, exact time, side and incomplete state");
      assert(win.AxiomHistoricalUI.inspect().candles.length === 3, "Matching previous history retained");
      offset += 61000; mode = "normal";
    });
    await test("Late provider candles cannot populate a changed pool selection, even if transport ignores cancellation", async () => {
      set(mint, pool); mode = "defer-candles"; release = null; submit(); await waitRelease();
      node("historyPool").value = third; input("historyPool"); const resume = release; mode = "normal"; resume(); await settle(); await pause(30);
      assert(node("historyResults").hidden && win.AxiomHistoricalUI.inspect().candles.length === 0, "Old pool response rejected");
      submit(); await settle(); assert(win.AxiomHistoricalUI.inspect().metadata.poolAddress === third, "New selected pool can load normally");
    });
    await test("Late candidate results cannot populate another token and quote-token selection uses quote OHLCV", async () => {
      offset += 61000; set(quote); mode = "defer-pools"; release = null; node("historyFindPools").click(); await waitRelease();
      node("historyMint").value = mint; input("historyMint"); const resume = release; mode = "normal"; resume(); await settle(); await pause(30);
      assert(node("historyCandidates").children.length === 0, "Late candidate list rejected");
      set(quote, pool); submit(); await settle();
      assert(win.AxiomHistoricalUI.inspect().metadata.tokenSide === "quote" && calls.at(-1).includes("token=quote"), "Correct selected quote token");
    });
    await test("Empty indexed history, malformed responses, access errors and rate limits remain explicit without automatic retry", async () => {
      mode = "empty"; node("historyRefresh").click(); await settle();
      assert(win.AxiomHistoricalUI.inspect().candles.length === 0 && node("historyExport").disabled && node("historyCoverage").textContent.includes("No indexed candles"), "Empty history is unavailable, not invented zeros");
      mode = "malformed"; node("historyRefresh").click(); await settle(); assert(node("historyStatus").textContent.includes("malformed JSON"), "Malformed provider response");
      mode = "403"; node("historyRefresh").click(); await settle(); assert(node("historyStatus").textContent.includes("HTTP 403"), "Access denied without alternate service");
      mode = "429"; node("historyRefresh").click(); await settle(); const count = calls.length;
      assert(node("historyStatus").textContent.includes("HTTP 429"), "Rate limiting state");
      await pause(100); assert(calls.length === count, "No automatic retry loop");
    });
    assert(!errors.length, errors.join("; "));
    document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests}); document.body.dataset.testStatus = "passed";
  } catch (error) {
    document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests, error: error.stack}); document.body.dataset.testStatus = "failed";
  }
})();
