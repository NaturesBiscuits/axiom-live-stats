(async () => {
  "use strict";
  const checks = [], errors = [], assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const test = async (name, run) => { await run(); checks.push(name); document.getElementById("results").textContent = JSON.stringify({passed: checks.length, running: name}); };
  const address = n => "0x" + n.toString(16).padStart(40, "0");
  const context = {sourceKey: "bundler-ui-a", routeKey: "route-a", blockchain: "eth", mintAddress: address(900)};
  const now = Date.now(), callbacks = []; let frame, win, doc, ui;
  const snapshot = () => ({tokenKey: "route-a", chartContext: context, marketObservedAt: now, stats: {bundlers: "12.5%"},
    holdersIntelligence: {tokenKey: "route-a", context, extractedAt: now, extractionId: "ui-a", activeTable: {kind: "holders"}, tableStatus: "available",
      rows: Array.from({length: 10}, (_, i) => ({rank: String(i + 1), walletAddress: address(i + 1), identityStatus: "resolved",
        walletDisplay: "Wallet " + (i + 1), nativeBalance: "0.03", balanceCurrency: "ETH", boughtAmount: "$25", remainingPercentage: "1%",
        axiomBundler: false, tokenContext: context, observedAt: now, extractionId: "ui-a"}))}});
  const load = (name) => new Promise((resolve, reject) => { const script = doc.createElement("script"); script.src = new URL(name, location.href); script.onload = resolve; script.onerror = reject; doc.head.append(script); });
  try {
    const html = await (await fetch("../dashboard.html")).text();
    frame = document.createElement("iframe"); frame.style.cssText = "width:1200px;height:900px";
    frame.srcdoc = html.replace(/<script[^>]*><\/script>/g, "").replace('href="dashboard.css"', 'href="../dashboard.css"');
    const loaded = new Promise(resolve => frame.onload = resolve); document.body.append(frame); await loaded;
    win = frame.contentWindow; doc = frame.contentDocument;
    win.addEventListener("error", event => errors.push(event.message));
    win.chrome = {runtime: {sendMessage(message, callback) { callbacks.push({message, callback}); }}};
    await load("../holderTableExtractor.js"); await load("../bundlerDetection.js"); await load("../bundlerDashboard.js"); ui = win.AxiomBundlerUI;
    await test("Separate panel shows suspicion, Axiom classification, ratios and supporting wallet values", () => {
      ui.setSnapshot(snapshot(), 42);
      assert(doc.getElementById("bundlerScore").textContent === "35%", "Weighted local score");
      assert(doc.getElementById("bundlerAxiomReported").textContent === "12.5%", "Axiom value stays separate");
      assert(doc.getElementById("bundlerSignals").textContent.includes("10 / 10"), "Per-signal denominator shown");
      assert(doc.getElementById("bundlerGroups").textContent.includes("0.03 ETH") && doc.getElementById("bundlerGroups").textContent.includes(address(1)), "Values and full addresses exposed");
      assert(doc.getElementById("bundlerMethod").textContent.includes("not renormalized"), "Scoring method inspectable");
      doc.getElementById("bundlerGroups").querySelector("details").open = true;
      ui.setSnapshot(snapshot(), 42);
      assert(doc.getElementById("bundlerGroups").querySelector("details").open, "Evidence stays expanded across updates");
    });
    await test("Supplied screenshot patterns show ETH balance and short funding-label ratios without merging wallets", () => {
      const snap = snapshot(), balances = ["1.973", "0.27", "0.27", "0.27", "0.27", "0.15", "0.27", "0.15", "0.27"];
      snap.holdersIntelligence.rows = balances.map((balance, i) => ({...snap.holdersIntelligence.rows[i], walletAddress: null,
        identityStatus: "unresolved", walletDisplay: `0x${i}...abcd`, nativeBalance: balance,
        boughtAmount: `$${i + 1}`, remainingPercentage: `${i + 6}%`, fundingSourceLabel: i ? "0xbae5...4d81" : "0x3616...4d50"}));
      ui.setSnapshot(snap, 42); const result = ui.inspect(), balance = result.signals.find(item => item.id === "balances");
      assert(balance.groups.find(group => group.value === "0.27 ETH").count === 6, "Six repeated 0.27 ETH observations");
      assert(Math.abs(balance.percentage - 8 / 9 * 100) < 1e-8, "8/9 repeated balance rows, including pair");
      assert(result.coverage.identifiedWallets === 0 && result.duplicateAddresses.length === 0 && result.score <= 45, "Short labels do not establish independent wallet identities");
      assert(doc.getElementById("bundlerGroups").textContent.includes("0xbae5...4d81"), "Repeated funding label visible");
    });
    await test("Source text remains inert and duplicate full addresses are listed without risk inflation", () => {
      const snap = snapshot(), first = snap.holdersIntelligence.rows[0];
      first.walletDisplay = '<img src=x onerror="throw 1">'; first.fundingSourceLabel = '<script>throw 1</script>';
      snap.holdersIntelligence.rows = Array.from({length: 10}, () => ({...first})); ui.setSnapshot(snap, 42);
      assert(ui.inspect().coverage.analyzedRows === 1 && ui.inspect().score === 0, "Duplicate source rows counted once");
      assert(doc.getElementById("bundlerDuplicates").textContent.includes(address(1)) && doc.getElementById("bundlerDuplicates").textContent.includes("10 DOM"), "Duplicate address/count shown");
      assert(!doc.getElementById("bundlerGroups").querySelector("img,script"), "Untrusted text cannot create elements");
    });
    await test("Late results from another source cannot overwrite the selected token", () => {
      const prior = callbacks[0], next = snapshot(); next.chartContext = {...context, sourceKey: "other-token"}; next.holdersIntelligence = null;
      ui.setSnapshot(next, 99);
      prior.callback({ok: true, result: win.AxiomBundlerDetection.analyze({snapshot: snapshot(), now: Date.now(), sourceTabId: 42})});
      assert(ui.inspect().context.sourceKey === "other-token" && ui.inspect().score === null, "Late prior-source result ignored");
    });
    await test("Worker results supply trade evidence and stale source data clears percentages", () => {
      const snap = snapshot(); ui.setSnapshot(snap, 42);
      const request = callbacks.at(-1), response = win.AxiomBundlerDetection.analyze({snapshot: snap, sourceTabId: 42});
      response.score = 40; request.callback({ok: true, result: response});
      assert(doc.getElementById("bundlerScore").textContent === "40%", "Matching worker response renders");
      ui.setSnapshot({...snap, marketObservedAt: Date.now() - 11000}, 42);
      assert(doc.getElementById("bundlerScore").textContent === "Unavailable" && doc.getElementById("bundlerStatus").textContent.includes("stale"), "Stale source has no risk percentage");
    });
    assert(!errors.length, errors.join("; ")); await pause(10);
    document.body.dataset.testStatus = "passed"; document.getElementById("results").textContent = JSON.stringify({passed: checks.length, tests: checks});
  } catch (error) { document.body.dataset.testStatus = "failed"; document.getElementById("results").textContent = JSON.stringify({passed: checks.length, tests: checks, error: error.stack}); }
})();
