/* Real browser DOM fixtures based on supplied Solana and EVM Holders layouts. */
(async () => {
  "use strict";
  const results = [];
  const scriptErrors = [];
  window.addEventListener("error", event => scriptErrors.push(event.message));
  window.addEventListener("unhandledrejection", event => scriptErrors.push(String(event.reason)));
  const fixture = document.getElementById("fixture");
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const rowValues = rows => JSON.stringify(rows, (key, value) => ["observedAt", "extractionId", "tokenContext"].includes(key) ? undefined : value);
  const test = async (name, fn) => {
    document.getElementById("results").textContent = JSON.stringify({passed: results.length, running: name});
    await fn();
    results.push(name);
  };
  const loadScript = (doc, url) => new Promise((resolve, reject) => {
    const script = doc.createElement("script");
    script.src = url;
    script.onload = resolve;
    script.onerror = reject;
    doc.head.appendChild(script);
  });
  const addressA = "11111111111111111111111111111111";
  const addressB = "So11111111111111111111111111111111111111112";
  const rowHtml = (address = null, bundler = true, rank = 1) => `
    <div style="position: absolute; top: ${(rank - 1) * 48}px; height: 48px"><div>
      <div>${rank}</div>
      <div><span data-field="wallet">Same…name</span>${address ? `<a href="https://solscan.io/account/${address}">↗</a>` : ""}<span data-field="last-active">2m ago</span><img alt="${bundler ? "Bundler" : "Sniper"}"></div>
      <div><span>3.25 SOL</span></div>
      <div><span>$400</span><span>3 buys</span></div>
      <div><span>$100</span><span>1 sell</span></div>
      <div>+$80</div>
      <div><span>$380</span><span>1.2%</span></div>
      <div><span>Binance</span><a href="https://solscan.io/tx/funding-signature">↗</a></div>
      <div>14m</div>
    </div></div>`;
  const makeTable = html => { fixture.innerHTML = `<div data-perf-id="token-table-holders">${html}</div>`; return fixture.firstElementChild; };
  const capturedTable = async name => {
    fixture.innerHTML = await (await fetch(`fixtures/holders-${name}.html`)).text();
    return fixture.querySelector('[data-perf-id="token-table-holders"]');
  };
  let monitor;
  try {
    await test("Cached DOM reads remain fresh without inventing price changes, decode HTML subscripts and guard token transitions", async () => {
      fixture.innerHTML = '<div><span>Price</span><span>$0.1</span></div><div><span>Market Cap</span><span>$10M</span></div>';
      let clock = 100000;
      const observations = [];
      const model = AxiomRollingChart.createStore({now: () => clock}); model.setToken({sourceKey: "token-a"});
      const reader = AxiomLiveValueObserver.createReader((type, parsed, at, details) => {
        observations.push({type, parsed, at}); model.observe(type, parsed, at, details);
      }, () => clock);
      const spans = [...fixture.querySelectorAll("span")];
      reader.setToken("token-a"); reader.bind(spans);
      assert(observations.find(row => row.type === "marketCap").parsed.value === 10000000, "Independent market cap display parsed");
      const originalCount = observations.length;
      clock += 2000; reader.bind(spans); reader.checkAvailability();
      assert(observations.length === originalCount + 2, "Successful unchanged reads are fresh local observations");
      const unchanged = model.tick(clock).series.price.samples.at(-1);
      assert(unchanged.domReadAt === clock && unchanged.valueChangedAt === 100000, "Read time and change time remain independent");
      const observer = new MutationObserver(records => reader.mutations(records));
      observer.observe(fixture, {childList: true, subtree: true, characterData: true});
      spans[1].textContent = "$0.2"; await pause(10);
      assert(observations.at(-1).parsed.value === 0.2 && observations.at(-1).at === clock, "Relevant mutation observed immediately");
      reader.setToken("token-b"); reader.bind(spans);
      assert(observations.at(-1).parsed === null, "Unchanged old-token text not reused");
      spans[1].textContent = "$0.3"; await pause(10);
      assert(observations.at(-1).parsed.value === 0.3, "New token's mutation accepted");
      fixture.innerHTML = '<div><span>Price</span><span>$0.0<sub>5</sub>123</span></div>';
      reader.bind([...fixture.querySelectorAll("span")]);
      assert(observations.findLast(row => row.type === "price").parsed.value === 0.00000123, "Semantic HTML subscript zero count decoded");
      fixture.innerHTML = '<div><span>Price</span><span>$0.0<span class="align-sub">12</span>45</span></div>';
      reader.bind([...fixture.querySelectorAll("span")]);
      assert(observations.findLast(row => row.type === "price").parsed.value === 0.00000000000045, "CSS subscript marker decoded");
      fixture.innerHTML = '<div><span>Price</span><span title="0.00000123">$0.0₅123</span></div>';
      reader.bind([...fixture.querySelectorAll("span")]);
      assert(observations.findLast(row => row.type === "price").parsed.unit === "USD", "Full-value tooltip preserves displayed currency");
      observer.disconnect();
    });
    await test("Liquidity reader performs bounded fresh reads, preserves displayed text and guards rapid token switches", () => {
      fixture.innerHTML = '<div><span>Liquidity</span><span title="999999">$5.56K</span></div>';
      let clock = Date.now();
      const reader = AxiomLiveValueObserver.createReader(() => {}, () => clock, [["liquidity", ["liquidity"]]]);
      const spans = [...fixture.querySelectorAll("span")];
      reader.setToken("a"); reader.bind(spans);
      assert(reader.readAttempt("liquidity").displayText === "$5.56K", "Original display is retained instead of a tooltip");
      clock += 5000;
      assert(reader.readAttempt("liquidity").domReadAt === clock, "Unchanged text receives a new actual DOM read time");
      reader.setToken("b"); reader.bind(spans);
      reader.setToken("c"); reader.bind(spans);
      assert(reader.readAttempt("liquidity").status === "awaiting-token", "Rapid token changes cannot reuse old-token liquidity");
      spans[1].textContent = "$1.2M"; reader.bind(spans);
      assert(AxiomLiquidityHistory.parseAmount(reader.readAttempt("liquidity").displayText).value === 1200000, "New value is read directly");
      spans[0].parentElement.hidden = true;
      assert(reader.readAttempt("liquidity").displayText === null, "Hidden cells are unavailable");
      spans[0].parentElement.hidden = false; spans[0].parentElement.remove();
      assert(reader.readAttempt("liquidity").displayText === null, "Detached cached cells are unavailable");
    });
    await test("Rendered row fields, full identity, funding URL and reserved fields", () => {
      const table = makeTable(rowHtml(addressA));
      document.getElementById("market").innerHTML = '<img alt="Bundler">';
      const {rows} = AxiomHolderTableExtractor.extract(table);
      assert(rows.length === 1, "Only table rows extracted");
      const row = rows[0];
      const expected = {rank: "1", walletDisplay: "Same…name", walletAddress: addressA,
        identityStatus: "resolved", solBalance: "3.25 SOL", lastActive: "2m ago",
        boughtAmount: "$400", buyCount: 3, soldAmount: "$100", sellCount: 1,
        unrealizedPnl: "+$80", remainingTokenValue: "$380", remainingPercentage: "1.2%",
        fundingSourceLabel: "Binance", fundingTransactionUrl: "https://solscan.io/tx/funding-signature",
        holdingDuration: "14m", axiomBundler: true};
      for (const [key, value] of Object.entries(expected)) assert(row[key] === value, `${key}: ${row[key]}`);
      for (const key of ["commonFundingSource", "similarSolBalancePatterns", "synchronizedBuys", "sameBlockActivity", "clusterId", "evidenceScore", "clusterConfidence"]) {
        assert(row[key] === null, `${key} must remain null`);
      }
    });
    await test("Exact Bundler badge, unrelated badges ignored, unresolved identities separate", () => {
      const {rows} = AxiomHolderTableExtractor.extract(makeTable(rowHtml(null, false) + rowHtml(null, true, 2)));
      assert(rows.length === 2 && !rows[0].axiomBundler && rows[1].axiomBundler, "Badge scope/classification");
      assert(rows.every(row => row.identityStatus === "unresolved"), "Names are not identities");
    });
    await test("Captured BNB rows map Fees Paid and ignore Follow Sell controls", async () => {
      const table = await capturedTable("bnb");
      let clicks = 0;
      table.addEventListener("click", () => clicks++);
      const result = AxiomHolderTableExtractor.extract(table);
      assert(result.rows.length === 2 && result.unsupportedRows === 0 && result.hasFeesPaid, "Captured wallet rows supported");
      assert(result.balanceCurrency === "BNB", "Header/badge currency identified");
      const row = result.rows[0];
      const expected = {rank: "75", walletDisplay: "0x4efd...53be", walletAddress: null,
        identityStatus: "unresolved", nativeBalance: "0.134", balanceCurrency: "BNB", solBalance: null,
        lastActive: "2m", boughtAmount: "$0.566", buyCount: 22, soldAmount: "$0", sellCount: 0,
        unrealizedPnl: "+$60.46", feesPaid: "0.0003", feesPaidCurrency: "BNB",
        remainingTokenValue: "$61.03", remainingPercentage: "0.272%", fundingSourceLabel: "0xd878...8579",
        holdingDuration: "51m", axiomBundler: false};
      for (const [key, value] of Object.entries(expected)) assert(row[key] === value, `${key}: ${row[key]}`);
      assert(row.fundingTransactionUrl?.startsWith("https://bscscan.com/tx/"), "Funding transaction retained without treating it as wallet identity");
      assert(clicks === 0 && table.scrollTop === 0, "Extraction never clicks or scrolls");
    });
    await test("Captured ETH pool and wallet rows preserve tiny amounts and partial identities", async () => {
      const result = AxiomHolderTableExtractor.extract(await capturedTable("eth"));
      assert(result.rows.length === 3 && result.unsupportedRows === 0 && result.balanceCurrency === "ETH", "Headerless pool/wallet variants recognized conservatively");
      const [pool, wallet, tiny] = result.rows;
      assert(pool.walletDisplay === "UNISWAP V4 POOL" && pool.nativeBalance === "25K" && pool.feesPaid === "0", "Pool layout has no Follow Sell control");
      assert(pool.remainingPercentage === "99.97%" && pool.fundingSourceLabel === "Uniswap V4 pool", "Pool fields do not shift");
      assert(wallet.nativeBalance === "0.002" && wallet.lastActive === "3h" && wallet.feesPaid === "0.00001", "Balance subscripts exclude activity text");
      assert(wallet.boughtAmount === "$0.878" && wallet.buyCount === 2 && wallet.remainingTokenValue === "$0.525", "Trade amount/count separated from average and Remaining");
      assert(tiny.remainingTokenValue === "$0.00000000007" && tiny.remainingPercentage === "0.000000000002%", "Multi-digit zero-count subscripts decoded as displayed strings");
      assert(result.rows.every(row => row.walletAddress === null && row.solBalance === null && !row.axiomBundler), "Abbreviations, protocol and GMGN icons do not imply identity or bundling");
    });
    await test("Nested CSS subscripts preserve complete holder amounts and percentages", async () => {
      const table = await capturedTable("eth");
      const before = AxiomHolderTableExtractor.extract(table).rows;
      for (const [index, sub] of [...table.querySelectorAll("sub")].entries()) {
        const wrapper = document.createElement("span"), digits = document.createElement("span");
        if (index % 2) wrapper.style.verticalAlign = "sub";
        else wrapper.className = "align-sub";
        digits.textContent = sub.textContent; wrapper.appendChild(digits); sub.replaceWith(wrapper);
      }
      assert(rowValues(AxiomHolderTableExtractor.extract(table).rows) === rowValues(before), "CSS digit wrappers must not become standalone balances, fees or Remaining fields");
    });
    await test("Incomplete headers reject positional fallback, and case-insensitive headers preserve reordered fields", async () => {
      let table = await capturedTable("bnb");
      const before = AxiomHolderTableExtractor.extract(table).rows;
      const containers = [table.firstElementChild, ...Array.from(table.querySelectorAll('[style]'))
        .filter(row => row.style.position === "absolute").map(row => row.firstElementChild)];
      for (const container of containers) {
        const cells = [...container.children].filter(cell => !cell.classList.contains("w-0"));
        container.insertBefore(cells[9], cells[8]); // Held before Funding.
      }
      const walletLabel = [...table.firstElementChild.querySelectorAll("span")].find(node => node.textContent === "Wallet");
      walletLabel.textContent = "WALLET";
      assert(rowValues(AxiomHolderTableExtractor.extract(table).rows) === rowValues(before), "Uppercase header still maps Funding/Held by name");
      table = await capturedTable("bnb");
      const boughtLabel = [...table.firstElementChild.querySelectorAll("span")].find(node => /^Bought\b/.test(node.textContent));
      boughtLabel.textContent = "Unknown trade column";
      const result = AxiomHolderTableExtractor.extract(table);
      assert(result.rows.length === 0 && result.unsupportedRows === 2, "Partially recognized header cannot be treated as a headerless EVM layout");
      const header = table.firstElementChild;
      for (const cell of header.children) cell.setAttribute("role", "columnheader");
      [...header.querySelectorAll("span")].find(node => node.textContent === "Wallet").textContent = "Account";
      assert(AxiomHolderTableExtractor.extract(table).rows.length === 0, "Explicit unsupported column headers cannot trigger positional guessing either");
    });
    await test("Conflicting balance currencies stay unresolved instead of inheriting the table header", async () => {
      const table = await capturedTable("bnb");
      const row = [...table.querySelectorAll('[style]')].find(node => node.style.position === "absolute");
      const balance = [...row.firstElementChild.children].filter(cell => !cell.classList.contains("w-0"))[2];
      const conflicting = document.createElement("img"); conflicting.alt = "ETH"; balance.appendChild(conflicting);
      let holder = AxiomHolderTableExtractor.extract(table).rows[0];
      assert(holder.balanceCurrency === null && holder.solBalance === null, "BNB/ETH badge conflict must not be guessed as BNB");
      balance.querySelectorAll("img").forEach(image => image.remove());
      holder = AxiomHolderTableExtractor.extract(table).rows[0];
      assert(holder.balanceCurrency === "BNB", "A missing row unit can use an explicit BNB header");
      balance.querySelector("span").textContent = "0.134 BNB ETH";
      assert(AxiomHolderTableExtractor.extract(table).rows[0].balanceCurrency === null, "Multiple textual currency units are also ambiguous");
    });
    await test("Captured Solana layout and reordered EVM headers retain named field mappings", async () => {
      const sol = AxiomHolderTableExtractor.extract(await capturedTable("sol"));
      assert(sol.rows.length === 2 && sol.unsupportedRows === 0 && !sol.hasFeesPaid, "Captured nine-column table preserved");
      assert(sol.rows[0].nativeBalance === "37.64" && sol.rows[0].lastActive === "0s" && sol.rows[0].solBalance === "37.64", "Solana balance/activity preserved");
      assert(sol.rows[1].walletDisplay === "kuryakin" && sol.rows[1].buyCount === 2 && sol.rows[1].sellCount === 1, "Wallet labels and ratio counts do not include Label control");
      const table = await capturedTable("bnb");
      const before = AxiomHolderTableExtractor.extract(table).rows;
      // Swap Fees Paid and Remaining in both header and row data.
      const containers = [table.firstElementChild, ...Array.from(table.querySelectorAll('[style]'))
        .filter(row => row.style.position === "absolute").map(row => row.firstElementChild)];
      for (const container of containers) {
        const cells = Array.from(container.children).filter(cell => !cell.classList.contains("w-0"));
        container.insertBefore(cells[7], cells[6]);
      }
      assert(rowValues(AxiomHolderTableExtractor.extract(table).rows) === rowValues(before), "Header order maps fields instead of fixed offsets");
      const heldHeader = Array.from(table.firstElementChild.querySelectorAll("span")).find(node => node.textContent === "Held");
      heldHeader.textContent = "Unknown duration";
      assert(AxiomHolderTableExtractor.extract(table).unsupportedRows === 2, "An unrecognized required header never falls back to guessed offsets");
      const unknown = makeTable(rowHtml(null, false));
      unknown.firstElementChild.firstElementChild.appendChild(document.createElement("div"));
      assert(AxiomHolderTableExtractor.extract(unknown).unsupportedRows === 1, "An unexplained tenth cell is rejected rather than guessed");
    });
    await test("ARIA headers map reordered cells and EVM fee mutations remain scoped", async () => {
      const table = await capturedTable("bnb");
      const header = table.firstElementChild;
      header.setAttribute("role", "row");
      for (const cell of header.children) cell.setAttribute("role", "columnheader");
      const rows = Array.from(table.querySelectorAll('[style]')).filter(row => row.style.position === "absolute");
      for (const row of rows) for (const cell of row.firstElementChild.children) {
        if (!cell.classList.contains("w-0")) cell.setAttribute("role", "gridcell");
      }
      const initial = AxiomHolderTableExtractor.extract(table);
      assert(initial.rows.length === 2 && initial.unsupportedRows === 0, "ARIA header row is not treated as a holder");
      let changes = 0;
      const evmMonitor = AxiomHolderTableExtractor.createMonitor(() => changes++);
      evmMonitor.setContext("bnb-token", 1810);
      assert(evmMonitor.getState().tableStatus === "available" && evmMonitor.getState().hasFeesPaid, "EVM layout becomes available in normal monitor flow");
      assert(evmMonitor.getState().observedHolders === 0 && evmMonitor.getState().unresolvedRendered === 2, "Abbreviated wallets are not retained as unique identities");
      const feeCell = rows[0].firstElementChild.children[7];
      feeCell.querySelector("span").textContent = "0.004";
      document.getElementById("market").textContent = "Outside change";
      await pause(220);
      assert(changes === 2 && evmMonitor.getState().rows[0].feesPaid === "0.004", "Fee mutation published once by scoped observer");
      evmMonitor.disconnect();
    });
    await test("Monitor scopes updates, coalesces bursts, skips unchanged values", async () => {
      makeTable(rowHtml(addressA));
      let changes = 0;
      monitor = AxiomHolderTableExtractor.createMonitor(() => changes++);
      monitor.setContext("token-a", "1,234");
      assert(monitor.getState().totalReported === 1234, "Reported total parsed");
      assert(monitor.getState().observedHolders === 1, "Resolved session observation counted");
      const table = fixture.firstElementChild;
      for (let index = 0; index < 30; index++) table.firstElementChild.setAttribute("data-animation", index);
      document.getElementById("market").textContent = "Outside change";
      await pause(220);
      assert(changes === 1, "Irrelevant attributes do not send updates");
      table.querySelector('img[alt="Bundler"]').alt = "Sniper";
      await pause(220);
      assert(changes === 2 && monitor.getState().renderedBundlers === 0, "Badge attribute changes observed");
    });
    await test("Recycled rows use full addresses; unresolved rows never merged across scrolls", async () => {
      const table = fixture.firstElementChild;
      table.firstElementChild.innerHTML = new DOMParser().parseFromString(rowHtml(addressB, false), "text/html").body.firstElementChild.innerHTML;
      await pause(220);
      assert(monitor.getState().observedHolders === 2, "Recycled node represents a second wallet");
      table.innerHTML = rowHtml(null, true) + rowHtml(null, false, 2);
      await pause(220);
      assert(monitor.getState().renderedHolders === 2 && monitor.getState().unresolvedRendered === 2, "Unresolved rows stay distinct");
      assert(monitor.getState().observedHolders === 2, "Unresolved rows are not counted as unique session wallets");
      table.innerHTML = rowHtml(addressA) + rowHtml(addressA, true, 2);
      await pause(220);
      assert(monitor.getState().renderedHolders === 1 && monitor.getState().observedHolders === 2, "Full-address duplicates deduplicated");
    });
    await test("Token changes reset cache and disconnect old table; missing/hidden/empty handled", async () => {
      const old = fixture.firstElementChild;
      const replacement = makeTable(rowHtml(addressB, false));
      monitor.setContext("token-b", 40);
      assert(monitor.getState().observedHolders === 1 && monitor.getState().rows[0].walletAddress === addressB, "Session reset");
      old.innerHTML = rowHtml(addressA);
      await pause(220);
      assert(monitor.getState().observedHolders === 1, "Detached observer disconnected");
      replacement.hidden = true;
      await pause(220);
      assert(monitor.getState().tableStatus === "hidden" && !monitor.getState().rows.length, "Hidden state");
      fixture.replaceChildren();
      monitor.setContext("token-b", null);
      assert(monitor.getState().tableStatus === "unavailable" && monitor.getState().totalReported === null, "Missing state");
      makeTable(""); monitor.setContext("token-b", 0);
      assert(monitor.getState().tableStatus === "empty", "Empty state");
      monitor.disconnect();
    });
    await test("Unknown row layouts and missing fields remain unavailable", () => {
      const table = makeTable('<div style="position:absolute;top:0;height:48px"><div>unexpected layout</div></div>');
      assert(AxiomHolderTableExtractor.extract(table).unsupportedRows === 1, "Layout blocker detected");
      makeTable(rowHtml(null, false));
      const cells = fixture.firstElementChild.firstElementChild.firstElementChild.children;
      for (let index = 2; index < 9; index++) cells[index].replaceChildren();
      const row = AxiomHolderTableExtractor.extract(fixture.firstElementChild).rows[0];
      assert(row.solBalance === null && row.buyCount === null && row.remainingPercentage === null && row.fundingTransactionUrl === null, "Missing values null");
    });
    await test("Token route changes reject unchanged previous-token rows", async () => {
      makeTable(rowHtml(addressA));
      monitor = AxiomHolderTableExtractor.createMonitor();
      monitor.setContext("token-a", 20);
      monitor.setContext("token-b", 30);
      assert(monitor.getState().tableStatus === "awaiting-token" && monitor.getState().observedHolders === 0 && !monitor.getState().rows.length, "Old rows cleared before new rows arrive");
      monitor.setContext("token-c", 40);
      assert(monitor.getState().tableStatus === "awaiting-token" && monitor.getState().observedHolders === 0, "Rapid token hops retain the stale-row guard");
      fixture.firstElementChild.innerHTML = rowHtml(addressB);
      await pause(220);
      assert(monitor.getState().observedHolders === 1 && monitor.getState().rows[0].walletAddress === addressB, "New token rows accepted");
      monitor.setContext("token-c", null, false);
      assert(monitor.getState().observedHolders === 1 && !monitor.getState().rows.length, "Temporary missing market data keeps session history");
      monitor.disconnect();
    });
    await test("Cache stays bounded across 1,005 identified wallets; no source scrolling", () => {
      const table = makeTable(rowHtml(addressA));
      monitor = AxiomHolderTableExtractor.createMonitor();
      const anchor = table.querySelector("a");
      for (let index = 0; index < 1005; index++) {
        anchor.href = `https://bscscan.com/address/0x${index.toString(16).padStart(40, "0")}`;
        monitor.setContext("bounded-token", 9000);
      }
      assert(monitor.getState().observedHolders === 1000 && monitor.getState().cacheTruncated, "Bounded address cache");
      assert(table.scrollTop === 0 && window.scrollY === 0, "No automatic scroll");
      monitor.disconnect();
    });
    await test("Supplied captures expose native balance/value/percentage separately and do not expose sort or verified classifications", async () => {
      for (const name of ["sol", "bnb", "eth"]) {
        const result = AxiomHolderTableExtractor.extract(await capturedTable(name));
        assert(result.activeTable.kind === "holders" && result.sort.label === "Sort order unknown", "Table marker identifies Holders; empty sort buttons prove no direction");
        assert(result.rows.every(row => row.tokenQuantity === null && row.remainingTokenValue?.startsWith("$") && row.remainingValueCurrency === "USD"), "Dollars are holding values, never token quantities");
        assert(result.rows.every(row => row.classification.category === "unknown" && row.classification.verificationStatus === "unverified"), "Names/icons alone cannot establish pools or contracts");
      }
    });
    await test("Hidden DOM rows do not enter current holder extraction or the session cache", () => {
      for (const hide of [row => row.hidden = true, row => row.setAttribute("aria-hidden", "true"),
        row => row.style.display = "none", row => row.style.visibility = "hidden"]) {
        const table = makeTable(rowHtml(addressA) + rowHtml(addressB, false, 2)); hide(table.firstElementChild);
        const rows = AxiomHolderTableExtractor.extract(table).rows;
        assert(rows.length === 1 && rows[0].walletAddress === addressB, "Only the available rendered row may contribute");
        const m = AxiomHolderTableExtractor.createMonitor(); m.setContext("hidden-rows", 100);
        assert(m.getState().observedHolders === 1 && m.getState().renderedHolders === 1, "Hidden entries are not cached as current observations");
        m.disconnect();
      }
    });
    await test("Conflicting full address hints stay unresolved instead of selecting the first address", () => {
      const table = makeTable(rowHtml(addressA));
      const wallet = table.firstElementChild.firstElementChild.children[1];
      wallet.dataset.walletAddress = addressB;
      let row = AxiomHolderTableExtractor.extract(table).rows[0];
      assert(row.walletAddress === null && row.identityStatus === "conflicting", "Contradictory full-address evidence cannot become one wallet");
      const m = AxiomHolderTableExtractor.createMonitor(); m.setContext("identity-conflict", 100);
      assert(m.getState().observedHolders === 0 && m.getState().unresolvedRendered === 1, "Conflicting identities are not session cache keys");
      m.disconnect(); wallet.dataset.walletAddress = addressA;
      row = AxiomHolderTableExtractor.extract(table).rows[0];
      assert(row.walletAddress === addressA && row.identityStatus === "resolved", "Repeated consistent address evidence is accepted once");
    });
    await test("Active Top Traders views cannot reuse Holders rows; only explicit header sort is captured", async () => {
      const table = await capturedTable("sol");
      const selected = document.createElement("button"); selected.setAttribute("role", "tab"); selected.setAttribute("aria-selected", "true"); selected.textContent = "Top Traders";
      fixture.prepend(selected);
      let result = AxiomHolderTableExtractor.extract(table);
      assert(result.rows.length === 0 && result.activeTable.kind === "top-traders", "Selected Top Traders suppresses old holder rows");
      const m = AxiomHolderTableExtractor.createMonitor(); m.setContext("view-token", 2);
      assert(m.getState().tableStatus === "other-view", "Other-view reason propagates through the monitor");
      selected.textContent = "Holders";
      const remaining = [...table.firstElementChild.children].find(node => node.textContent === "Remaining");
      remaining.setAttribute("aria-sort", "descending");
      result = AxiomHolderTableExtractor.extract(table);
      assert(result.sort.column === "remaining" && result.sort.direction === "descending", "Explicit captured header structure supports ARIA sort when exposed");
      remaining.setAttribute("aria-sort", "ascending");
      assert(AxiomHolderTableExtractor.extract(table).sort.direction === "ascending", "Incorrect direction stays explicit");
      remaining.removeAttribute("aria-sort");
      assert(AxiomHolderTableExtractor.extract(table).sort.column === null, "Missing direction returns unknown");
      selected.remove(); table.setAttribute("data-perf-id", "token-table-top-traders");
      assert(AxiomHolderTableExtractor.extract(table).rows.length === 0, "Top Traders marker is never parsed as holder data");
      const hiddenHolders = document.createElement("div"); hiddenHolders.dataset.perfId = "token-table-holders"; hiddenHolders.hidden = true; fixture.prepend(hiddenHolders);
      m.setContext("view-token", 2);
      assert(m.getState().tableStatus === "other-view", "A hidden cached holder table cannot obscure the visible other view");
      m.disconnect();
    });
    await test("Explicit classifications and quantities are sourced, while malformed percentages and dollar quantities remain invalid", () => {
      const table = makeTable(rowHtml(addressA));
      const context = {sourceKey: "classification-token", blockchain: "solana", mintAddress: addressB, poolAddress: addressA};
      let result = AxiomHolderTableExtractor.extract(table, {context});
      assert(result.rows[0].classification.category === "pool" && result.rows[0].classification.verificationStatus === "axiom-reported", "Full address matching an explicit Axiom pool hint can support a reported pool classification");
      const wallet = table.firstElementChild.firstElementChild.children[1];
      const badge = document.createElement("span"); badge.dataset.field = "wallet-classification"; wallet.appendChild(badge);
      for (const [text, category] of [["Pool", "pool"], ["Burn destination", "burn"], ["Locker", "locker"], ["Other known contract", "other-contract"]]) {
        badge.textContent = text;
        assert(AxiomHolderTableExtractor.extract(table).rows[0].classification.category === category, "Only an explicit semantic classification field establishes the reported category");
      }
      const remaining = table.firstElementChild.firstElementChild.children[6];
      remaining.innerHTML = '<span>$380</span><span data-field="token-quantity">150K</span><span>1.2.3%</span>';
      result = AxiomHolderTableExtractor.extract(table);
      assert(result.rows[0].tokenQuantity === "150K" && result.rows[0].remainingTokenValue === "$380", "Explicit current quantity remains separate from value");
      assert(AxiomHolderConcentration.percentage(result.rows[0].remainingPercentage) === null, "Malformed percentages are not substring-salvaged");
      remaining.querySelector('[data-field="token-quantity"]').textContent = "$380";
      assert(AxiomHolderTableExtractor.extract(table).rows[0].tokenQuantity === null, "A dollar field cannot become token quantity");
    });
    await test("Actual extraction times refresh only current rows; cached session ages and same-route token guards remain separate", async () => {
      const table = makeTable(rowHtml(addressA));
      const context = {sourceKey: "time-token-a", blockchain: "solana", mintAddress: addressB, poolAddress: null};
      const m = AxiomHolderTableExtractor.createMonitor(); m.setContext("same-route", 100, true, context);
      const first = m.getState(), copiedAt = first.rows[0].observedAt;
      assert(first.extractedAt === copiedAt && first.rows[0].tokenContext.sourceKey === context.sourceKey, "Rows carry actual extraction time and network/token context");
      const republished = {...first, capturedAt: copiedAt + 60000};
      assert(republished.rows[0].observedAt === copiedAt, "Republishing never refreshes row time");
      table.innerHTML = rowHtml(addressB, true, 2); await pause(220);
      const next = m.getState();
      assert(next.observedHolders === 2 && next.rows.length === 1 && next.rows[0].observedAt > copiedAt, "Current rows refresh while session count retains older observations");
      assert(next.sessionOldestObservedAt === copiedAt && next.sessionNewestObservedAt === next.extractedAt, "Session observation range remains mixed-age and explicit");
      m.setContext("same-route", 100, true, {...context, sourceKey: "time-token-b", mintAddress: addressA});
      assert(m.getState().tableStatus === "awaiting-token" && m.getState().observedHolders === 0, "Network/token context changes reset and guard even on the same route");
      m.disconnect();
    });
    let sent = [];
    let dashboardFixture;
    const statsMessages = () => sent.filter(message => message.type === "AXIOM_STATS_UPDATE");
    await test("Existing market stats and holder tab count share the existing message", async () => {
      makeTable(rowHtml(addressA));
      document.getElementById("market").innerHTML = [
        ["Global Fees Paid", "12 SOL"], ["Price", "$0.001"], ["Liquidity", "$20K"],
        ["Supply", "1B"], ["ATH", "$0.002"], ["5m Vol", "$4K"], ["Buys", "10 / $3K"],
        ["Sells", "5 / $1K"], ["Net Vol.", "+$2K"]
      ].map(([label, value]) => `<div><span>${label}</span><span>${value}</span></div>`).join("") +
        '<button role="tab"><span>Holders (1,234)</span></button><div><div><span>12.5%</span></div><div><span>Bundlers</span></div></div>' +
        await (await fetch("fixtures/top-ten-holders.html")).text();
      window.chrome = {runtime: {sendMessage(message, callback) { sent.push(message); callback?.(); }}};
      await loadScript(document, "../content.js");
      await pause(620);
      const snapshot = statsMessages().at(-1)?.snapshot;
      assert(statsMessages().at(-1)?.type === "AXIOM_STATS_UPDATE", "Existing message reused");
      assert(snapshot.stats.globalFees === "12 SOL" && snapshot.stats.price === "$0.001" && snapshot.stats.volume5m === "$4K", "Core market stats unchanged");
      for (const [key, expected] of Object.entries({liquidity: "$20K", supply: "1B", ath: "$0.002", buys: "10 / $3K", sells: "5 / $1K", netVolume: "+$2K", holders: "1,234", bundlers: "12.5%", top10Holders: "14.05%"})) {
        assert(snapshot.stats[key] === expected, `${key} preserved`);
      }
      assert(snapshot.holdersIntelligence.totalReported === 1234 && snapshot.holdersIntelligence.renderedBundlers === 1, "Holder snapshot attached");
      assert(snapshot.holdersIntelligence.tokenKey === snapshot.tokenKey, "Token association");
    });
    await test("Top 10 holder tile reads its own percentage, updates zero and clears invalid or hidden values", async () => {
      const label = [...document.querySelectorAll("#market span")].find(node => node.textContent === "Top 10 H.");
      const card = label.parentElement.parentElement, value = card.querySelector("span");
      for (const [text, expected] of [["0%", "0%"], ["101%", null], ["—", null], ["14.05%", "14.05%"]]) {
        value.textContent = text; await pause(560);
        assert(statsMessages().at(-1).snapshot.stats.top10Holders === expected, `Top 10 value ${text} stays scoped/validated`);
        assert(statsMessages().at(-1).snapshot.stats.bundlers === "12.5%", "Nearby Bundlers value is separate");
      }
      card.hidden = true; await pause(560);
      assert(statsMessages().at(-1).snapshot.stats.top10Holders === null, "Hidden top-holder tile is unavailable");
      card.hidden = false; await pause(560);
      assert(statsMessages().at(-1).snapshot.stats.top10Holders === "14.05%", "Visible tile restores its displayed percentage");
    });
    await test("Holder mutations publish changed data without scanning the document", async () => {
      let scans = 0;
      const original = document.querySelectorAll;
      document.querySelectorAll = function (selector) {
        if (selector === "span") scans++;
        return original.call(this, selector);
      };
      const before = statsMessages().length;
      fixture.firstElementChild.querySelector('img[alt="Bundler"]').alt = "Sniper";
      await pause(230);
      document.querySelectorAll = original;
      assert(scans === 0, "No document-wide market scan for holder mutation");
      assert(statsMessages().length === before + 1 && statsMessages().at(-1).snapshot.holdersIntelligence.renderedBundlers === 0, "Changed holder snapshot published once");
    });
    await test("Selected-view attribute changes propagate without changing holder row markup", async () => {
      const tab = document.createElement("button"); tab.setAttribute("role", "tab"); tab.textContent = "Top Traders";
      document.getElementById("market").appendChild(tab);
      tab.setAttribute("aria-selected", "true"); await pause(560);
      assert(statsMessages().at(-1).snapshot.holdersIntelligence.tableStatus === "other-view", "Selection-only changes clear current holder results");
      tab.setAttribute("aria-selected", "false"); await pause(560);
      assert(statsMessages().at(-1).snapshot.holdersIntelligence.tableStatus === "available", "Returning to Holders restores current extraction");
      tab.remove();
    });
    await test("Price mutations feed the sampler while unchanged polling and one-second ticks never scan all spans", async () => {
      const priceLabel = [...document.getElementById("market").querySelectorAll("span")].find(node => node.textContent === "Price");
      const price = priceLabel.nextElementSibling;
      let scans = 0;
      const original = document.querySelectorAll;
      document.querySelectorAll = function (selector) { if (selector === "span") scans++; return original.call(this, selector); };
      price.textContent = "$0.002";
      await pause(2250);
      document.querySelectorAll = original;
      const packet = sent.filter(message => message.type === "AXIOM_DOM_CHART_UPDATE").at(-1)?.packet;
      assert(packet?.series.price.samples.at(-1).value === 0.002, "Changed numeric DOM price sampled");
      assert(packet.series.price.samples.at(-1).unit === "USD" && scans === 0, "Cached price scope, no full-document scan");
      assert(Number.isFinite(packet.series.price.samples.at(-1).domReadDurationMs) &&
        packet.series.price.samples.at(-1).collectorDurationMs >= packet.series.price.samples.at(-1).domReadDurationMs, "Sampler measures read and collector work separately from timer delay");
      const recent = sent.filter(message => message.type === "AXIOM_DOM_CHART_UPDATE").slice(-2)
        .map(message => message.packet.series.price.samples.at(-1));
      assert(recent.length === 2 && recent[1].timestamp - recent[0].timestamp === 1 &&
        Math.abs(recent[1].sampledAt - recent[0].sampledAt - 1000) < 200, "Visible source samples approximately once per actual second");
    });
    await test("Liquidity collection reads cached cells at five-second cadence, independently of snapshot heartbeat timestamps", async () => {
      const before = sent.filter(message => message.type === "AXIOM_LIQUIDITY_UPDATE");
      assert(before.length >= 1 && before[0].row.value === 20000, "Collection starts on the first market bind");
      let scans = 0;
      const original = document.querySelectorAll;
      document.querySelectorAll = function (selector) { if (selector === "span") scans++; return original.call(this, selector); };
      await pause(5200);
      document.querySelectorAll = original;
      const readings = sent.filter(message => message.type === "AXIOM_LIQUIDITY_UPDATE");
      assert(readings.length > before.length && scans === 0, "Periodic fresh liquidity reads use cached DOM bindings");
      for (let index = 1; index < readings.length; index++) {
        assert(readings[index].row.sampledAt - readings[index - 1].row.sampledAt >= 5000, "No one-second or duplicate snapshot observations");
        assert(readings[index].row.value === 20000, "Valid unchanged liquidity remains recorded");
      }
    });
    await test("Page lifecycle disconnects observers and resumes after back/forward restore", async () => {
      window.dispatchEvent(new Event("pagehide"));
      const before = statsMessages().length;
      fixture.firstElementChild.querySelector("img").alt = "Bundler";
      await pause(230);
      assert(statsMessages().length === before, "No updates after pagehide");
      window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted: true}));
      await pause(620);
      assert(statsMessages().at(-1).snapshot.holdersIntelligence.renderedBundlers === 1, "Observers resume on restore");
    });
    await test("Dashboard renders real snapshot, preserves market metrics and handles unsafe text/links", async () => {
      const html = await (await fetch("../dashboard.html")).text();
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "width:1100px;height:700px";
      iframe.srcdoc = html.replace(/<script[^>]*><\/script>/g, "").replace('href="dashboard.css"', 'href="../dashboard.css"');
      const loaded = new Promise(resolve => { iframe.onload = resolve; });
      document.body.appendChild(iframe);
      await loaded;
      const doc = iframe.contentDocument;
      iframe.contentWindow.addEventListener("error", event => scriptErrors.push(event.message));
      iframe.contentWindow.addEventListener("unhandledrejection", event => scriptErrors.push(String(event.reason)));
      const listeners = [];
      const runtimeListeners = [];
      const snapshot = structuredClone(statsMessages().at(-1).snapshot);
      snapshot.url = "https://axiom.trade/meme/token-a";
      snapshot.tokenKey = snapshot.url;
      snapshot.holdersIntelligence.tokenKey = snapshot.url;
      iframe.contentWindow.chrome = {storage: {
        session: {get: async () => ({latestSnapshot: snapshot})},
        onChanged: {addListener: listener => listeners.push(listener)}
      }, runtime: {id: "fixture", onMessage: {addListener: listener => runtimeListeners.push(listener)}, sendMessage(message, callback) { callback?.({ok: true, histories: []}); }}};
      const dispatchStorage = changes => listeners.forEach(listener => listener(changes, "session"));
      dashboardFixture = {doc, win: iframe.contentWindow, dispatchStorage, runtimeListeners};
      await loadScript(doc, new URL("../rollingChartCollector.js", location.href).href);
      await loadScript(doc, new URL("../holderTableExtractor.js", location.href).href);
      await loadScript(doc, new URL("../holderConcentration.js", location.href).href);
      await loadScript(doc, new URL("../vendor/lightweight-charts.standalone.production.js", location.href).href);
      await loadScript(doc, new URL("../chartView.js", location.href).href);
      await loadScript(doc, new URL("../liquidityHistory.js", location.href).href);
      await loadScript(doc, new URL("../liquidityDashboard.js", location.href).href);
      await loadScript(doc, new URL("../chartDataCollector.js", location.href).href);
      await loadScript(doc, new URL("../historicalChart.js", location.href).href);
      await loadScript(doc, new URL("../chartDashboard.js", location.href).href);
      await loadScript(doc, new URL("../dashboard.js", location.href).href);
      await pause(20);
      assert(doc.getElementById("globalFees").textContent === "12 SOL" && doc.getElementById("bundlers").textContent === "12.5%", "Market metrics still rendered");
      assert(doc.getElementById("top10Holders").textContent === "14.05%", "Top 10 Holders card displays Axiom's percentage");
      assert(doc.getElementById("holderTotal").textContent === "1,234" && doc.getElementById("holderRendered").textContent === "1", "Summary cards");
      assert(doc.getElementById("holderCoverage").textContent === "Partial", "Partial coverage explicit");
      assert(doc.getElementById("holderRows").querySelectorAll("td").length === 11, "All holder columns rendered");
      assert(doc.getElementById("holderRows").textContent.includes("3 buys"), "Trade counts rendered");
      assert(doc.querySelector('.holder-table a').href === "https://solscan.io/tx/funding-signature", "Safe funding link");
      const renderedRow = doc.getElementById("holderRows").firstElementChild;
      dispatchStorage({latestSnapshot: {newValue: {...snapshot, capturedAt: Date.now()}}});
      assert(doc.getElementById("holderRows").firstElementChild === renderedRow, "Unchanged heartbeat does not rebuild the table");
      const holder = snapshot.holdersIntelligence.rows[0];
      holder.walletDisplay = '<img src=x onerror="window.injected=true">';
      holder.walletAddress = null; holder.identityStatus = "unresolved";
      holder.axiomBundler = true; holder.fundingTransactionUrl = "javascript:alert(1)";
      holder.solBalance = null; holder.buyCount = null;
      snapshot.holdersIntelligence.renderedBundlers = 1;
      snapshot.holdersIntelligence.unresolvedRendered = 1;
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      assert(!doc.getElementById("holderRows").querySelector("img, a"), "Untrusted text inert; unsafe link omitted");
      assert(doc.querySelector(".bundler-badge")?.textContent === "Axiom flagged", "Axiom badge displayed");
      assert(doc.getElementById("holderRows").textContent.includes("Identity unresolved") && doc.getElementById("holderRows").textContent.includes("Buys: unavailable"), "Unavailable fields explicit");
      snapshot.url = "https://axiom.trade/meme/token-b";
      snapshot.tokenKey = snapshot.url;
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      assert(!doc.querySelector(".bundler-badge") && doc.querySelector(".empty-holders"), "Mismatched token data cleared");
      dispatchStorage({latestSnapshot: {newValue: {...snapshot, stats: {...snapshot.stats, top10Holders: null}}}});
      assert(doc.getElementById("top10Holders").textContent === "—", "Unavailable top-holder data clears the dashboard value");
      window.dispatchEvent(new Event("pagehide"));
    });
    await test("Concentration dashboard separates Axiom-reported values, partial sums, exclusions, sort and session coverage", () => {
      const {doc, win, dispatchStorage} = dashboardFixture;
      const context = {sourceKey: "concentration-ui", blockchain: "solana", mintAddress: addressB, poolAddress: addressA};
      const table = makeTable(rowHtml(addressA));
      const extracted = AxiomHolderTableExtractor.extract(table, {context});
      const snapshot = {url: "https://axiom.trade/meme/concentration-ui", tokenKey: "concentration-ui", capturedAt: Date.now(), marketObservedAt: Date.now(), stats: {top10Holders: "14.05%"},
        holdersIntelligence: {...extracted, rawRows: extracted.rows, tokenKey: "concentration-ui", tableStatus: "available", observedHolders: 1000, cacheLimit: 1000, cacheTruncated: true,
          renderedHolders: 1, renderedBundlers: 1, unresolvedRendered: 0, coverage: "partial-virtualized"}};
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      assert(doc.getElementById("top10Holders").textContent === "14.05%", "Axiom-reported Top 10 is a separate metric");
      assert(doc.getElementById("concentrationResults").textContent.includes("Largest 1 observed wallets") && doc.getElementById("concentrationResults").textContent.includes("1.2%"), "Unknown sorting yields only a partial observed subset");
      assert(doc.getElementById("concentrationContext").textContent.includes("Sort order unknown") && doc.getElementById("concentrationCoverage").textContent.includes("truncated"), "Sorting, extraction context and cache limits remain near results");
      const exclusion = doc.getElementById("excludeHolderPools"); exclusion.checked = true; exclusion.dispatchEvent(new win.Event("change"));
      assert(doc.getElementById("concentrationExcluded").textContent.includes(addressA) && doc.getElementById("concentrationDenominator").textContent.includes("unchanged by exclusions"), "Pool exclusion lists its address/reason without changing denominator");
      assert(doc.getElementById("concentrationResults").textContent.includes("only 0 available"), "Exclusions account for the required wallet count");
      exclusion.checked = false; exclusion.dispatchEvent(new win.Event("change"));
      snapshot.holdersIntelligence.extractedAt -= 20000;
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      assert(!doc.getElementById("concentrationResults").textContent.includes("≈") && doc.getElementById("concentrationResults").textContent.includes("older than 10 seconds"), "Recently republished stale data cannot become a current sum");
      assert(doc.getElementById("top10Holders").textContent === "14.05%", "Calculated unavailability does not replace the reported percentage");
      const changedContext = {...context, sourceKey: "different-token-same-route", mintAddress: addressA};
      dispatchStorage({latestSnapshot: {newValue: {...snapshot, chartContext: changedContext}}});
      assert(doc.querySelector(".empty-holders") && doc.getElementById("concentrationResults").textContent.includes("Unavailable"), "A new token context on the same route cannot reuse old holder rows");
    });
    await test("Liquidity dashboard renders short saved history without a live connection, isolates currencies and breaks missed periods", () => {
      const {doc, win, runtimeListeners} = dashboardFixture;
      const H = win.AxiomLiquidityHistory, at = Math.floor(Date.now() / 1000) * 1000 - 30000;
      const recorder = H.createRecorder({sessionId: "ui"});
      recorder.setContext({sourceKey: "liquidity-ui", blockchain: "solana", mintAddress: "mint", poolAddress: "pool"});
      const ctx = recorder.context();
      const make = (ms, text) => recorder.sample(() => ({displayText: text, domReadAt: at + ms}), at + ms);
      const rows = [make(0, "$5.56K"), make(5000, "$5.56K"), make(20000, "$6K"), make(25000, "2 SOL")];
      const send = win.chrome.runtime.sendMessage;
      win.chrome.runtime.sendMessage = (message, callback) => message.type === "AXIOM_LIQUIDITY_GET" ? callback({ok: true, saved: rows, live: []}) : send(message, callback);
      win.AxiomLiquidityUI.setContext(ctx);
      assert(doc.getElementById("liquidityCurrent").textContent.includes("SOL"), "Latest observed currency is explicit");
      const selector = doc.getElementById("liquidityCurrency"); selector.value = "USD"; selector.dispatchEvent(new win.Event("change"));
      assert(doc.getElementById("liquidityCurrent").textContent === "6,000 USD", "Readable currency values");
      assert(doc.getElementById("liquidityFirst").textContent === "5,560 USD" && doc.getElementById("liquidityCurrent").title.includes("6000 USD"), "First and exact hover value remain available");
      assert(doc.getElementById("liquidityChange300").textContent === "Collecting history" && doc.getElementById("liquidityChange900").textContent === "Collecting history", "Short recordings cannot claim full long-window changes");
      const view = win.AxiomLiquidityUI.inspect();
      assert(!view.connected && view.series.length === 2 && view.plotted.length === 3, "Saved samples never connect and the actual missed period breaks lines");
      const live = {...rows[2], deliveredAt: Date.now()};
      runtimeListeners.forEach(listener => listener({type: "AXIOM_LIQUIDITY_LIVE", row: live}, {id: "fixture"}));
      assert(win.AxiomLiquidityUI.inspect().connected, "Actual worker delivery establishes recent source status");
      doc.getElementById("liquidityRange").value = "30"; doc.getElementById("liquidityRange").dispatchEvent(new win.Event("change"));
      assert(win.AxiomLiquidityUI.inspect().plotted.length === 3, "30-second view fits actual short history");
      win.AxiomLiquidityUI.setContext({...ctx, tokenKey: "different-pool"});
      win.chrome.runtime.sendMessage = send;
      win.AxiomLiquidityUI.setContext(null);
      assert(doc.getElementById("liquidityCurrent").textContent === "Unavailable", "Identity switch clears old liquidity");
    });
    await test("Dashboard displays native currencies and Fees Paid, then clears them on token switches", async () => {
      const {doc, dispatchStorage} = dashboardFixture;
      const table = await capturedTable("bnb");
      const extracted = AxiomHolderTableExtractor.extract(table);
      const snapshot = {url: "https://axiom.trade/meme/bnb-token", tokenKey: "bnb-token", capturedAt: Date.now(), stats: {},
        holdersIntelligence: {...extracted, tokenKey: "bnb-token", tableStatus: "available", totalReported: 1810,
          renderedHolders: 2, renderedBundlers: 0, observedHolders: 0, unresolvedRendered: 2}};
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      const cells = doc.getElementById("holderRows").firstElementChild.children;
      assert(doc.getElementById("holderBalanceHeader").textContent === "BNB balance", "BNB is not mislabeled SOL");
      assert(!doc.getElementById("holderFeesHeader").hidden && cells.length === 12, "Fees Paid column is present only for fee layouts");
      assert(cells[2].textContent === "0.134 BNB" && cells[7].textContent === "0.0003 BNB", "Balance and fees keep their own values/currency");
      assert(cells[8].textContent.includes("$61.03") && cells[9].textContent.includes("0xd878...8579"), "Remaining and funding do not shift");
      const eth = AxiomHolderTableExtractor.extract(await capturedTable("eth"));
      snapshot.holdersIntelligence = {...snapshot.holdersIntelligence, ...eth};
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      const ethCells = doc.getElementById("holderRows").children[1].children;
      assert(doc.getElementById("holderBalanceHeader").textContent === "ETH balance" &&
        ethCells[2].textContent === "0.002 ETH" && ethCells[7].textContent === "0.00001 ETH", "ETH balances and subscript fees display accurately");
      const sol = AxiomHolderTableExtractor.extract(await capturedTable("sol"));
      snapshot.holdersIntelligence = {...snapshot.holdersIntelligence, ...sol};
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      assert(doc.getElementById("holderBalanceHeader").textContent === "SOL balance" && doc.getElementById("holderFeesHeader").hidden, "SOL layout restores its own currency and hides fees");
      assert(doc.getElementById("holderRows").firstElementChild.children.length === 11, "Legacy column count preserved");
      snapshot.tokenKey = "new-token";
      dispatchStorage({latestSnapshot: {newValue: snapshot}});
      assert(doc.getElementById("holderBalanceHeader").textContent === "Native balance" && doc.querySelector(".empty-holders").colSpan === 11, "Old token metadata and rows cleared together");
    });
    await test("Token detector distinguishes mint/pool, query changes, conflicting hints and holder links", () => {
      const pool = "AnrCHvfJUzMtos8DGjpT2XKurVPPYAVLDturASNwXcd4";
      const mint = "CQCDTp8rsFV3PhaPeYjcCW5LdGTxi6jFx7eC3UXnpump";
      const doc = new DOMParser().parseFromString(`<div data-chain="sol" data-token-mint="${mint}" data-pool-address="${pool}"></div>
        <div data-perf-id="token-table-holders"><a href="https://solscan.io/token/${addressB}">holder</a></div>`, "text/html");
      const context = AxiomTokenContextDetector.detect(doc, {href: `https://axiom.trade/meme/${pool}?chain=sol&session=SECRET`});
      assert(context.blockchain === "solana" && context.mintAddress === mint && context.poolAddress === pool, "Separate public identities");
      assert(!context.conflict && !context.sourceKey.includes("SECRET"), "Holder links and unrelated credentials excluded");
      const other = AxiomTokenContextDetector.detect(new DOMParser().parseFromString("", "text/html"), {href: `https://axiom.trade/meme/${pool}?chain=bsc`});
      assert(context.routeKey !== other.routeKey && other.blockchain === "bsc", "Chain query is part of token identity");
      const unknown = AxiomTokenContextDetector.detect(new DOMParser().parseFromString("", "text/html"), {href: `https://axiom.trade/meme/${mint}`});
      assert(unknown.mintAddress === null && unknown.poolAddress === null && unknown.routeAddress === mint && unknown.blockchain === null, "Untyped route never called a mint or pool without verification");
    });
    await test("Rolling chart shows one-second samples, explicit gaps, separate metrics and DOM-only exports", async () => {
      const {doc, win, runtimeListeners} = dashboardFixture;
      const context = {sourceKey: "chart-token-a", blockchain: "solana", routeKey: "https://axiom.trade/meme/chart-token-a"};
      const snapshot = {url: context.routeKey, stats: {}, chartContext: context};
      win.AxiomChartUI.setSnapshot(snapshot);
      const at = Math.floor(Date.now() / 1000) * 1000;
      const model = AxiomRollingChart.createStore({now: () => at}); model.setToken(context);
      model.observe("price", {value: 1, unit: "USD"}, at - 6000);
      model.tick(at - 6000);
      // Deliver the first point, followed by a late timer's null gap slots.
      const first = {tokenKey: context.sourceKey, context, series: model.get(context.sourceKey, at).series, sentAt: at - 6000};
      runtimeListeners.forEach(listener => listener({type: "AXIOM_DOM_CHART_LIVE", packet: first}, {id: "fixture"}));
      model.observe("price", {value: 2, unit: "USD"}, at);
      const packet = model.tick(at);
      runtimeListeners.forEach(listener => listener({type: "AXIOM_DOM_CHART_LIVE", packet}, {id: "fixture"}));
      await pause(40);
      assert(doc.getElementById("chartCount").textContent === "2" && doc.getElementById("chartCountNote").textContent.includes("5 unobserved"), "Only actual attempts counted, gaps distinguished");
      assert(doc.getElementById("rollingChart").dataset.segments === "2" && doc.querySelector("#rollingChart canvas"), "Local Lightweight Charts renderer breaks gaps");
      const plotted = win.AxiomChartUI.inspectChart();
      assert(plotted.series.length === 2 && plotted.series.every(series => series.length === 1), "Separate native line series never interpolate across the gap");
      assert(doc.getElementById("chartCurrent").textContent === "2 USD" && doc.getElementById("chartChange").textContent === "+100.00%", "Observed value and change use actual samples");
      assert(plotted.visibleRange.to - plotted.visibleRange.from < 60, `Sparse initial observations fit available time: ${JSON.stringify(plotted.visibleRange)}`);
      assert(doc.getElementById("chartSource").textContent === "DOM readable", "Readability separated from value changes");
      assert(doc.getElementById("chartDelay").textContent.includes("5,000"), "Timer delay displayed");
      const downloads = [];
      win.URL.createObjectURL = blob => { downloads.push(blob); return "blob:local-test"; };
      win.HTMLAnchorElement.prototype.click = function () {};
      doc.getElementById("chartExportJSONL").click();
      const jsonl = await downloads.at(-1).text();
      const rows = jsonl.trim().split("\n").map(JSON.parse);
      assert(rows.length === 7 && rows[1].value === null && rows[1].gap && rows[0].source === "axiom-dom-sample", "JSONL retains gaps and honest provenance");
      assert(!("volume" in rows[0]) && !("high" in rows[0]), "No fabricated OHLCV fields");
      doc.getElementById("chartExportCSV").click();
      assert((await downloads.at(-1).text()).startsWith("timestamp,tokenKey,blockchain,"), "CSV sampling metadata");
      doc.getElementById("chartMetric").value = "marketCap";
      doc.getElementById("chartMetric").dispatchEvent(new win.Event("change"));
      assert(doc.getElementById("chartCount").textContent === "0" && doc.getElementById("chartExportJSONL").disabled, "Price is not converted into market cap");
      doc.getElementById("chartMetric").value = "price";
      win.AxiomChartUI.setSnapshot({...snapshot, chartContext: {...context, sourceKey: "chart-token-b"}});
      assert(doc.getElementById("chartCount").textContent === "0" && doc.getElementById("chartExportCSV").disabled, "Token isolation");
      win.AxiomChartUI.setSnapshot(snapshot);
      assert(doc.getElementById("chartCount").textContent === "2", "Returning to token restores its own retained history");
    });
    await test("Archived windows hydrate on revisiting, preserve precision and units, and never claim unobserved history", async () => {
      const {doc, win, runtimeListeners} = dashboardFixture;
      const now = Math.floor(Date.now() / 1000), end = now - 3600;
      const context = {sourceKey: "archive-token", blockchain: "solana", routeKey: "https://axiom.trade/meme/archive-token"};
      const archived = (type, timestamp, value) => ({timestamp, value, valueType: type, unit: "USD", tokenKey: context.sourceKey,
        source: "axiom-dom-sample", sampledAt: timestamp * 1000 + 15, domReadAt: timestamp * 1000,
        valueChangedAt: timestamp * 1000, deliveredAt: timestamp * 1000 + 25, stale: false, gap: false});
      const price = [archived("price", end - 1, 0.00000000000045), archived("price", end, 0.00000000000046)];
      const cap = [archived("marketCap", end, 1230000)];
      const requests = [];
      win.chrome.runtime.sendMessage = (message, callback) => {
        requests.push(message);
        const chosen = message.endTimestamp ?? end;
        callback?.({ok: true, histories: [], settings: {retentionHours: 24, maxRecords: 25000}, stats: {count: 3},
          recorded: {unit: "USD", end: chosen, samples: (message.metric === "marketCap" ? cap : price)
            .filter(row => row.timestamp > chosen - 900 && row.timestamp <= chosen)}});
      };
      win.AxiomChartUI.setSnapshot({url: context.routeKey, stats: {}, chartContext: context});
      await pause(40);
      assert(doc.getElementById("chartView").value === "recorded" && doc.getElementById("chartCount").textContent === "2", "Revisited token loads its last recorded period");
      assert(doc.getElementById("chartSource").textContent === "Saved observations", "Saved data never implies a live connection");
      assert(win.AxiomChartUI.inspectChart().series[0][0].value === 0.00000000000045, "Native chart retains precise tiny price");
      const range = win.AxiomChartUI.inspectChart().visibleRange;
      assert(range.to - range.from <= 10, "Sparse archived samples fit their recorded period");
      assert(win.AxiomChartUI.inspectChart().formattedPrice === "0.00000000000045", "Visible price series keeps tiny-price formatting");
      assert(win.AxiomChartUI.inspectChart().timelineScale === "timeline", "Whitespace cannot set the right-axis formatter");
      doc.getElementById("chartRange").value = "60";
      doc.getElementById("chartRange").dispatchEvent(new win.Event("change"));
      await pause(40);
      const minute = win.AxiomChartUI.inspectChart().visibleRange;
      assert(minute.to - minute.from === 59, "One-minute control shows 60 second slots");
      doc.getElementById("chartRange").value = "900";
      doc.getElementById("chartRange").dispatchEvent(new win.Event("change"));
      await pause(40);
      assert(win.AxiomChartUI.inspectChart().visibleRange.to - win.AxiomChartUI.inspectChart().visibleRange.from === 899, "15-minute control shows full retained window");
      // Manual history selection stays in place when a live quote in another unit arrives.
      doc.getElementById("chartView").dispatchEvent(new win.Event("change"));
      const live = AxiomRollingChart.createStore(); live.setToken(context);
      live.observe("price", {value: 1, unit: "SOL"});
      const packet = live.tick();
      runtimeListeners.forEach(listener => listener({type: "AXIOM_DOM_CHART_LIVE", packet}, {id: "fixture"}));
      assert(doc.getElementById("chartUnit").textContent === "Price · USD" && doc.getElementById("chartSource").textContent === "Saved observations", "Recorded USD history is separate from current SOL observations");
      doc.getElementById("chartMetric").value = "marketCap";
      doc.getElementById("chartMetric").dispatchEvent(new win.Event("change"));
      assert(doc.getElementById("chartCount").textContent === "1" && win.AxiomChartUI.inspectChart().series[0][0].value === 1230000, "Archived market-cap data stays separate");
      doc.getElementById("chartRecordedEnd").value = new Date((end - 1800) * 1000).toISOString().slice(0, 19);
      doc.getElementById("chartRecordedEnd").dispatchEvent(new win.Event("change"));
      assert(doc.getElementById("chartCount").textContent === "0" && doc.getElementById("chartExportCSV").disabled, "Unobserved selected period stays empty");
      assert(requests.at(-1).endTimestamp === end - 1800, "Recorded picker sends UTC Unix-second boundary");
      doc.getElementById("chartFollow").click(); await pause(40);
      assert(doc.getElementById("chartView").value === "live", "Follow live exits recorded mode even when only older archive data exists");
      // Restore the empty archived period for the independent history isolation check below.
      doc.getElementById("chartView").value = "recorded";
      doc.getElementById("chartView").dispatchEvent(new win.Event("change"));
    });
    await test("Chart navigation stays paused through sample updates and periodic series rebuilding", async () => {
      const {doc, win} = dashboardFixture;
      const container = doc.createElement("div"); container.style.cssText = "width:800px;height:350px"; doc.body.append(container);
      const renderer = win.AxiomChartView.createRenderer(container, () => {});
      const end = Math.floor(Date.now() / 1000);
      const samples = Array.from({length: 100}, (_, index) => ({timestamp: end - 99 + index, value: 1e-14 + index * 1e-16}));
      renderer.render(samples, end, "navigation"); renderer.setWindow(60);
      await pause(40);
      container.dispatchEvent(new win.WheelEvent("wheel", {deltaY: 120, bubbles: true}));
      assert(!renderer.inspect().following, "User zoom pauses tracking");
      const range = renderer.inspect().visibleRange;
      renderer.render([...samples, {timestamp: end + 61, value: 1e-14}], end + 61, "navigation");
      await pause(40);
      const paused = renderer.inspect().visibleRange;
      assert(paused.from === range.from && paused.to === range.to, "Absolute view survives timeline rebuild while collection continues");
      renderer.follow();
      await pause(40);
      assert(renderer.inspect().following && renderer.inspect().visibleRange.to === end + 61, "Follow resumes newest period");
      renderer.remove(); container.remove();
    });
    await test("Historical candles require permission and verified identities, stay separate, and discard switched-token responses", async () => {
      const {doc, win} = dashboardFixture;
      const pool = "AnrCHvfJUzMtos8DGjpT2XKurVPPYAVLDturASNwXcd4", mint = "CQCDTp8rsFV3PhaPeYjcCW5LdGTxi6jFx7eC3UXnpump";
      const quote = "So11111111111111111111111111111111111111112";
      let permission = false, calls = 0, release;
      win.chrome.permissions = {request: async () => permission};
      win.chrome.storage.local = {get: async () => ({}), set: async () => {}};
      win.fetch = async url => {
        calls++;
        const body = url.includes("/ohlcv/") ? {data: {attributes: {ohlcv_list: [
          [Math.floor(Date.now() / 60000) * 60 - 60, 1e-14, 2e-14, 1e-14, 2e-14, 10]]}},
          meta: {base: {address: url.includes("token=quote") ? quote : mint}, quote: {address: quote}}} : {data: {
          attributes: {address: pool}, relationships: {base_token: {data: {id: "solana_" + mint}}, quote_token: {data: {id: "solana_" + quote}}}}};
        return new win.Response(JSON.stringify(body), {status: 200});
      };
      // Retain real identity/normalization logic, skip rate-limit sleeping in this local fixture.
      const original = win.AxiomChartData;
      win.AxiomChartData = {...original, createCollector: options => original.createCollector({...options, sleep: async () => {}})};
      const fill = () => {
        doc.getElementById("historyNetwork").value = "solana";
        doc.getElementById("historyMint").value = mint;
        doc.getElementById("historyPool").value = pool;
      };
      const submit = () => doc.getElementById("historyForm").dispatchEvent(new win.Event("submit", {cancelable: true}));
      const settle = async () => { for (let i = 0; i < 20 && doc.getElementById("historyLoad").disabled; i++) await pause(10); };
      fill(); submit(); await settle();
      assert(calls === 0 && doc.getElementById("historyStatus").textContent.includes("declined"), "Declining optional access makes no requests");
      permission = true; submit(); await settle();
      const history = win.AxiomHistoricalUI.inspect();
      assert(history.candles.length === 1 && history.metadata.poolAddress === pool && history.metadata.quoteCurrency === "USD", "Verified candle mapped to selected pool and USD");
      assert(doc.querySelector("#historicalChart canvas") && doc.getElementById("historyStatus").textContent.includes("GeckoTerminal"), "Separate labeled candlestick chart renders");
      assert(win.AxiomChartUI.inspectChart().series.length === 0, "Market history does not fill missing DOM observations");
      const downloads = []; win.URL.createObjectURL = blob => { downloads.push(blob); return "blob:local-test"; };
      doc.getElementById("historyExport").click();
      const csv = await downloads[0].text();
      assert(csv.includes("open,high,low,close,volume,finalized") && csv.includes("GeckoTerminal Public API"), "Market export includes OHLCV provenance and interval state");
      doc.getElementById("historyMint").value = quote;
      doc.getElementById("historyMint").dispatchEvent(new win.Event("input"));
      assert(doc.getElementById("historyResults").hidden, "Editing identity clears previous candles");
      submit(); await settle();
      assert(doc.getElementById("historyStatus").textContent.includes("does not match"), "OHLCV metadata mismatch fails closed");
      // Changing the Axiom token while waiting for API permission must invalidate the request.
      win.chrome.permissions.request = () => new Promise(resolve => { release = resolve; });
      fill(); submit();
      const before = calls;
      win.AxiomHistoricalUI.setContext({sourceKey: "different-token", blockchain: "solana"});
      release(true); await pause(20);
      assert(calls === before && doc.getElementById("historyResults").hidden, "Late response cannot populate another token");
      win.AxiomChartData = original;
    });
    assert(!scriptErrors.length, scriptErrors.join("; "));
    document.getElementById("results").textContent = JSON.stringify({passed: results.length, tests: results});
    document.body.dataset.testStatus = "passed";
  } catch (error) {
    monitor?.disconnect();
    document.getElementById("results").textContent = JSON.stringify({passed: results.length, tests: results, error: error.stack});
    document.body.dataset.testStatus = "failed";
  }
})();
