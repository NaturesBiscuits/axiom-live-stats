/* Real browser DOM fixtures based on the supplied nine-column, 48px row layout. */
(async () => {
  "use strict";
  const results = [];
  const scriptErrors = [];
  window.addEventListener("error", event => scriptErrors.push(event.message));
  window.addEventListener("unhandledrejection", event => scriptErrors.push(String(event.reason)));
  const fixture = document.getElementById("fixture");
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = async (name, fn) => {
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
        '<button role="tab"><span>Holders (1,234)</span></button><div><div><span>12.5%</span></div><div><span>Bundlers</span></div></div>';
      window.chrome = {runtime: {sendMessage(message, callback) { sent.push(message); callback?.(); }}};
      await loadScript(document, "../content.js");
      await pause(620);
      const snapshot = statsMessages().at(-1)?.snapshot;
      assert(statsMessages().at(-1)?.type === "AXIOM_STATS_UPDATE", "Existing message reused");
      assert(snapshot.stats.globalFees === "12 SOL" && snapshot.stats.price === "$0.001" && snapshot.stats.volume5m === "$4K", "Core market stats unchanged");
      for (const [key, expected] of Object.entries({liquidity: "$20K", supply: "1B", ath: "$0.002", buys: "10 / $3K", sells: "5 / $1K", netVolume: "+$2K", holders: "1,234", bundlers: "12.5%"})) {
        assert(snapshot.stats[key] === expected, `${key} preserved`);
      }
      assert(snapshot.holdersIntelligence.totalReported === 1234 && snapshot.holdersIntelligence.renderedBundlers === 1, "Holder snapshot attached");
      assert(snapshot.holdersIntelligence.tokenKey === snapshot.tokenKey, "Token association");
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
      const recent = sent.filter(message => message.type === "AXIOM_DOM_CHART_UPDATE").slice(-2)
        .map(message => message.packet.series.price.samples.at(-1));
      assert(recent.length === 2 && recent[1].timestamp - recent[0].timestamp === 1 &&
        Math.abs(recent[1].sampledAt - recent[0].sampledAt - 1000) < 200, "Visible source samples approximately once per actual second");
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
      await loadScript(doc, new URL("../vendor/lightweight-charts.standalone.production.js", location.href).href);
      await loadScript(doc, new URL("../chartView.js", location.href).href);
      await loadScript(doc, new URL("../chartDashboard.js", location.href).href);
      await loadScript(doc, new URL("../dashboard.js", location.href).href);
      await pause(20);
      assert(doc.getElementById("globalFees").textContent === "12 SOL" && doc.getElementById("bundlers").textContent === "12.5%", "Market metrics still rendered");
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
      window.dispatchEvent(new Event("pagehide"));
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
      assert(doc.getElementById("chartCount").textContent === "2" && doc.getElementById("chartCountNote").textContent.includes("5 unobserved"), "Only actual attempts counted, gaps distinguished");
      assert(doc.getElementById("rollingChart").dataset.segments === "2" && doc.querySelector("#rollingChart canvas"), "Local Lightweight Charts renderer breaks gaps");
      const plotted = win.AxiomChartUI.inspectChart();
      assert(plotted.series.length === 2 && plotted.series.every(series => series.length === 1), "Separate native line series never interpolate across the gap");
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
      assert(doc.getElementById("chartView").value === "recorded" && doc.getElementById("chartCount").textContent === "2", "Revisited token loads its last recorded period");
      assert(doc.getElementById("chartSource").textContent === "Saved observations", "Saved data never implies a live connection");
      assert(win.AxiomChartUI.inspectChart().series[0][0].value === 0.00000000000045, "Native chart retains precise tiny price");
      const range = win.AxiomChartUI.inspectChart().visibleRange;
      assert(range.to - range.from === 899, "Time axis spans 900 one-second slots");
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
