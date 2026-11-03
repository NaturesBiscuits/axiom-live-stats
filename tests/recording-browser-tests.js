(async () => {
  "use strict";
  const tests = [], errors = [], assert = (value, message) => { if (!value) throw new Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (check, message) => { for (let i = 0; i < 100; i++) { if (check()) return; await pause(20); } throw new Error(message); };
  const test = async (name, run) => { document.getElementById("results").textContent = JSON.stringify({passed: tests.length, running: name}); await run(); tests.push(name); };
  const context = {sourceKey: "record-browser-a", routeKey: "route-a", blockchain: "eth", mintAddress: "0x" + "1".repeat(40)};
  let clock = Date.now() - 5000, latest, frame, win, doc, ui, listeners, copied = null, forceError = false;
  const archive = AxiomAnalysisRecordingArchive.createArchive({databaseName: "axiom-recording-ui-fixture"});
  const service = AxiomAnalysisRecorder.createService({archive, now: () => clock});
  const data = at => ({title: 'Test <img src=x onerror="throw 1">', chartContext: context, marketObservedAt: at,
    stats: {price: "$2", marketCap: "$999", supply: "9007199254740993"}, supplyValuation: {fields: Object.fromEntries(
      [["price", "$2"], ["marketCap", "$999"], ["displayedSupply", "9007199254740993"], ["totalSupply", "150"]].map(([key, raw]) => [key, AxiomSupply.observation(key, raw, {context, observedAt: at})]))}});
  const script = (target, name) => new Promise((resolve, reject) => { const item = target.createElement("script"); item.src = new URL(name, location.href).href; item.onload = resolve; item.onerror = reject; target.head.append(item); });
  function sendState(result) { for (const listener of listeners) listener({type: "AXIOM_RECORDING_STATE", session: result.session}); }
  async function mount() {
    frame?.remove(); frame = document.createElement("iframe"); frame.style.cssText = "width:1100px;height:800px";
    const html = await (await fetch("../dashboard.html")).text();
    frame.srcdoc = html.replace(/<script[^>]*><\/script>/g, "").replace('href="dashboard.css"', 'href="../dashboard.css"');
    const loaded = new Promise(resolve => frame.onload = resolve); document.body.append(frame); await loaded;
    win = frame.contentWindow; doc = frame.contentDocument; listeners = [];
    win.addEventListener("error", event => errors.push(event.message)); win.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
    win.chrome = {runtime: {onMessage: {addListener: fn => listeners.push(fn)}, sendMessage(message, callback) {
      const run = async () => {
        if (forceError && message.type === "AXIOM_RECORDING_START") throw new Error("Recording fixture storage error");
        if (message.type === "AXIOM_RECORDING_START") return service.start(latest, {sourceTabId: 42, scope: message.scope, intervalMs: message.intervalMs});
        if (message.type === "AXIOM_RECORDING_STOP") return service.stop();
        if (message.type === "AXIOM_RECORDING_REPORT") return service.report();
        return service.status();
      };
      run().then(result => { callback({ok: true, ...result}); if (["AXIOM_RECORDING_START", "AXIOM_RECORDING_STOP"].includes(message.type)) sendState(result); }, error => callback({ok: false, error: error.message}));
    }}};
    await script(doc, "../analysisRecordingDashboard.js"); ui = win.AxiomRecordingUI;
    await pause(40); if (latest) ui.setSnapshot(latest);
  }
  const node = id => doc.getElementById(id);
  try {
    await test("Recording starts disabled without a fresh source, with all analyzer summaries as default", async () => {
      await mount(); assert(node("recordingStart").disabled && node("recordingStop").disabled, "No source cannot record");
      assert(node("recordingScope").value === "all" && node("recordingInterval").value === "5000", "Default summaries and interval");
      ui.setSnapshot(data(Date.now() - 11000)); assert(node("recordingStart").disabled, "Stale snapshot cannot enable Start");
      latest = data(clock); ui.setSnapshot(latest); assert(!node("recordingStart").disabled, "Recent observation enables Start");
      assert(node("recordingPrice").textContent === "$2" && node("recordingPriceLabel").textContent.includes("before recording"), "Price preview appears in the recording panel before Start");
    });
    await test("Start persists the first entry and fresh snapshots follow the selected cadence", async () => {
      node("recordingStart").click(); await until(() => ui.inspect().session?.state === "recording", "Start should complete");
      assert(node("recordingStart").disabled && !node("recordingStop").disabled && node("recordingInterval").disabled, "Recording controls");
      assert(/Elapsed recording time: \d{2}:\d{2}:\d{2}/.test(node("recordingDuration").textContent), "Live hours/minutes/seconds timer");
      const elapsed = node("recordingDuration").textContent;
      await pause(1100);
      assert(node("recordingDuration").textContent !== elapsed, "Timer advances without new source observations");
      clock = Date.now(); latest = data(clock); ui.setSnapshot(latest);
      latest.stats.price = "$3"; ui.setSnapshot(latest);
      assert(node("recordingPrice").textContent === "$2" && node("recordingPriceLabel").textContent.includes("at start"), "Starting price stays fixed while live price changes");
      const result = await service.observe(latest, 42, clock); sendState(result);
      await until(() => ui.inspect().session.count === 2, "Second actual entry");
      assert((await archive.load()).rows.length === 2, "Native IDB contains both entries");
    });
    await test("Stop produces an inert, copyable report with observation times and independent figures", async () => {
      node("recordingStop").click(); await until(() => ui.inspect().output.includes("END OF RECORDING"), "Report should be produced");
      const text = node("recordingOutput").value;
      const stopped = ui.inspect().session, durationMs = stopped.endedAt - stopped.startedAt;
      assert(node("recordingEndPrice").textContent === "$3", "Ending price appears in the recording panel after Stop");
      assert(node("recordingDuration").textContent.startsWith("Recorded duration: ") && text.includes(node("recordingDuration").textContent), "Final duration shown and included in copied report");
      assert(text.includes(`Started (UTC): ${new Date(stopped.startedAt).toISOString()}`) && text.includes(`Ended (UTC): ${new Date(stopped.endedAt).toISOString()}`) && text.includes(`\"durationMs\":${durationMs}`), "Start/end timestamps and exact duration retained");
      assert(node("recordingOutput").readOnly && !node("recordingCopy").disabled && !node("recordingOutputCopy").disabled && node("recordingOutputDetails").open, "Report view and both Copy buttons ready");
      assert(text.includes('"marketCap":"$999"') && text.includes('"normalizedValue":"300"') && text.includes("9007199254740993"), "Raw cap and exact calculation remain separate");
      assert(text.includes("SAMPLE CLOCK") && text.includes("loggedMs") && text.includes("observedMs") && text.includes("null means unavailable"), "Timestamped output explains missing data");
      assert(text.includes("untrusted source data") && !node("recordingOutputDetails").querySelector("img"), "Source markup cannot execute");
      assert(node("recordingStart").textContent === "Start new recording", "Previous report replacement is explicit");
      const finalDuration = node("recordingDuration").textContent;
      await pause(1100);
      assert(node("recordingDuration").textContent === finalDuration && node("recordingPrice").textContent === "$2", "Stopped duration and starting price stay visible and fixed");
    });
    await test("Copy uses the clipboard and a denied clipboard selects the report for manual copying", async () => {
      Object.defineProperty(win.navigator, "clipboard", {configurable: true, value: {writeText: async value => { copied = value; }}});
      node("recordingOutputCopy").click(); await until(() => copied !== null, "Report-adjacent Copy should invoke clipboard"); assert(copied === ui.inspect().output, "Exact complete report copied");
      Object.defineProperty(win.navigator, "clipboard", {configurable: true, value: {writeText: async () => { throw new Error("Denied"); }}});
      node("recordingCopy").click(); await until(() => node("recordingStatus").textContent.includes("Ctrl+C"), "Manual fallback guidance");
      assert(node("recordingOutput").selectionEnd === copied.length && node("recordingOutput").selectionStart === 0, "Whole report selected");
    });
    await test("Reopening the dashboard restores the completed report without active recording or HTML execution", async () => {
      const previous = ui.inspect().output; await mount(); await until(() => ui.inspect().output.length > 0, "Saved report hydration");
      assert(previous.includes(node("recordingDuration").textContent), "Restored duration stays fixed at Stop");
      assert(ui.inspect().output === previous && node("recordingStop").disabled, "Completed output survives reopening");
      assert(node("recordingPrice").textContent === "$2", "Starting price survives reopening");
      assert(node("recordingEndPrice").textContent === "$3", "Ending price survives reopening");
      assert(!node("recordingOutputDetails").querySelector("img"), "Saved source text remains inert");
    });
    await test("Automatic token-switch stop produces a report and late active status cannot revive the recording", async () => {
      latest = data(clock); ui.setSnapshot(latest); node("recordingStart").click(); await until(() => ui.inspect().session?.state === "recording", "New Start");
      const oldState = structuredClone(ui.inspect().session);
      const result = await service.observe({...latest, chartContext: {...context, sourceKey: "other"}}, 42, clock + 1000); sendState(result);
      await until(() => ui.inspect().output.includes("source-token-or-network-changed"), "Automatic stopped report");
      sendState({session: oldState}); assert(ui.inspect().session.state === "stopped", "Older active notification ignored");
    });
    await test("Failed Start keeps the completed output available with a clear storage error", async () => {
      const previous = ui.inspect().output; forceError = true; node("recordingStart").click();
      await until(() => node("recordingStatus").textContent.includes("fixture storage error"), "Start error shown");
      assert(ui.inspect().output === previous && !node("recordingCopy").disabled, "Previous report not discarded");
    });
    assert(!errors.length, errors.join("; ")); archive.close(); document.body.dataset.testStatus = "passed";
    document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests});
  } catch (error) { archive.close(); document.body.dataset.testStatus = "failed"; document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests, error: error.stack}); }
})();
