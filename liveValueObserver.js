// Reads cached stat cells on relevant mutations from content.js's existing observer.
(() => {
  "use strict";
  const clean = value => (value ?? "").replace(/\s+/g, " ").trim();
  // Current pair summaries omit the Market Cap label. Match that exact headline slot,
  // anchored to the token identity and neighboring labeled stats, never an arbitrary amount.
  function marketCapBinding(spans) {
    const candidates = [];
    for (const price of spans.filter(node => node.childElementCount === 0 && clean(node.textContent) === "Price")) {
      const priceScope = price.parentElement, summary = priceScope?.parentElement, scope = priceScope?.previousElementSibling;
      if (!summary || !scope || price.closest('[data-perf-id*="table"], [role="row"], [data-perf-id="token-trades-panel"]')) continue;
      const marker = summary.querySelector('[data-pair-summary-budget-row="true"]');
      if (!marker || scope.contains(marker)) continue;
      const leaves = [...summary.querySelectorAll("span")].filter(node => node.childElementCount === 0);
      if (!["Liquidity", "Supply", "Global Fees Paid"].every(label =>
        leaves.some(node => clean(node.textContent) === label))) continue;
      if (leaves.some(node => scope.contains(node) && /^(?:Price|Liquidity|Supply|ATH|Global Fees Paid|Market\s?Cap|Mkt\s?Cap|FDV|Fully Diluted Valuation|B\.Curve)$/.test(clean(node.textContent))) ||
          scope.querySelector("button, a, input")) continue;
      const values = [...scope.querySelectorAll("span")].filter(node => node.classList.contains("text-[18px]") &&
        node.classList.contains("[font-variant-numeric:tabular-nums]"));
      if (values.length === 1) candidates.push({label: values[0], scope, cells: values, priceLabel: price, summaryMarker: marker});
    }
    return candidates.length === 1 ? candidates[0] : null;
  }
  function createReader(onObservation, now = Date.now, definitions = [["price", ["price"]], ["marketCap", ["market cap", "marketcap", "mkt cap"]]]) {
    let tokenKey = null;
    const bindings = new Map();
    const previousText = new Map();
    const previousNodes = new Map();
    let switched = false;
    function available(binding) {
      return binding.label.isConnected && binding.scope.getClientRects().length &&
        (binding.priceLabel ? binding.summaryMarker.isConnected && binding.scope.nextElementSibling === binding.priceLabel.parentElement &&
          clean(binding.priceLabel.textContent) === "Price" : binding.allowedLabels.includes(clean(binding.label.textContent).toLowerCase())) &&
        (!binding.scope.checkVisibility || binding.scope.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) &&
        !binding.scope.closest('[hidden], [aria-hidden="true"]');
    }
    function text(binding, preferFull = true) {
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
      const cells = binding.cells ?? Array.from(binding.scope.children).filter(child => child !== binding.label);
      const raw = cells.map(flatten).join("").trim();
      // Prefer an explicit full numeric value/tooltip on the value cell when supplied.
      if (preferFull) for (const cell of cells) for (const attribute of [binding.type === "price" ? "data-price" : "data-market-cap", "data-full-value", "title"]) {
        const full = cell.getAttribute(attribute), parsed = AxiomRollingChart.parseValue(full);
        if (parsed) return parsed.unit === "unspecified" && /^[$€£]/.test(raw) ? raw[0] + full : full;
      }
      return raw;
    }
    function read(type, binding, mutation = false) {
      const raw = text(binding, binding.type !== "liquidity");
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
        for (const [type, labels] of definitions) {
          const label = spans.find(node => node.childElementCount === 0 && labels.includes(clean(node.textContent).toLowerCase()) &&
            !node.closest('[data-perf-id*="table"], [role="row"]'));
          const headline = type === "marketCap" && !label ? marketCapBinding(spans) : null;
          const selected = headline?.label ?? label;
          const existing = bindings.get(type);
          if (!selected?.parentElement) { bindings.delete(type); onObservation(type, null); continue; }
          if (existing?.label !== selected || existing?.scope !== (headline?.scope ?? selected.parentElement)) {
            bindings.set(type, {type, label: selected, scope: selected.parentElement, ...headline, lastText: previousText.get(type) ?? null,
              allowedLabels: labels, initialized: false, waiting: switched && previousText.has(type) && selected === previousNodes.get(type)});
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
      },
      readAttempt(type) {
        const binding = bindings.get(type), domReadAt = now();
        const displayText = binding ? text(binding, false) : null;
        const waiting = binding?.waiting && displayText === previousText.get(type);
        return {displayText, domReadAt, status: waiting ? "awaiting-token" : "read"};
      }
    };
  }
  globalThis.AxiomLiveValueObserver = Object.freeze({createReader, marketCapBinding});
})();
