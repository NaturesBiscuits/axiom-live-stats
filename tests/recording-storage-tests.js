async function runRecordingStorageChecks(phase, checks) {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const archive = AxiomAnalysisRecordingArchive.createArchive({databaseName: "axiom-recording-restart-fixture"});
  const context = {sourceKey: "native-recording", blockchain: "eth", mintAddress: "0x" + "1".repeat(40)};
  let clock = Date.now() - 5000;
  const snapshot = () => ({title: "Native recording", chartContext: context, marketObservedAt: clock, stats: {marketCap: "$999"}, supplyValuation: {fields: {
    price: AxiomSupply.observation("price", "$0.1", {context, observedAt: clock}),
    totalSupply: AxiomSupply.observation("totalSupply", "9007199254740993", {context, observedAt: clock})}}});
  try {
    const service = AxiomAnalysisRecorder.createService({archive, now: () => clock});
    if (phase === "write") {
      await service.start(snapshot(), {sourceTabId: 42, intervalMs: 5000, scope: "all"}); clock += 5000;
      await service.observe(snapshot(), 42, clock);
      const saved = await archive.load();
      assert(saved.session.count === 2 && saved.rows.length === 2 && saved.rows[1].sequence === 2, "Metadata and sequence rows commit atomically"); checks.push("manual recording atomic metadata/entries");
      assert(saved.rows[0].supplyAndValuation.observations.totalSupply.normalizedValue === "9007199254740993", "Exact strings persist"); checks.push("manual recording exact decimal strings");
      assert(saved.rows[0].supplyAndValuation.calculations[1].normalizedValue === "900719925474099.3", "Calculated strings persist"); checks.push("manual recording precise valuation persistence");
    } else {
      const result = await service.report(), saved = await archive.load();
      assert(result.session.count === 2 && saved.rows.length === 2, "Actual browser restart retains recording"); checks.push("manual recording browser restart entries");
      assert(result.session.state === "stopped" && result.session.stopReason.includes("interrupted") && result.session.endedAt === saved.rows[1].loggedAt, "Interrupted state is honest"); checks.push("manual recording interruption and original times");
      assert(result.text.includes("900719925474099.3") && result.text.includes("9007199254740993"), "Copyable output preserves precision"); checks.push("manual recording restored report precision");
      clock = Date.now(); await service.start(snapshot(), {sourceTabId: 42, intervalMs: 15000, scope: "supply"}); await service.stop();
      const replaced = await archive.load(); assert(replaced.rows.length === 1 && replaced.session.count === 1 && !replaced.rows[0].market, "Starting a new session replaces all old rows"); checks.push("manual recording bounded replacement without mixed sessions");
    }
  } finally { archive.close(); }
}
