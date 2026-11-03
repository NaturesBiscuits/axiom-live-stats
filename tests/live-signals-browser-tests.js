(async () => {
  "use strict";
  const tests = [], errors = [], assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (check, message) => { for (let n = 0; n < 100; n++) { if (check()) return; await pause(20); } throw new Error(message); };
  const test = async (name, action) => { await action(); tests.push(name); };
  const context = {sourceKey: "signals-browser", blockchain: "sol", mintAddress: "fixture-mint"};
  const key = AxiomLiveSignals.identity(context, 42, "USD");
  let clock = Date.now(), saved = null, permission = false, permissionRequests = 0, copied = null;
  const service = AxiomLiveSignalService.createService({archive: {load: async () => saved, save: async value => { saved = structuredClone(value); }}, now: () => clock, hasPermission: async () => permission});
  const input = (at, value = 100) => ({key, context, sourceTabId: 42, currency: "USD", title: '<img src=x onerror="throw 1">', observedAt: at, evaluatedAt: at, sampledAt: at,
    observationId: String(at), eventTime: null, price: {value, currency: "USD", observedAt: at}, latency: {sourceToEvaluationMs: 0},
    provenance: "Axiom DOM", trading: {summary: null, observedAt: null, filters: null}, liquidity: {summary: null, activity: null}, holders: null, tokenInfo: null});
  let win, doc, ui, listeners;
  const node = id => doc.getElementById(id);
  try {
    const frame = document.createElement("iframe"); frame.style.cssText = "width:1100px;height:900px";
    frame.srcdoc = (await (await fetch("../dashboard.html")).text()).replace(/<script[^>]*><\/script>/g, "").replace('href="dashboard.css"', 'href="../dashboard.css"');
    const loaded = new Promise(resolve => frame.onload = resolve); document.body.append(frame); await loaded;
    win = frame.contentWindow; doc = frame.contentDocument; listeners = [];
    win.addEventListener("error", e => errors.push(e.message)); win.addEventListener("unhandledrejection", e => errors.push(String(e.reason)));
    win.chrome = {runtime: {onMessage: {addListener: fn => listeners.push(fn)}, sendMessage(message, callback) {
      const run = async () => {
        if (message.type === "AXIOM_SIGNALS_SETTINGS") await service.settings(message.settings);
        if (message.type === "AXIOM_SIGNALS_POSITION") await service.position(message.key, message.position);
        if (message.type === "AXIOM_SIGNALS_CLOSE") await service.closePosition(message.key);
        if (message.type === "AXIOM_SIGNALS_NOTIFICATIONS") await service.notifications(message.enabled);
        if (message.type === "AXIOM_SIGNALS_EXPORT") return service.export();
        return service.status(message.sourceKey === context.sourceKey ? key : "@waiting");
      };
      run().then(value => callback({ok: true, ...value}), error => callback({ok: false, error: error.message}));
    }}, permissions: {request: async () => { permissionRequests++; permission = true; return true; }}};
    Object.defineProperty(win.navigator, "clipboard", {value: {writeText: async text => { copied = text; }}, configurable: true});
    const script = file => new Promise((resolve, reject) => { const item = doc.createElement("script"); item.src = new URL(file, location.href).href; item.onload = resolve; item.onerror = reject; doc.head.append(item); });
    await script("../liveSignals.js"); await script("../liveSignalsDashboard.js"); ui = win.AxiomLiveSignalsUI;
    await test("Signals start with insufficient data, no fabricated position and no notification request", async () => {
      ui.setSnapshot({chartContext: context}, 42); await pause(40);
      assert(node("signalsStrength").textContent === "Insufficient data", "No invented score");
      assert(node("signalsLogPosition").disabled && node("signalsPosition").textContent.includes("No tracked position"), "No invented entry/PnL");
      assert(permissionRequests === 0, "Notifications never request permission on startup");
    });
    await test("Fresh observations render available conditions, factors and unknown checks as inert text", async () => {
      await service.observe(input(clock)); ui.setSnapshot({chartContext: context}, 42);
      await until(() => ui.inspect()?.current, "Fresh input displayed");
      assert(node("signalsStrength").textContent === "Insufficient data" && node("signalsConditions").textContent.includes("unavailable".toUpperCase()), "Required missing inputs are explicit");
      assert(!node("signalsLogPosition").disabled && !node("signalsDiagnostics").querySelector("img"), "Manual entry enabled without executing source text");
    });
    await test("Paper position entry is explicit and freezes its exit plan through profile edits", async () => {
      node("signalsEntryPrice").value = "100"; node("signalsCurrency").value = "USD";
      const local = new Date(clock - 1000); node("signalsEntryTime").value = new Date(local - local.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
      node("signalsSize").value = "2"; node("signalsPositionForm").dispatchEvent(new win.Event("submit", {cancelable: true}));
      await until(() => ui.inspect()?.position, "Paper position created");
      assert(node("signalsPosition").textContent.includes("PAPER") && node("signalsPosition").textContent.includes("Unavailable"), "Explicit mode and unknown pre-observation PnL");
      node("signalsParameters").querySelector('[data-parameter="stopLossPct"]').value = "9";
      node("signalsSettingsForm").dispatchEvent(new win.Event("submit", {cancelable: true}));
      await until(() => ui.inspect()?.settings.stopLossPct === 9, "Profile updated");
      assert(ui.inspect().position.settings.stopLossPct === 5, "Existing plan does not silently change");
    });
    await test("Notification permission is opt-in and evaluation JSONL uses the actual retained data", async () => {
      node("signalsNotifications").checked = true; node("signalsNotifications").dispatchEvent(new win.Event("change"));
      await until(() => ui.inspect()?.notifications, "Opt-in enabled"); assert(permissionRequests === 1, "Single explicit permission request");
      node("signalsExport").click(); await until(() => copied !== null, "Export copied");
      assert(copied.includes("axiom-paper-evaluation-v1") && copied.includes('"type":"observation"'), "Retained evidence exported");
    });
    await test("Another source or tab cannot overwrite the selected signal/position display", async () => {
      const wrong = await service.status(key); wrong.key = AxiomLiveSignals.identity(context, 99, "USD");
      for (const listener of listeners) listener({type: "AXIOM_SIGNALS_STATE", ...wrong});
      assert(ui.inspect().key === key, "Other-tab broadcast ignored");
      ui.setSnapshot({chartContext: {...context, sourceKey: "other-token"}}, 42); await pause(40);
      assert(!ui.inspect()?.current && node("signalsLogPosition").disabled, "Token switch clears old current input and position");
    });
    assert(!errors.length, errors.join("; ")); document.body.dataset.testStatus = "passed";
    document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests});
  } catch (error) { document.body.dataset.testStatus = "failed"; document.getElementById("results").textContent = JSON.stringify({passed: tests.length, tests, error: error.stack}); }
})();
