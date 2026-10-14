// Read-only observations of Axiom's virtualized Holders table.
(() => {
  "use strict";
  const TABLE_SELECTOR = '[data-perf-id="token-table-holders"]';
  const MAX_RENDERED_ROWS = 500;
  const MAX_SESSION_WALLETS = 1000;
  const clean = text => (text ?? "").replace(/\s+/g, " ").trim();
  const value = node => clean(node?.innerText || node?.textContent) || null;
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
    const lines = (cell.innerText || "").split(/\n+/).map(clean).filter(Boolean);
    if (lines.length > 1) return lines;
    // Inline wrappers often carry an amount and a secondary count/percentage.
    const leaves = Array.from(cell.querySelectorAll("span, div, a, time"))
      .filter(node => !node.children.length).map(value).filter(Boolean);
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
    const rawCount = explicit(cell, `${side}-count`) || countMatch?.[1] || countMatch?.[2];
    const count = rawCount && /^[\d,]+$/.test(rawCount) ? Number(rawCount.replace(/,/g, "")) : null;
    return {
      amount: explicit(cell, `${side}-amount`) || parts.find(part => !/\b(?:buys?|sells?|txns?|transactions?)\b/i.test(part)) || null,
      count: Number.isSafeInteger(count) ? count : null
    };
  }

  function rowCells(row) {
    const roleCells = Array.from(row.querySelectorAll('[role="cell"], [role="gridcell"]'));
    if (roleCells.length === 9) return roleCells;
    let container = row;
    for (let depth = 0; depth < 4 && container; depth++) {
      const children = Array.from(container.children);
      if (children.length === 9) return children;
      if (children.length !== 1) break;
      container = children[0];
    }
    return null;
  }

  function extractRow(row, cells) {
    const walletAddress = publicAddress(cells[1]);
    const bought = trade(cells[3], "buy");
    const sold = trade(cells[4], "sell");
    const remainingParts = fragments(cells[6]);
    const remainingPercentage = explicit(cells[6], "remaining-percentage") ||
      remainingParts.join(" ").match(/-?\d+(?:\.\d+)?\s*%/)?.[0] || null;
    const activityParts = [...fragments(cells[1]), ...fragments(cells[2])];
    return {
      rank: value(cells[0]),
      walletDisplay: explicit(cells[1], "wallet") || fragments(cells[1])[0] || null,
      walletAddress,
      identityStatus: walletAddress ? "resolved" : "unresolved",
      solBalance: explicit(cells[2], "sol-balance") || fragments(cells[2])[0] || null,
      lastActive: explicit(cells[1], "last-active") || explicit(cells[2], "last-active") ||
        activityParts.find(part => /\b(?:last\s*active|ago|just now)\b/i.test(part) || /^\d+(?:\.\d+)?\s*[smhdw]$/.test(part)) || null,
      boughtAmount: bought.amount,
      buyCount: bought.count,
      soldAmount: sold.amount,
      sellCount: sold.count,
      unrealizedPnl: value(cells[5]),
      remainingTokenValue: explicit(cells[6], "remaining-value") ||
        remainingParts.find(part => !part.includes("%")) || null,
      remainingPercentage,
      fundingSourceLabel: explicit(cells[7], "funding-source") || fragments(cells[7])[0] || null,
      fundingTransactionUrl: transactionUrl(cells[7]),
      holdingDuration: value(cells[8]),
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
      const cells = rowCells(row);
      if (!cells || !/^#?\d+[.)]?$/.test(value(cells[0]) || "")) {
        if (row.getAttribute("role") !== "row" || !row.querySelector('[role="columnheader"]')) unsupportedRows++;
        continue;
      }
      rows.push(extractRow(row, cells));
    }
    return {rows, unsupportedRows, renderedLimitReached: candidates.length > MAX_RENDERED_ROWS};
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
