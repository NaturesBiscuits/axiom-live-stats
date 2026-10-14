// Reads cached stat cells on relevant mutations from content.js's existing observer.
(() => {
  "use strict";
  const clean = value => (value ?? "").replace(/\s+/g, " ").trim();
  function createReader(onObservation, now = Date.now) {
    let tokenKey = null;
    const bindings = new Map();
    const previousText = new Map();
    const previousNodes = new Map();
    let switched = false;
    function available(binding) {
      return binding.label.isConnected && binding.scope.getClientRects().length &&
        binding.allowedLabels.includes(clean(binding.label.textContent).toLowerCase()) &&
        !binding.scope.closest('[hidden], [aria-hidden="true"]');
    }
    function text(binding) {
      if (!available(binding)) return null;
      const flatten = node => {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1 || ["SVG", "IMG"].includes(node.tagName)) return "";
        const subscript = node.tagName === "SUB" || node.style.verticalAlign === "sub" ||
          node.classList.contains("align-sub") || (/^\d{1,3}$/.test(clean(node.textContent)) && globalThis.getComputedStyle?.(node).verticalAlign === "sub");
        if (subscript && /^\d+$/.test(clean(node.textContent))) {
          return clean(node.textContent).replace(/\d/g, digit => "₀₁₂₃₄₅₆₇₈₉"[Number(digit)]);
        }
        return Array.from(node.childNodes).map(flatten).join("");
      };
      const cells = Array.from(binding.scope.children).filter(child => child !== binding.label);
      const raw = cells.map(flatten).join("").trim();
      // Prefer an explicit full numeric value/tooltip on the value cell when supplied.
      for (const cell of cells) for (const attribute of [binding.type === "price" ? "data-price" : "data-market-cap", "data-full-value", "title"]) {
        const full = cell.getAttribute(attribute), parsed = AxiomRollingChart.parseValue(full);
        if (parsed) return parsed.unit === "unspecified" && /^[$€£]/.test(raw) ? raw[0] + full : full;
      }
      return raw;
    }
    function read(type, binding, mutation = false) {
      const raw = text(binding);
      if (binding.waiting && !mutation && raw === previousText.get(type)) { onObservation(type, null); return; }
      if (raw === null) { onObservation(type, null); return; }
      binding.waiting = false;
      const parsed = AxiomRollingChart.parseValue(raw);
      if (!parsed) { onObservation(type, null); return; }
      // A successful bounded DOM read is fresh even when its value is unchanged.
      // Numeric change timing is maintained independently by the store.
      binding.lastText = raw; binding.initialized = true;
      onObservation(type, parsed, now(), {domUpdatedAt: mutation ? now() : null,
        readReason: mutation ? "mutation" : "cached-cell-read", displayText: raw});
    }
    return {
      setToken(nextKey) {
        if (nextKey === tokenKey) return;
        previousText.clear();
        previousNodes.clear();
        for (const [type, binding] of bindings) { previousText.set(type, binding.lastText); previousNodes.set(type, binding.label); }
        switched = tokenKey !== null;
        tokenKey = nextKey; bindings.clear();
      },
      bind(spans) {
        for (const [type, labels] of [["price", ["price"]], ["marketCap", ["market cap", "marketcap", "mkt cap"]]]) {
          const label = spans.find(node => node.childElementCount === 0 && labels.includes(clean(node.textContent).toLowerCase()) &&
            !node.closest('[data-perf-id*="table"], [role="row"]'));
          const existing = bindings.get(type);
          if (!label?.parentElement) { bindings.delete(type); onObservation(type, null); continue; }
          if (existing?.label !== label) {
            bindings.set(type, {type, label, scope: label.parentElement, lastText: null,
              allowedLabels: labels, initialized: false, waiting: switched && previousText.has(type) && label === previousNodes.get(type)});
          }
          read(type, bindings.get(type));
        }
      },
      mutations(records) {
        for (const [type, binding] of bindings) {
          const relevant = records.some(record => {
            if (record.target === binding.label || binding.label.contains(record.target)) return true;
            return record.target === binding.scope || binding.scope.contains(record.target) ||
              Array.from(record.removedNodes ?? []).some(node => node === binding.scope || node.contains?.(binding.scope));
          });
          if (relevant) read(type, binding, records.some(record => record.type !== "attributes" &&
            (record.target === binding.scope || binding.scope.contains(record.target))));
        }
      },
      checkAvailability() {
        for (const [type, binding] of bindings) if (!available(binding)) onObservation(type, null);
      },
      readLatest() {
        for (const [type, binding] of bindings) read(type, binding);
      }
    };
  }
  globalThis.AxiomLiveValueObserver = Object.freeze({createReader});
})();
