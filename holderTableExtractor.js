// Read-only observations of Axiom's virtualized Holders table.
(() => {
  "use strict";
  const TABLE_SELECTOR = '[data-perf-id="token-table-holders"]';
  const MAX_RENDERED_ROWS = 500;
  const MAX_SESSION_WALLETS = 1000;
  const clean = text => (text ?? "").replace(/\s+/g, " ").trim();
  const isSubscript = node => node.nodeType === 1 &&
    (node.tagName === "SUB" || node.style.verticalAlign === "sub" || node.classList.contains("align-sub")) &&
    /^\d{1,3}$/.test(clean(node.textContent));
  function value(node) {
    // Preserve zero-count subscripts without converting displayed amounts to floats.
    const text = current => {
      if (current.nodeType === 3) return current.textContent;
      if (current.nodeType !== 1 || current.matches('svg, img, [aria-label="Label this wallet"]')) return "";
      if (isSubscript(current)) {
        return clean(current.textContent).replace(/\d/g, digit => "₀₁₂₃₄₅₆₇₈₉"[Number(digit)]);
      }
      return Array.from(current.childNodes).map(text).join("");
    };
    return clean(node ? text(node) : "").replace(/0\.0([₀₁₂₃₄₅₆₇₈₉]+)(\d+)/g, (raw, subscript, digits) => {
      const zeros = Number([...subscript].map(char => "₀₁₂₃₄₅₆₇₈₉".indexOf(char)).join(""));
      return zeros >= 1 && zeros <= 308 ? "0." + "0".repeat(zeros) + digits : raw;
    }) || null;
  }
  const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function isAddress(text) {
    if (/^0x[\da-fA-F]{40}$/.test(text || "")) return true;
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text || "")) return false;
    // Validate the 32-byte public-key encoding, rather than accepting long labels.
    let number = 0n;
    for (const character of text) number = number * 58n + BigInt(BASE58.indexOf(character));
    let bytes = 0;
    while (number > 0n) { bytes++; number >>= 8n; }
    return bytes + text.match(/^1*/)[0].length === 32;
  }
  const addressKey = address => address.startsWith("0x") ? address.toLowerCase() : address;

  function fragments(cell) {
    if (!cell) return [];
    const excluded = node => {
      for (let current = node; current && current !== cell; current = current.parentElement) {
        if (isSubscript(current) || current.matches('[aria-label="Label this wallet"]')) return true;
      }
      return false;
    };
    // Inline wrappers often carry an amount and a secondary count/percentage.
    // Subscript digits belong to the surrounding number, not a separate fragment.
    const leaves = Array.from(cell.querySelectorAll("span, div, a, time"))
      .filter(node => !excluded(node) && !Array.from(node.querySelectorAll("span, div, a, time")).some(child => !excluded(child)))
      .map(value).filter(Boolean);
    return leaves.length ? leaves : [value(cell)].filter(Boolean);
  }

  function explicit(cell, field) {
    return value(cell?.querySelector(`[data-field="${field}"]`));
  }

  function publicAddress(cell) {
    if (!cell) return null;
    for (const node of [cell, ...cell.querySelectorAll("[data-wallet-address], [data-address], [title], a")]) {
      for (const text of [node.getAttribute("data-wallet-address"), node.getAttribute("data-address"),
        node.getAttribute("title"), value(node)]) {
        if (isAddress(text)) return text;
      }
      // Only account/address links inside the WALLET cell establish identity.
      if (node.tagName === "A") {
        try {
          const url = new URL(node.getAttribute("href"), location.href);
          if (url.protocol !== "https:") continue;
          const match = url.pathname.match(/\/(?:account|address)\/([^/]+)\/?$/);
          if (match && isAddress(match[1])) return match[1];
        } catch { /* No public address available. */ }
      }
    }
    return fragments(cell).find(isAddress) ?? null;
  }

  function transactionUrl(cell) {
    for (const anchor of cell?.querySelectorAll("a[href]") ?? []) {
      try {
        const url = new URL(anchor.getAttribute("href"), location.href);
        if (url.protocol === "https:" && /\/(?:tx|transaction)\/[^/]+/.test(url.pathname)) {
          return url.href;
        }
      } catch { /* Invalid or unavailable link. */ }
    }
    return null;
  }

  function trade(cell, side) {
    const parts = fragments(cell);
    const countMatch = parts.join(" ").match(new RegExp(`(?:([\\d,]+)\\s*(?:${side}s?|txns?|transactions?)\\b|\\b${side}s?\\s*[:：]\\s*([\\d,]+))`, "i"));
    // Axiom's Bought/Sold cells display token quantity / transaction count.
    // Match that complete secondary line, never an arbitrary number or wallet badge.
    const ratioCounts = new Set(Array.from(cell?.querySelectorAll("span, div") ?? [])
      .map(node => value(node)?.match(/^(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)[KMBT]?\s*\/\s*([\d,]+)$/i)?.[1])
      .filter(Boolean));
    const rawCount = explicit(cell, `${side}-count`) || countMatch?.[1] || countMatch?.[2] ||
      (ratioCounts.size === 1 ? [...ratioCounts][0] : null);
    const count = rawCount && /^[\d,]+$/.test(rawCount) ? Number(rawCount.replace(/,/g, "")) : null;
    return {
      amount: explicit(cell, `${side}-amount`) || parts.find(part => !/\b(?:buys?|sells?|txns?|transactions?)\b/i.test(part)) || null,
      count: Number.isSafeInteger(count) ? count : null
    };
  }

  const LEGACY_FIELDS = ["rank", "wallet", "balance", "bought", "sold", "pnl", "remaining", "funding", "held"];
  const isActionCell = cell => cell.classList.contains("h-0") && cell.classList.contains("w-0") &&
    Boolean(cell.querySelector("button")) && /^Follow (?:Buy|Sell)$/i.test(value(cell) || "");
  function headerField(cell) {
    const label = value(cell) || "";
    if (!label || /^(?:Rank|#)$/i.test(label)) return "rank";
    if (/^Wallet$/i.test(label)) return "wallet";
    if (/^(?:(?:SOL|BNB|ETH)\s+)?Balance(?:\s|$)/i.test(label)) return "balance";
    if (/^Bought(?:\s|$)/i.test(label)) return "bought";
    if (/^Sold(?:\s|$)/i.test(label)) return "sold";
    if (/^U\.?\s*PnL$/i.test(label)) return "pnl";
    if (/^Fees Paid$/i.test(label)) return "fees";
    if (/^Remaining$/i.test(label)) return "remaining";
    if (/^Funding$/i.test(label)) return "funding";
    if (/^Held$/i.test(label)) return "held";
    return null;
  }
  function headerSchema(table) {
    // Stay inside the Holders table; headers may be divs rather than an ARIA grid.
    let recognizedHeader = Boolean(table.querySelector('[role="columnheader"], th'));
    for (const label of table.querySelectorAll("span, [role='columnheader'], th")) {
      if (!/^Wallet$/i.test(value(label) || "") || label.closest('[data-index]') ||
          (label.closest('[role="row"]') && !label.closest('[role="columnheader"]') && label.tagName !== "TH")) continue;
      let container = label.parentElement;
      for (let depth = 0; depth < 4 && container && table.contains(container); depth++, container = container.parentElement) {
        const cells = Array.from(container.children).filter(cell => !isActionCell(cell));
        if (cells.length < 9) continue;
        const fields = cells.map(headerField);
        if (fields.includes("wallet") && ["balance", "bought", "sold"].some(field => fields.includes(field))) recognizedHeader = true;
        if (!LEGACY_FIELDS.every(field => fields.filter(found => found === field).length === 1) ||
            fields.filter(field => field === "fees").length > 1) continue;
        const balance = cells[fields.indexOf("balance")];
        const currency = value(balance)?.match(/^(SOL|BNB|ETH)\s+Balance/i)?.[1].toUpperCase() ?? null;
        return {fields, currency};
      }
    }
    // An incomplete/ambiguous header must not silently fall back to positional mapping.
    return recognizedHeader ? {fields: null, currency: null} : null;
  }
  function rowCells(row, schema) {
    if (schema && !schema.fields) return null;
    let cells = Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"]'));
    let container = row;
    for (let depth = 0; !cells.length && depth < 4 && container; depth++) {
      const children = Array.from(container.children).filter(cell => !isActionCell(cell));
      if (children.length > 1) { cells = children; break; }
      container = children[0];
    }
    cells = cells.filter(cell => !isActionCell(cell));
    let fields = schema?.fields;
    if (!fields) {
      if (cells.length === 9) fields = LEGACY_FIELDS;
      // Headerless EVM captures are supported only with the observed structural markers.
      else if (cells.length === 10 && cells[3].className.includes("--holders-bought-min-width") &&
          cells[4].className.includes("--holders-sold-min-width") &&
          cells[2].querySelector('img[alt="BNB"], img[alt="ETH"]') &&
          cells[6].querySelector('img[alt="BNB"], img[alt="ETH"]') && /%/.test(value(cells[7]) || "")) {
        fields = ["rank", "wallet", "balance", "bought", "sold", "pnl", "fees", "remaining", "funding", "held"];
      }
    }
    if (!fields || fields.length !== cells.length) return null;
    return Object.fromEntries(fields.map((field, index) => [field, cells[index]]).filter(([field]) => field));
  }

  function currency(cell, fallback = null) {
    const text = value(cell) || "";
    const symbols = new Set(Array.from(cell?.querySelectorAll('img[alt="SOL"], img[alt="BNB"], img[alt="ETH"]') ?? [])
      .map(image => image.alt));
    for (const match of text.matchAll(/\b(SOL|BNB|ETH)\b/gi)) symbols.add(match[1].toUpperCase());
    // A header supplies a missing unit, never resolves contradictory row evidence.
    return symbols.size === 1 ? [...symbols][0] : symbols.size ? null : fallback;
  }

  function extractRow(row, cells, schema) {
    const walletAddress = publicAddress(cells.wallet);
    const bought = trade(cells.bought, "buy");
    const sold = trade(cells.sold, "sell");
    const remainingParts = fragments(cells.remaining);
    const remainingPercentage = explicit(cells.remaining, "remaining-percentage") ||
      remainingParts.join(" ").match(/-?\d+(?:\.\d+)?\s*%/)?.[0] || null;
    const activityParts = [...fragments(cells.wallet), ...fragments(cells.balance)];
    const balanceCurrency = currency(cells.balance, schema?.currency ||
      (explicit(cells.balance, "sol-balance") !== null ? "SOL" : null));
    const nativeBalance = explicit(cells.balance, "native-balance") || explicit(cells.balance, "sol-balance") ||
      fragments(cells.balance)[0] || null;
    const fundingLink = cells.funding?.querySelector('a[href*="/tx/"], a[href*="/transaction/"]');
    return {
      rank: value(cells.rank),
      walletDisplay: explicit(cells.wallet, "wallet") || fragments(cells.wallet)[0] || null,
      walletAddress,
      identityStatus: walletAddress ? "resolved" : "unresolved",
      nativeBalance, balanceCurrency,
      // Retained for consumers of older Solana snapshots; EVM balances are never SOL.
      solBalance: balanceCurrency === "SOL" ? nativeBalance : null,
      lastActive: explicit(cells.wallet, "last-active") || explicit(cells.balance, "last-active") ||
        activityParts.map(part => part.replace(/^\((.*)\)$/, "$1").trim())
          .find(part => /\b(?:last\s*active|ago|just now)\b/i.test(part) || /^\d+(?:\.\d+)?\s*[smhdw]$/.test(part)) || null,
      boughtAmount: bought.amount,
      buyCount: bought.count,
      soldAmount: sold.amount,
      sellCount: sold.count,
      unrealizedPnl: value(cells.pnl),
      feesPaid: explicit(cells.fees, "fees-paid") || fragments(cells.fees)[0] || null,
      feesPaidCurrency: currency(cells.fees),
      remainingTokenValue: explicit(cells.remaining, "remaining-value") ||
        remainingParts.find(part => !part.includes("%")) || null,
      remainingPercentage,
      fundingSourceLabel: explicit(cells.funding, "funding-source") || value(fundingLink?.querySelector(".truncate")) ||
        fragments(cells.funding)[0] || null,
      fundingTransactionUrl: transactionUrl(cells.funding),
      holdingDuration: value(cells.held),
      axiomBundler: Boolean(row.querySelector('img[alt="Bundler"]')),
      classificationSource: "axiom-dom",
      // Reserved for independently verified data; DOM labels are not cluster evidence.
      commonFundingSource: null,
      similarSolBalancePatterns: null,
      synchronizedBuys: null,
      sameBlockActivity: null,
      clusterId: null,
      evidenceScore: null,
      clusterConfidence: null
    };
  }

  function extract(table) {
    if (!table) return {rows: [], unsupportedRows: 0, renderedLimitReached: false};
    const schema = headerSchema(table);
    const possibleRows = Array.from(table.querySelectorAll('[style], [role="row"], [data-index]'))
      .filter(row => {
        const height = parseFloat(row.style.height);
        return row.getAttribute("role") === "row" ||
          (row.style.position === "absolute" && (row.style.top || row.style.transform) &&
            height >= 32 && height <= 72);
      });
    const possibleSet = new Set(possibleRows);
    const candidates = possibleRows.filter(row => {
      // A positioned wrapper can also contain a role=row element. Read it once.
      for (let parent = row.parentElement; parent && parent !== table; parent = parent.parentElement) {
        if (possibleSet.has(parent)) return false;
      }
      return true;
    });
    const rows = [];
    let unsupportedRows = 0;
    for (const row of candidates.slice(0, MAX_RENDERED_ROWS)) {
      const cells = rowCells(row, schema);
      if (!cells || !/^#?\d+[.)]?$/.test(value(cells.rank) || "")) {
        if (row.getAttribute("role") !== "row" || !row.querySelector('[role="columnheader"]')) unsupportedRows++;
        continue;
      }
      rows.push(extractRow(row, cells, schema));
    }
    const currencies = new Set(rows.map(row => row.balanceCurrency).filter(Boolean));
    return {rows, unsupportedRows, renderedLimitReached: candidates.length > MAX_RENDERED_ROWS,
      balanceCurrency: currencies.size === 1 ? [...currencies][0] : rows.length ? null : schema?.currency ?? null,
      hasFeesPaid: Boolean(schema?.fields?.includes("fees") || rows.some(row => row.feesPaid !== null))};
  }

  function createMonitor(onChange) {
    let tokenKey = null;
    let active = false;
    let totalReported = null;
    let table = null;
    let observer = null;
    let timer = null;
    let cacheTruncated = false;
    let fingerprint = "";
    let state = null;
    let previousTokenRows = null;
    let lastRenderedFingerprint = null;
    const observed = new Map();

    function disconnectTable() {
      observer?.disconnect();
      observer = null;
      table = null;
      clearTimeout(timer);
      timer = null;
    }

    function update() {
      timer = null;
      const hidden = table && (!table.getClientRects().length || table.closest('[hidden], [aria-hidden="true"]'));
      let result = active && table && !hidden ? extract(table) : {rows: [], unsupportedRows: 0, renderedLimitReached: false};
      // SPA navigation can change the URL before replacing the previous token's rows.
      const awaitingToken = previousTokenRows !== null && table &&
        JSON.stringify(result.rows) === previousTokenRows;
      if (awaitingToken) result = {...result, rows: []};
      else if (result.rows.length) {
        previousTokenRows = null;
        lastRenderedFingerprint = JSON.stringify(result.rows);
      }
      const uniqueRendered = new Map();
      const rows = [];
      for (const row of result.rows) {
        if (row.walletAddress) {
          const key = addressKey(row.walletAddress);
          // DOM nodes, rank, display names and shortened addresses are never cache keys.
          observed.delete(key);
          observed.set(key, row);
          if (observed.size > MAX_SESSION_WALLETS) {
            observed.delete(observed.keys().next().value);
            cacheTruncated = true;
          }
          if (uniqueRendered.has(key)) {
            rows[uniqueRendered.get(key)] = row;
            continue;
          }
          uniqueRendered.set(key, rows.length);
        }
        rows.push(row);
      }
      const next = {
        tokenKey, totalReported,
        tableStatus: !active ? "inactive" : !table ? "unavailable" : hidden ? "hidden" :
          awaitingToken ? "awaiting-token" : result.unsupportedRows ? "unsupported" : rows.length ? "available" : "empty",
        renderedHolders: rows.length,
        renderedBundlers: rows.filter(row => row.axiomBundler).length,
        observedHolders: observed.size,
        unresolvedRendered: rows.filter(row => !row.walletAddress).length,
        coverage: "partial-virtualized",
        cacheLimit: MAX_SESSION_WALLETS,
        cacheTruncated,
        unsupportedRows: result.unsupportedRows,
        renderedLimitReached: result.renderedLimitReached,
        balanceCurrency: result.balanceCurrency ?? null,
        hasFeesPaid: result.hasFeesPaid ?? false,
        rows
      };
      const nextFingerprint = JSON.stringify(next);
      if (nextFingerprint === fingerprint) return;
      fingerprint = nextFingerprint;
      state = next;
      onChange?.(state);
    }

    function schedule() {
      // Coalesce mutation bursts, with bounded latency while the table updates continuously.
      if (timer === null) timer = setTimeout(update, 180);
    }

    function refresh() {
      const nextTable = active ? document.querySelector(TABLE_SELECTOR) : null;
      if (nextTable !== table) {
        disconnectTable();
        table = nextTable;
        if (table) {
          observer = new MutationObserver(schedule);
          observer.observe(table, {childList: true, subtree: true, characterData: true, attributes: true});
        }
      }
      clearTimeout(timer);
      update();
    }

    return {
      setContext(nextTokenKey, reported, nextActive = true) {
        if (nextTokenKey !== tokenKey) {
          if (tokenKey !== null) previousTokenRows = lastRenderedFingerprint || previousTokenRows;
          lastRenderedFingerprint = null;
          disconnectTable();
          observed.clear();
          cacheTruncated = false;
          fingerprint = "";
          tokenKey = nextTokenKey;
          active = nextActive;
        } else if (nextActive !== active) {
          disconnectTable();
          active = nextActive;
        }
        const parsed = Number(String(reported ?? "").replace(/,/g, ""));
        totalReported = reported !== null && reported !== undefined && reported !== "" &&
          Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
        refresh();
      },
      getState: () => state,
      contains: node => Boolean(table && (table === node || table.contains(node))),
      disconnect() { disconnectTable(); observed.clear(); }
    };
  }

  globalThis.AxiomHolderTableExtractor = Object.freeze({extract, createMonitor, TABLE_SELECTOR});
})();
