(() => {
  "use strict";
  const node = id => document.getElementById(id);
  let session = null, snapshot = null, busy = false, reportId = null, output = "", message = "", generation = 0;
  const date = at => Number.isFinite(at) ? new Date(at).toISOString() : "Unavailable";
  const duration = ms => {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
  };
  function render() {
    const active = session?.state === "recording", fresh = Number.isFinite(snapshot?.marketObservedAt) &&
      Date.now() - snapshot.marketObservedAt <= 10000 && snapshot.marketObservedAt <= Date.now() + 1000 && snapshot.chartContext?.sourceKey && !snapshot.chartContext?.conflict;
    node("recordingStart").disabled = busy || active || !fresh;
    node("recordingStop").disabled = busy || !active;
    node("recordingInterval").disabled = busy || active; node("recordingScope").disabled = busy || active;
    for (const id of ["recordingCopy", "recordingOutputCopy"]) node(id).disabled = busy || !output || active;
    node("recordingStart").textContent = session && !active ? "Start new recording" : "Start recording";
    node("recordingStatus").textContent = message || (active ? `Recording ${session.title} · ${session.count} entries. Keep the Axiom source open; dashboard can be closed.` :
      session ? `Stopped · ${session.count} entries · ${session.stopReason}. Copy the report below to your LLM.` : fresh ? "Ready to record the current Axiom token." : "Waiting for recent Axiom observations. Open or refresh its token page.");
    node("recordingPriceLabel").textContent = session ? "Price at start (Axiom display)" : "Price before recording (Axiom display)";
    node("recordingPrice").textContent = (session ? session.startPrice : fresh ? snapshot?.stats?.price : null) || "Unavailable";
    node("recordingEndPrice").textContent = session?.state === "stopped" ? session.endPrice ?? "Unavailable" : "Available after Stop";
    node("recordingDuration").textContent = session ? `${active ? "Elapsed recording time" : "Recorded duration"}: ${duration(Math.min(3600000, (active ? Date.now() : session.endedAt) - session.startedAt))}` : "Recorded duration: 00:00:00";
    node("recordingDuration").dataset.state = active ? "recording" : "stopped";
    node("recordingTimes").textContent = session ? `Started (UTC): ${date(session.startedAt)} · ${active ? "Latest log (UTC)" : "Ended (UTC)"}: ${date(active ? session.lastLoggedAt : session.endedAt)} · ${session.intervalMs / 1000}s target interval · ${session.scope === "supply" ? "Supply & Valuation" : "All analyzer summaries"}${session.storageError ? ` · Storage error: ${session.storageError}; copy this report before closing.` : ""}` : "";
    node("recordingOutputDetails").hidden = !output; node("recordingOutputSummary").textContent = `Copyable LLM report · ${output.length.toLocaleString()} characters`;
    if (node("recordingOutput").value !== output) node("recordingOutput").value = output;
  }
  function request(type, values = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({type, ...values}, response => {
        const error = chrome.runtime.lastError?.message;
        if (error || !response?.ok) reject(new Error(error ?? response?.error ?? "Recording service unavailable")); else resolve(response);
      });
    });
  }
  async function accept(response) {
    const next = response.session ?? null;
    if (session && next && (next.startedAt < session.startedAt || session.id === next.id &&
      (next.count < session.count || session.state === "stopped" && next.state === "recording"))) return;
    if (session?.id !== next?.id) { output = ""; reportId = null; generation++; }
    session = next; message = "";
    if (response.text !== undefined) { output = response.text; reportId = next?.id; }
    render();
    if (session?.state === "stopped" && reportId !== session.id) {
      const id = session.id, current = ++generation;
      try { const report = await request("AXIOM_RECORDING_REPORT"); if (current !== generation || session?.id !== id || report.session?.id !== id) return;
        output = report.text; reportId = id; render(); }
      catch (error) { if (current === generation) { message = error.message; render(); } }
    }
  }
  async function action(type, values) {
    busy = true; message = ""; render();
    try { const response = await request(type, values); await accept(response); if (response.text) node("recordingOutputDetails").open = true; }
    catch (error) { message = error.message; }
    finally { busy = false; render(); }
  }
  node("recordingStart").addEventListener("click", () => action("AXIOM_RECORDING_START", {intervalMs: Number(node("recordingInterval").value), scope: node("recordingScope").value}));
  node("recordingStop").addEventListener("click", () => action("AXIOM_RECORDING_STOP"));
  async function copyReport() {
    try { await navigator.clipboard.writeText(output); message = "Report copied. Paste it into your LLM for analysis."; }
    catch { node("recordingOutputDetails").open = true; node("recordingOutput").focus(); node("recordingOutput").select(); message = "Clipboard access was unavailable. The report is selected; press Ctrl+C (or Cmd+C)."; }
    render();
  }
  for (const id of ["recordingCopy", "recordingOutputCopy"]) node(id).addEventListener("click", copyReport);
  chrome.runtime.onMessage.addListener(incoming => { if (incoming?.type === "AXIOM_RECORDING_STATE") void accept(incoming); });
  async function hydrate() { if (busy) return; try { await accept(await request("AXIOM_RECORDING_STATUS")); } catch (error) { message = error.message; render(); } }
  globalThis.AxiomRecordingUI = {setSnapshot(value) { snapshot = value; render(); }, inspect: () => ({session, output})};
  setInterval(() => { render(); if (session?.state === "recording" && Date.now() - session.startedAt >= 3600000) void hydrate(); }, 1000);
  void hydrate(); render();
})();
