globalThis.LiquidityAlertBrowserTests = {async run(test, assert, {doc, win, runtimeListeners, dispatchStorage}) {
  const H = win.AxiomLiquidityHistory, A = win.AxiomLiquidityAlerts;
  let clock = Date.now() - 70000;
  const recorder = H.createRecorder({sessionId: "alert-ui"}), engine = A.createEngine({now: () => clock});
  recorder.setContext({sourceKey: "alert-ui", blockchain: "solana", mintAddress: '<img src=x onerror="throw 1">', poolAddress: null});
  const context = recorder.context(), rows = [], read = (text = "$100") => {
    const row = {...recorder.sample(() => ({displayText: text, domReadAt: clock}), clock), sourceTabId: 7, deliveredAt: clock};
    rows.push(row); engine.observe(row, rows); clock += 5000; return row;
  };
  for (let i = 0; i < 12; i++) read(); for (let i = 0; i < 3; i++) read("$80"); clock -= 5000;
  const originalSend = win.chrome.runtime.sendMessage;
  let settingsSaves = 0;
  win.chrome.runtime.sendMessage = (message, callback) => {
    if (message.type === "AXIOM_LIQUIDITY_GET") callback({ok: true, saved: rows, live: [], activity: engine.view(context.tokenKey)});
    else if (message.type === "AXIOM_LIQUIDITY_ALERT_SETTINGS") { settingsSaves++; engine.setSettings(message.settings); callback({ok: true, activity: engine.view(context.tokenKey)}); }
    else originalSend(message, callback);
  };
  try {
    await test("Liquidity alerts show restored evidence without implying connectivity and safely render unresolved identity", () => {
      win.AxiomLiquidityUI.setContext(context);
      assert(doc.getElementById("liquidityAlertStatus").textContent === "Data delayed/unavailable", "Disk-only history is not live");
      const history = doc.getElementById("liquidityAlertHistory");
      assert(history.textContent.includes("Cause unverified") && history.textContent.includes("original trigger baseline"), "Cause and baseline scope explicit");
      assert(history.textContent.includes("pool unresolved") && history.textContent.includes("<img") && !history.querySelector("img"), "Unknown pool explicit and identity inert");
      assert(history.textContent.includes("actual interval 60s") && history.textContent.includes("100 → 80 USD") && history.textContent.includes("-20.00%"), "Evidence has actual values, time interval and change");
      assert(doc.getElementById("liquidityActiveRule").textContent.includes("3 consecutive fresh"), "Rule in plain language");
    });
    await test("Liquidity live rendering preserves one episode and displays stale confirmed state after interruption", () => {
      const deliver = row => runtimeListeners.forEach(fn => fn({type: "AXIOM_LIQUIDITY_LIVE", row, activity: engine.view(context.tokenKey)}, {id: "fixture"}));
      deliver({...rows.at(-1), deliveredAt: Date.now()});
      assert(doc.getElementById("liquidityAlertStatus").textContent === "Liquidity drop detected", "Live confirmed status");
      deliver({...rows.at(-1), deliveredAt: Date.now()}); assert(doc.getElementById("liquidityAlertHistoryCount").textContent === "1", "Duplicate cannot multiply episodes");
      const saved = engine.exportState(), restored = A.createEngine({now: () => Date.now()}); restored.restore(saved);
      win.AxiomLiquidityUI.applyActivity(restored.view(context.tokenKey), context.tokenKey);
      assert(doc.getElementById("liquidityAlertStatus").textContent === "Data delayed/unavailable" && doc.getElementById("liquidityAlertExplanation").textContent.includes("Last confirmed"), "Stale confirmed state retained");
    });
    await test("Liquidity rule editor rejects inconsistent thresholds, preserves form edits and applies validated settings", () => {
      const form = doc.getElementById("liquidityAlertForm"), submit = () => form.dispatchEvent(new win.Event("submit", {bubbles: true, cancelable: true}));
      doc.getElementById("alert-recoveryPercent").value = "21"; submit();
      assert(settingsSaves === 0 && doc.getElementById("liquidityAlertSettingsStatus").textContent.includes("below"), "Invalid hysteresis not sent");
      doc.getElementById("alert-recoveryPercent").value = "10"; doc.getElementById("alert-windowSeconds").value = "30";
      win.AxiomLiquidityUI.applyActivity(engine.view(context.tokenKey), context.tokenKey);
      assert(doc.getElementById("alert-windowSeconds").value === "30", "Rerender does not wipe unsaved form edits");
      submit(); assert(settingsSaves === 1 && doc.getElementById("liquidityActiveRule").textContent.includes("30 seconds"), "Saved rule displayed");
      assert(doc.getElementById("liquidityEpisodeRule").textContent.includes("original rule"), "Active episode keeps original recovery rule");
      assert(doc.getElementById("liquidityAlertSettingsStatus").textContent.includes("saved"), "Save feedback");
      dispatchStorage({latestSnapshot: {newValue: {stats: {}, liquidityContext: context, tokenInfo: {tiles: {lpBurned: {status: "available", displayText: "100%"}}}}}});
      assert(doc.getElementById("liquidityLPContext").textContent.includes("100%") && doc.getElementById("liquidityLPContext").textContent.includes("does not suppress"), "LP burned is separate context");
    });
    await test("Late liquidity responses and alert settings cannot populate another token", () => {
      let pending;
      win.chrome.runtime.sendMessage = (message, callback) => { if (message.type === "AXIOM_LIQUIDITY_GET") pending = callback; };
      win.AxiomLiquidityUI.setContext({...context, tokenKey: "late-a"}); const first = pending;
      win.AxiomLiquidityUI.setContext({...context, tokenKey: "late-b"});
      first({ok: true, saved: rows, live: rows, activity: engine.view(context.tokenKey)});
      win.AxiomLiquidityUI.applyActivity(engine.view(context.tokenKey), context.tokenKey);
      assert(win.AxiomLiquidityUI.inspect().rows.length === 0 && doc.getElementById("liquidityAlertHistoryCount").textContent === "0", "Late old-token data ignored");
    });
    await test("A new run on the same pool cannot inherit recent delivery or alert state from the preceding run", () => {
      win.chrome.runtime.sendMessage = (message, callback) => {
        if (message.type === "AXIOM_LIQUIDITY_GET") callback({ok: true, saved: rows, live: rows, activity: engine.view(context.tokenKey)});
      };
      win.AxiomLiquidityUI.setContext({...context, recordingId: "new-source-run"});
      assert(!win.AxiomLiquidityUI.inspect().connected && doc.getElementById("liquidityAlertStatus").textContent === "Data delayed/unavailable", "Previous-run delivery is historical");
      runtimeListeners.forEach(fn => fn({type: "AXIOM_LIQUIDITY_LIVE", row: {...rows.at(-1), deliveredAt: Date.now()}, activity: engine.view(context.tokenKey)}, {id: "fixture"}));
      assert(!win.AxiomLiquidityUI.inspect().connected, "Late old-run live message cannot restore connectivity");
    });
  } finally { win.chrome.runtime.sendMessage = originalSend; win.AxiomLiquidityUI.setContext(null); }
}};
