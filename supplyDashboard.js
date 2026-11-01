// Presentation only. Calculations never enter stats, chart packets, or observation archives.
(() => {
  "use strict";
  const S = AxiomSupply, node = id => document.getElementById(id);
  let packet = null, context = null, provider = null, providerError = null, providerMessage = null, latest = null;
  const titles = {price: "Price — Axiom-reported", marketCap: "Market Cap — Axiom-reported", displayedSupply: "Supply — Axiom-displayed, type unspecified",
    circulatingSupply: "Circulating supply — Axiom-reported", totalSupply: "Total supply — Axiom-reported", maximumSupply: "Maximum supply — Axiom-reported", reportedFDV: "FDV — Axiom-reported, denominator unspecified"};
  const identity = value => JSON.stringify([value?.sourceKey, value?.blockchain, value?.mintAddress, value?.poolAddress, value?.conflict]);
  const date = at => Number.isFinite(at) ? new Date(at).toISOString() : "Unavailable";
  const number = value => typeof value === "string" ? value.replace(/^(\d+)(\.\d+)?$/, (_, whole, fraction = "") => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + fraction) : "Unavailable";
  function paragraph(parent, value) { const text = document.createElement("p"); text.className = "card-note"; text.textContent = value; parent.append(text); }
  function figure(parent, title, value, note) {
    const card = document.createElement("article"); card.className = "supply-figure";
    const heading = document.createElement("h3"), output = document.createElement("p"); heading.textContent = title;
    output.className = "supply-amount"; output.textContent = value; card.append(heading, output); paragraph(card, note); parent.append(card);
  }
  const stale = (record, age = S.FRESH_MS) => !Number.isFinite(record.observedAt ?? record.fetchedAt) ||
    Date.now() - (record.observedAt ?? record.fetchedAt) > age || (record.observedAt ?? record.fetchedAt) > Date.now() + 1000;
  function provenance(parent, field, title) {
    const detail = document.createElement("details"), heading = document.createElement("summary"); detail.className = "supply-provenance";
    heading.textContent = `${title} · ${field.source} · ${field.status}`; detail.append(heading);
    paragraph(detail, `Source field/label: ${field.sourceField}. Raw: ${field.rawText === null ? "Unavailable" : String(field.rawText)}. Normalized: ${number(field.normalizedValue)} ${field.currency ?? field.unit ?? ""}.`);
    paragraph(detail, field.definition);
    paragraph(detail, `Observed: ${date(field.observedAt)}. Fetched: ${date(field.fetchedAt)}. ${field.verificationStatus}. ${field.approximationStatus}.`);
    paragraph(detail, `Context: ${field.context?.blockchain ?? "network unresolved"} · token ${field.context?.mintAddress ?? "unresolved"} · pool ${field.context?.poolAddress ?? "unresolved"}. ${field.normalization ?? field.scope ?? ""}`);
    if (field.providerName) paragraph(detail, `${field.providerName}. Response: ${field.sourceUrl ?? "Unavailable"}. Definitions: ${field.definitionSource ?? "https://docs.coingecko.com/reference/pool-address"}.`);
    if (field.observations?.length > 1) paragraph(detail, `All displayed candidates: ${field.observations.map(item => `${item.sourceField}: ${item.rawText ?? "Unavailable"}`).join(" | ")}`);
    parent.append(detail);
  }
  function render() {
    const fields = {};
    for (const key of Object.keys(S.definitions)) {
      const record = packet?.fields?.[key] ?? S.observation(key, null, {context: context ?? {}});
      const mismatch = packet && context && (context.conflict || identity(record.context) !== identity(context));
      fields[key] = mismatch ? {...record, status: "context-mismatch", normalizedValue: null} : record;
    }
    latest = S.analyze({fields});
    node("supplyContext").textContent = context ? `${context.blockchain ?? "Network unresolved"} · token ${context.mintAddress ?? "unresolved"} · each figure retains its own source and observation time.` : "Waiting for fresh Axiom supply/valuation observations. Refresh Axiom after reloading the extension.";
    for (const id of ["supplyObserved", "supplyTyped", "supplyCalculations"]) node(id).replaceChildren();
    // Preserve expanded per-field provenance through ordinary age/heartbeat updates.
    const open = new Set([...node("supplyProvenance").children].filter(item => item.open).map(item => item.dataset.field));
    node("supplyProvenance").replaceChildren();
    for (const [key, field] of Object.entries(fields)) {
      const available = field.status === "available";
      const value = available ? `${number(field.normalizedValue)} ${field.currency ?? (field.unit === "token-units" ? "tokens" : "currency unresolved")}` :
        field.status === "unbounded" ? "No finite maximum — Axiom-reported" : "Unavailable";
      const quality = `${available ? stale(field) ? "Stale observation" : "Recent DOM observation" : `Input ${field.status}`} · ${field.approximationStatus}.`;
      if (["price", "marketCap", "displayedSupply"].includes(key)) figure(node("supplyObserved"), titles[key], value, quality);
      else figure(node("supplyTyped"), titles[key], value, `${quality} ${field.definition}`);
      provenance(node("supplyProvenance"), field, titles[key]);
      const detail = node("supplyProvenance").lastElementChild; detail.dataset.field = key; detail.open = open.has(key);
    }
    for (const calculation of latest.calculations) {
      if (calculation.inputs.supply?.key === "displayedSupply" && !node("supplyGenericCalculation").checked) continue;
      const reason = calculation.name.startsWith("FDV") && calculation.status !== "available" ? `${calculation.reason} FDV requires a finite explicitly documented diluted-supply basis; total supply is not substituted for maximum.` : calculation.reason;
      figure(node("supplyCalculations"), `${calculation.name} — Calculated estimate`,
        calculation.status === "available" ? `≈ ${number(calculation.normalizedValue)} ${calculation.currency}` : "Unavailable",
        `${reason} Basis: ${calculation.supplyBasis}`);
    }
    const openProvider = new Set([...node("supplyProvider").children].filter(item => item.open).map(item => item.dataset.field));
    node("supplyProvider").replaceChildren();
    node("supplyProviderStatus").textContent = providerError ? `Optional provider lookup failed: ${providerError}. DOM figures remain independent.${provider ? " Previous matching provider values are stale." : ""}` : providerMessage ??
      (provider ? "Provider-reported pool-base-token values from an explicit historical lookup. No typed supply fields are established by this response; no figures here are independently blockchain-verified." : "Optional provider figures appear only after an explicit historical pool lookup; no API is required here.");
    if (provider) for (const field of S.providerFields(provider)) {
      figure(node("supplyProvider"), `${field.key} — Provider-reported`, field.status === "available" ? `${number(field.normalizedValue)} USD` : `Unavailable (${field.status})`,
        `${providerError || stale(field, 60000) ? "Stale provider observation" : "Recent provider fetch"} · ${date(field.fetchedAt)}. ${field.definition} ${field.scope}`);
      provenance(node("supplyProvider"), field, field.key);
      node("supplyProvider").lastElementChild.dataset.field = field.key; node("supplyProvider").lastElementChild.open = openProvider.has(field.key);
    }
  }
  globalThis.AxiomSupplyUI = {
    setSnapshot(snapshot) {
      const next = snapshot?.chartContext ?? snapshot?.supplyValuation?.context ?? null;
      if (identity(context) !== identity(next)) { provider = null; providerError = null; providerMessage = null; }
      context = next; packet = snapshot?.supplyValuation ?? null; render();
    },
    setProvider(next) {
      const sameAddress = (a, b) => a && b && (a.startsWith("0x") ? a.toLowerCase() === b.toLowerCase() : a === b);
      if (!next || !context?.blockchain || context.blockchain !== next.blockchain || !sameAddress(context.mintAddress, next.mintAddress) || context.conflict) {
        provider = null; providerMessage = "Provider pool-base-token identity cannot be matched to the active Axiom token/network. Its values are not assigned to this token.";
      } else { provider = next; providerMessage = null; }
      providerError = null; render();
    },
    providerError(error) { providerError = error; render(); },
    clearProvider() { provider = null; providerError = null; providerMessage = null; render(); },
    inspect: () => ({analysis: latest, packet, provider})
  };
  node("supplyGenericCalculation").addEventListener("change", render);
  setInterval(render, 1000); render();
})();
