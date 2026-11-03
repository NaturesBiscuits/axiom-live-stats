(() => {
  "use strict";
  const library = () => globalThis.AxiomLiveSignals ?? require("./liveSignals.js");
  function createService({archive, now = Date.now, notify = async () => {}, hasPermission = async () => false, onUpdate = () => {}} = {}) {
    const S = library(), engine = S.createEngine({now});
    let loaded = false, queue = Promise.resolve(), error = null, notificationError = null, notifications = false, notified = [], lastNotifiedAt = -Infinity;
    const run = action => { const next = queue.catch(() => {}).then(async () => {
      if (!loaded) { const saved = await archive.load(); if (saved) { engine.restore(saved.engine); notifications = saved.notifications === true; notified = saved.notified ?? []; lastNotifiedAt = saved.lastNotifiedAt ?? -Infinity; } loaded = true; }
      return action();
    }); queue = next; return next; };
    const status = key => ({...engine.view(key), storageError: error, notifications, notificationError});
    async function save() {
      try { await archive.save({engine: engine.exportState(), notifications, notified: notified.slice(-500), lastNotifiedAt: Number.isFinite(lastNotifiedAt) ? lastNotifiedAt : null}); error = null; }
      catch (failure) { error = failure.message; }
    }
    return {status: key => run(() => status(key)),
      observe: input => run(async () => {
        input = {...input, evaluatedAt: now(), latency: {...input.latency, sourceToEvaluationMs: now() - input.observedAt}};
        const previous = new Set(engine.view().history.map(e => e.id)), result = engine.observe(input);
        if (!result.changed) return null;
        await save();
        onUpdate(status(input.key));
        let notificationChanged = false;
        for (const event of engine.view().history.filter(e => !previous.has(e.id) && (["buy-trigger", "sell-trigger"].includes(e.type) || e.type.startsWith("risk-warning:")) && !e.outdated)) {
          if (!notifications || notified.includes(event.id)) continue;
          // Persist suppression before delivery; a failed worker restart cannot flood old alerts.
          notified.push(event.id);
          notificationChanged = true;
          if (now() - lastNotifiedAt < 60000 || now() - event.triggeredAt > 15000) continue;
          lastNotifiedAt = now(); await save();
          if (error) break;
          try { if (await hasPermission()) await notify(event); else { notifications = false; notificationError = "Notification permission is not enabled."; } }
          catch (failure) { notificationError = failure.message; }
        }
        if (notificationChanged) await save(); return status(input.key);
      }),
      settings: values => run(async () => { engine.setSettings(values); await save(); return status(); }),
      position: (key, values) => run(async () => { engine.openPosition(key, values); await save(); return status(key); }),
      closePosition: key => run(async () => { engine.closePosition(key); await save(); return status(key); }),
      interrupt: tab => run(async () => { engine.interrupt(tab); await save(); return status(); }),
      notifications: enabled => run(async () => { if (enabled && !await hasPermission()) throw new Error("Enable notification permission from the dashboard first."); notifications = enabled === true; await save(); return status(); }),
      export: () => run(() => {
        const saved = engine.exportState(), rows = [...saved.events, ...saved.journal].sort((a, b) => a.evaluatedAt - b.evaluatedAt);
        return {text: [JSON.stringify({format: "axiom-paper-evaluation-v1", exportedAt: now(), retention: S.LIMITS,
          positions: saved.positions, note: "Chronological DOM observations and informational signals. Partial coverage; no executions or profitability claim. Retention can remove early/future endpoints."}),
          ...rows.map(row => JSON.stringify(row)), ...S.outcomes(saved.events, saved.journal).map(row => JSON.stringify({type: "outcome-inspection", ...row}))].join("\n")};
      })};
  }
  const api = {createService}; globalThis.AxiomLiveSignalService = Object.freeze(api); if (typeof module !== "undefined") module.exports = api;
})();
