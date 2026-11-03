async function runLiveSignalStorageChecks(phase, checks) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const archive = AxiomLiveSignalArchive.createArchive({databaseName: "axiom-live-signals-restart-fixture"});
  const now = Date.now(), key = AxiomLiveSignals.identity({sourceKey: "storage-signals"}, 42, "USD");
  try {
    if (phase === "write") {
      const engine = AxiomLiveSignals.createEngine({now: () => now});
      engine.observe({key, context: {sourceKey: "storage-signals"}, sourceTabId: 42, currency: "USD", observedAt: now, evaluatedAt: now,
        observationId: "storage-reading", eventTime: null, price: {value: 0.000000123456789, observedAt: now}, latency: {},
        trading: {summary: null, observedAt: null, filters: null}, liquidity: {summary: null, activity: null}, holders: null, tokenInfo: null});
      engine.openPosition(key, {mode: "paper", entryPrice: 0.000000123456789, currency: "USD", entryAt: now - 1000, size: 100,
        exits: {stopLossPct: 7, takeProfitPct: 11}});
      await archive.save({engine: engine.exportState(), notifications: false, notified: [], lastNotifiedAt: null});
      const saved = await archive.load();
      assert(saved.engine.journal.length === 1 && saved.engine.positions[0].settings.stopLossPct === 7, "Atomic journal/position/settings persistence");
      checks.push("signals atomic evidence and position plan", "signals exact stored numeric price");
    } else {
      const saved = await archive.load(), engine = AxiomLiveSignals.createEngine({now: () => now}); engine.restore(saved.engine);
      const view = engine.view(key);
      assert(view.interrupted && !view.current && view.position.entryPrice === 0.000000123456789, "Restart preserves position without inventing a live observation");
      assert(view.position.settings.takeProfitPct === 11 && view.position.pnlPct === null, "Original plan and unknown post-restart PnL");
      assert(engine.exportState().journal[0].observationId === "storage-reading" && engine.exportState().journal[0].observedAt > 0, "Original observation ID and time survive restart");
      checks.push("signals native browser restart", "signals frozen plan and interrupted freshness");
      const expired = AxiomLiveSignals.createEngine({now: () => now + 2 * AxiomLiveSignals.LIMITS.retentionMs}); expired.restore(saved.engine);
      await archive.save({...saved, engine: expired.exportState()}); assert((await archive.load()).engine.journal.length === 0, "Retention deletes expired journal rows from native storage");
      checks.push("signals native journal retention");
    }
  } finally { archive.close(); }
}
