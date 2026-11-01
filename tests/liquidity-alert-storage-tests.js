globalThis.runLiquidityAlertStorageChecks = async (phase, checks, archive) => {
  const H = AxiomLiquidityHistory, A = AxiomLiquidityAlerts;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  if (phase === "write") {
    let clock = Date.now() - 90000;
    const engine = A.createEngine({now: () => clock}), recorder = H.createRecorder({sessionId: "storage-alerts"});
    recorder.setContext({sourceKey: "storage-alerts", blockchain: "solana", mintAddress: "mint", poolAddress: "pool"});
    const rows = [];
    for (let i = 0; i <= 14; i++) {
      const row = {...recorder.sample(() => ({displayText: i < 12 ? "$100" : "$80", domReadAt: clock}), clock), sourceTabId: 7};
      rows.push(row); engine.observe(row, rows); if (i < 14) clock += 5000;
    }
    engine.setSettings({dropPercent: 21});
    const settingsBefore = await archive.getSettings(); await archive.write(rows);
    await archive.setMeta("activity-v1", engine.exportState());
    await archive.setMeta("alert-test-context", {tokenKey: rows[0].tokenKey, settingsBefore});
    const saved = await archive.getMeta("activity-v1");
    assert(saved.history.length === 1 && saved.history[0].rule.dropPercent === 20 && saved.settings.dropPercent === 21, "Rule edits preserve original episode evidence");
    assert(JSON.stringify(settingsBefore) === JSON.stringify(await archive.getSettings()), "Alert settings do not overwrite liquidity archive settings");
    checks.push("alert native metadata persistence and original rule", "liquidity archive settings preserved");
  } else {
    const context = await archive.getMeta("alert-test-context"), saved = await archive.getMeta("activity-v1");
    let clock = saved.history[0].evidence.currentAt;
    const engine = A.createEngine({now: () => clock}); engine.restore(saved);
    const prior = engine.view(context.tokenKey);
    assert(prior.history.length === 1 && prior.states[0].status === "Data delayed/unavailable", "Browser process restart restores history, never live connectivity");
    assert(prior.settings.dropPercent === 21 && prior.history[0].rule.dropPercent === 20, "Browser restart retains global and episode rules separately");
    const rows = (await archive.readLatest(context.tokenKey, "liquidity", null, {allUnits: true})).samples;
    assert(rows.length === 15 && rows.at(-1).continuityId, "Original liquidity recording is reused, without another collector or sample store");
    assert(!engine.observe(rows.at(-1), rows).changed, "Reloaded stored endpoint cannot advance confirmation");
    const last = rows.at(-1), make = () => ({...last, value: 85, displayText: "$85", timestamp: Math.floor(clock / 1000), sampledAt: clock, domReadAt: clock, observedAt: clock});
    clock += 5000; rows.push(make()); engine.observe(rows.at(-1), rows);
    assert(engine.view(context.tokenKey).history[0].recoveredAt === null, "One fresh recovery sample after reload is insufficient");
    clock += 5000; rows.push(make()); engine.observe(rows.at(-1), rows);
    assert(engine.view(context.tokenKey).history[0].recoveredAt === clock, "Two new recovery attempts recover the same episode");
    await archive.setMeta("activity-v1", engine.exportState()); const second = A.createEngine({now: () => clock}); second.restore(await archive.getMeta("activity-v1"));
    assert(second.view(context.tokenKey).history.length === 1 && second.view(context.tokenKey).history[0].recoveredAt === clock, "Recovered episode upserts without duplicate history");
    const unrelatedBefore = await archive.stats();
    const event = engine.exportState().history[0];
    second.restore({...saved, history: Array.from({length: 220}, (_, i) => ({...event, id: `retention-${i}`, updatedAt: clock - i}))});
    await archive.setMeta("activity-v1", second.exportState()); assert((await archive.getMeta("activity-v1")).history.length === 200, "Persisted episode cap is 200");
    clock += A.RETENTION_MS + 1; await archive.setMeta("activity-v1", second.exportState());
    assert((await archive.getMeta("activity-v1")).history.length === 0, "Expired alert history is removed from persisted metadata");
    assert((await archive.stats()).count === unrelatedBefore.count, "Alert pruning cannot remove liquidity samples");
    checks.push("alert browser restart evidence and stale state", "alert restored observation deduplication", "alert recovery and native upsert",
      "alert native age/count retention", "liquidity observations preserved by alert pruning");
  }
};
