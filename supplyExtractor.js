// Reuses content.js's cached market labels and observer/heartbeat. No second collector or API.
(() => {
  "use strict";
  const S = AxiomSupply, clean = text => String(text ?? "").replace(/\s+/g, " ").trim();
  const excluded = node => node.closest('[data-perf-id*="table"], [role="row"], [role="tablist"], [data-perf-id="token-trades-panel"]');
  function visible(node) {
    if (!node?.isConnected || node.closest('[hidden], [aria-hidden="true"]')) return false;
    const css = node.ownerDocument.defaultView.getComputedStyle(node);
    return css.display !== "none" && !["hidden", "collapse"].includes(css.visibility) && (!node.checkVisibility || node.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) &&
      (css.display === "contents" ? [...node.children].some(visible) : Boolean(node.getClientRects().length));
  }
  function text(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1 || node.matches("svg, img, i") || !visible(node)) return "";
    const raw = clean(node.textContent), subscript = node.tagName === "SUB" || node.style.verticalAlign === "sub" || node.classList.contains("align-sub");
    if (subscript && /^\d{1,3}$/.test(raw)) return raw.replace(/\d/g, digit => "₀₁₂₃₄₅₆₇₈₉"[Number(digit)]);
    return [...node.childNodes].map(text).join("");
  }
  function binding(label, nodes) {
    let branch = label;
    for (let depth = 0; depth < 5 && branch.parentElement; depth++, branch = branch.parentElement) {
      const scope = branch.parentElement;
      if (nodes.some(node => node !== label && scope.contains(node))) return null;
      const values = [...scope.children].filter(node => node !== branch && !node.matches("svg, img, i"));
      if (values.length) return {label, values};
    }
    return null;
  }
  function createReader() {
    let source = null, previous = new Map(); const blocked = new Map();
    return {read(nodes, context, at = Date.now()) {
      const nextSource = JSON.stringify([context.sourceKey, context.blockchain, context.mintAddress, context.poolAddress, context.conflict]);
      const fields = {}, current = new Map();
      for (const [key, definition] of Object.entries(S.definitions)) {
        const labels = nodes.filter(node => !node.children.length && !excluded(node) && definition.labels.includes(clean(node.textContent)));
        const readable = labels.filter(visible), bindings = readable.map(node => binding(node, nodes));
        const readings = readable.map((node, index) => ({node, label: clean(node.textContent), raw: bindings[index] ? clean(bindings[index].values.map(text).join("")) || null : null}));
        const values = readings.map(item => S.observation(key, item.raw, {context, observedAt: at, label: item.label}));
        const signature = JSON.stringify(readings.map(item => [item.label, item.raw]));
        const prior = previous.get(key), guard = blocked.get(key);
        if (source !== null && nextSource !== source && prior && prior.signature === signature && prior.nodes.some(node => readable.includes(node))) blocked.set(key, {nodes: prior.nodes, signature});
        if (guard && (!guard.nodes.some(node => readable.includes(node)) || signature !== guard.signature)) blocked.delete(key);
        const distinct = new Set(values.map(item => JSON.stringify([item.status, item.normalizedValue, item.currency])));
        const status = context.conflict ? "identity-conflict" : blocked.has(key) ? "awaiting-token" : distinct.size > 1 ? "conflicting" :
          readable.length ? values[0].status : labels.length ? "hidden" : "missing";
        fields[key] = {...(values[0] ?? S.observation(key, null, {context})),
          status, normalizedValue: ["available"].includes(status) ? values[0]?.normalizedValue ?? null : null,
          observations: readings.map(({label, raw}) => ({sourceField: label, rawText: raw, observedAt: at})),
          observedAt: readable.length ? at : null};
        current.set(key, {nodes: readable, signature});
      }
      source = nextSource; previous = current;
      return {source: "Axiom-reported", context: {...context}, observedAt: at, fields};
    }};
  }
  globalThis.AxiomSupplyExtractor = Object.freeze({createReader});
})();
