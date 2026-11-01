(async () => {
  "use strict";
  const results = [], errors = [], feed = document.getElementById("feed"), T = AxiomTrading;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const test = async (name, fn) => { document.getElementById("results").textContent = JSON.stringify({passed: results.length, running: name}); await fn(); results.push(name); };
  const script = (doc, path) => new Promise((resolve, reject) => { const node = doc.createElement("script"); node.src = new URL(path, location.href).href; node.onload = resolve; node.onerror = reject; doc.head.append(node); });
  const outer = panel => [...panel.querySelectorAll("div[data-transaction-key]")].filter(row => !row.parentElement.closest("div[data-transaction-key]"));
  const fields = (row, key) => [...row.querySelectorAll("span")].find(node => node.style.minWidth.includes(`--trades-tape-figure-floor-${key}`));
  const address = n => "0x" + n.toString(16).padStart(40, "0");
  const base = {sourceKey: "trade-context-a", routeKey: "route", blockchain: "eth", mintAddress: address(100), poolAddress: address(200)};
  let capture, panel, monitor;
  const reset = () => { feed.innerHTML = capture; panel = feed.querySelector(AxiomTradeFeed.PANEL_SELECTOR); return panel; };
  window.addEventListener("error", event => errors.push(event.message));
  window.addEventListener("unhandledrejection", event => errors.push(String(event.reason)));
  try {
    capture = await (await fetch("fixtures/trades.html")).text();
    await test("Sanitized capture has 19 outer rows, nested duplicates and 17 distinct raw maker addresses", () => {
      reset(); const rows = outer(panel);
      assert(rows.length === 19 && new Set(rows.map(row => row.dataset.makerAddress)).size === 17, "Raw capture cardinalities");
      assert(panel.querySelectorAll("[data-transaction-key]").length === 38, "Nested trader buttons repeat attributes");
      assert(!panel.querySelector("[src], [srcset], [poster]") && !capture.includes("url("), "Fixture has no remote assets");
    });
    await test("Extract Total via semantic width/header markers rather than MC, Amount, CSS visual order or badge colors", () => {
      const reading = AxiomTradeFeed.extract(panel);
      assert(reading.rows.length === 19, "Outer rows extracted once");
      assert(reading.rows.filter(row => row.direction === "buy").length === 14 && reading.rows.filter(row => row.direction === "sell").length === 5, "Scoped direction markers");
      const first = reading.rows[0];
      assert(first.total.value === 94.69 && first.total.unit === "USD" && first.total.displayText === "$94.69", "Total differs from MC $27.5K");
      assert(first.tokenAmount.value === 3240000 && first.tokenAmount.unit === "token", "Token amount differs from Total");
      assert(first.eventKey.endsWith("-5-14-0") && first.rawAge === "6s" && first.transactionUrl.startsWith("https://solscan.io/tx/"), "Opaque full key, age and public transaction");
      assert(new Set(reading.rows.map(row => row.makerAddress)).size === 17, "Full maker identities validated");
      const context = T.sourceContext(base, "fixture", 1), now = Date.now();
      const summary = T.analyze(reading.rows.map(row => T.makeEvent(row, context, now, "initial-sync")), {now});
      assert(Math.abs(summary.totalVolume - 552.94) < 1e-8 && summary.events === 19, "Captured observed volume and counts");
      assert(summary.initialSyncEvents === 19 && !summary.recordingCoversWindow && summary.partialCoverage, "Initial sync never claims complete history");
    });
    await test("Only Total-field direction markers establish buys/sells; missing/conflicting/hidden fields stay unknown", () => {
      reset(); const first = outer(panel)[0], total = fields(first, "total"), mc = fields(first, "price");
      total.classList.remove("text-increase"); mc.classList.add("text-decrease");
      assert(AxiomTradeFeed.extract(panel).rows[0].direction === "unknown", "MC and gradient/badge colors are irrelevant");
      total.classList.add("text-increase", "text-decrease");
      assert(AxiomTradeFeed.extract(panel).rows[0].direction === "unknown", "Conflicting semantic classes are unknown");
      total.classList.remove("text-decrease"); total.hidden = true;
      let row = AxiomTradeFeed.extract(panel).rows[0]; assert(row.direction === "unknown" && row.total.value === null, "Hidden total cannot supply direction or volume");
      total.hidden = false; total.remove(); row = AxiomTradeFeed.extract(panel).rows[0];
      assert(row.total.value === null && row.tokenAmount.value === 3240000, "Missing Total does not discard token amount or identity");
    });
    await test("Suffixes, formatted totals, native currencies, zero and HTML/CSS/Unicode subscripts use compatible helpers", () => {
      for (const [html, expected, unit] of [["$0", 0, "USD"], ["$1,234.5", 1234.5, "USD"], ["$1.001K", 1001, "USD"],
        ["0.1 SOL", 0.1, "SOL"], ["$0.0<sub>5</sub>123", 0.00000123, "USD"], ["$0.0<span class='align-sub'>5</span>123", 0.00000123, "USD"], ["$0.0₅123", 0.00000123, "USD"]]) {
        reset(); fields(outer(panel)[0], "total").innerHTML = html;
        const total = AxiomTradeFeed.extract(panel).rows[0].total;
        assert(total.value === expected && total.unit === unit && total.displayText, `Value ${html}: ${JSON.stringify(total)}`);
      }
      for (const text of ["$bad", "-1 SOL", "$1 2", "$1.2.3", "", "$Infinity"]) {
        reset(); fields(outer(panel)[0], "total").textContent = text;
        assert(AxiomTradeFeed.extract(panel).rows[0].total.value === null, `Invalid ${text}`);
      }
    });
    await test("Full maker addresses survive same names; missing identity, conflicting identity and missing IDs stay separate", () => {
      reset(); const first = outer(panel)[0], second = outer(panel)[1];
      for (const row of [first, second]) row.querySelector('span[title*="username"]').childNodes[0].textContent = "Same label";
      let reading = AxiomTradeFeed.extract(panel);
      assert(reading.rows[0].traderDisplay === reading.rows[1].traderDisplay && reading.rows[0].makerAddress !== reading.rows[1].makerAddress, "Names never become identity");
      for (const node of [first, ...first.querySelectorAll("[data-maker-address]")]) node.removeAttribute("data-maker-address");
      reading = AxiomTradeFeed.extract(panel); assert(reading.rows.length === 19 && reading.rows[0].makerAddress === null && reading.rows[0].total.value === 94.69, "Missing maker preserves trade and volume");
      first.dataset.makerAddress = second.dataset.makerAddress; first.querySelector("button").dataset.makerAddress = address(1);
      assert(AxiomTradeFeed.extract(panel).rows[0].identityStatus === "conflicting", "Conflicting maker attributes remain unresolved");
      first.removeAttribute("data-transaction-key"); first.querySelector("button").removeAttribute("data-transaction-key");
      reading = AxiomTradeFeed.extract(panel); assert(reading.rows.length === 18 && reading.missingIdentifiers === 1, "No synthetic event identifier");
    });
    await test("Mine/Tracked/Dev captured inactive styles are supported; closed column popovers remain unknown", () => {
      reset(); let state = AxiomTradeFeed.filters(panel);
      assert(state.controls.filter(control => ["Mine", "Tracked", "Dev"].includes(control.label)).every(control => control.state === "off"), "Captured inactive toggles");
      assert(state.status === "unknown" && state.controls.filter(control => control.label.startsWith("Filter by")).every(control => control.state === "unknown"), "Closed is not unfiltered");
      const mine = [...panel.querySelectorAll("button")].find(button => button.textContent === "Mine"); mine.setAttribute("aria-pressed", "true");
      assert(AxiomTradeFeed.filters(panel).status === "restricted", "Explicit selected filter supported");
      mine.setAttribute("aria-checked", "false");
      assert(AxiomTradeFeed.filters(panel).controls.find(control => control.label === "Mine").state === "unknown", "Contradictory filter state stays unknown");
    });
    await test("Rendered-row caps and hidden/replaced headers expose unavailable fields without borrowing MC", () => {
      reset(); const prototype = outer(panel)[0], parent = prototype.parentElement;
      parent.replaceChildren(...Array.from({length: 501}, (_, index) => {
        const row = prototype.cloneNode(true); row.dataset.transactionKey = "capped-" + index; row.querySelector("button").dataset.transactionKey = row.dataset.transactionKey; return row;
      }));
      let reading = AxiomTradeFeed.extract(panel);
      assert(reading.rows.length === 500 && reading.materializedRows === 501 && reading.renderedLimitReached, "Read work is bounded and truncation explicit");
      panel.querySelector('[data-figure="total"]').hidden = true;
      reading = AxiomTradeFeed.extract(panel);
      assert(reading.rows.every(row => row.total.value === null && row.direction === "unknown") && reading.rows[0].tokenAmount.value === 3240000, "Hidden Total header cannot cause MC/Amount substitution");
    });
    await test("Scoped coalescing, age-only updates, nested repeats and distinct keys sharing a transaction do not inflate counts", async () => {
      reset(); let clock = 1700000000000, route = "route", clicks = 0, scrolls = 0; const packets = [];
      feed.addEventListener("click", () => clicks++); feed.addEventListener("scroll", () => scrolls++, true);
      monitor = AxiomTradeFeed.createMonitor(packet => packets.push(packet), {now: () => clock, routeKey: () => route, sessionId: "browser-test"});
      monitor.setContext(base); const first = packets[0].events[0];
      let scans = 0; const original = document.querySelectorAll;
      document.querySelectorAll = function(selector) { scans++; return original.call(this, selector); };
      clock += 1000;
      for (const age of panel.querySelectorAll('[data-row-accessory="age"]')) age.textContent = "8s";
      await pause(230); document.querySelectorAll = original;
      assert(packets.length === 2 && scans === 0, "Burst uses one scoped read and zero document scans");
      const reread = packets[1].events.find(row => row.eventKey === first.eventKey);
      assert(reread.firstSeenAt === first.firstSeenAt && reread.estimatedTradeAt === first.estimatedTradeAt && reread.lastReadAt === clock, "Stable event clock on age reread");
      let all = T.mergeRows(...packets.map(packet => packet.events)); assert(all.length === 19, "Age changes and nested duplicates are not new trades");
      const extra = outer(panel)[0].cloneNode(true); extra.dataset.transactionKey += "-opaque-extra"; extra.querySelector("button").dataset.transactionKey = extra.dataset.transactionKey;
      outer(panel)[0].parentElement.append(extra); clock += 1000; await pause(230);
      all = T.mergeRows(...packets.map(packet => packet.events)); assert(all.length === 20 && all.find(row => row.eventKey === extra.dataset.transactionKey).appearance === "newly-observed", "Distinct event in same transaction retained");
      const recycled = outer(panel)[1]; recycled.dataset.transactionKey = "recycled-new-event"; recycled.querySelector("button").dataset.transactionKey = "recycled-new-event";
      clock += 1000; await pause(230); assert(T.mergeRows(...packets.map(packet => packet.events)).length === 21, "Recycled DOM node carries a new event identity");
      const retained = all[0].firstSeenAt; feed.innerHTML = capture; panel = feed.querySelector(AxiomTradeFeed.PANEL_SELECTOR); monitor.setContext(base);
      assert(packets.at(-1).events[0].firstSeenAt === retained, "Panel replacement preserves known event identities");
      panel.style.display = "none"; await pause(230); assert(monitor.getState().status === "hidden", "Hidden panel reports unavailable current coverage");
      panel.style.display = ""; clock += 1000; await pause(230); assert(monitor.getState().status === "available", "Resume rereads supported rows");
      route = "other-route"; monitor.setContext({...base, sourceKey: "context-b", routeKey: route, mintAddress: address(300)});
      assert(packets.at(-1).events.length === 0 && monitor.getState().status === "awaiting-token", "Old rows not assigned to new token");
      panel.querySelector('[data-row-accessory="age"]').textContent = "9s"; clock += 1000; await pause(230);
      assert(packets.at(-1).events.length === 0, "Age changes cannot release stale previous-token event keys");
      const current = outer(panel)[0]; current.dataset.transactionKey = "current-token-event"; current.querySelector("button").dataset.transactionKey = "current-token-event";
      clock += 1000; await pause(230); assert(packets.at(-1).events.length === 1 && packets.at(-1).context.mintAddress === address(300), "New current-token event accepted");
      assert(clicks === 0 && scrolls === 0, "No source controls or scrolling invoked"); monitor.disconnect(); monitor = null;
    });
    await test("Real content flow carries trade context, sends trades independently and isolates their mutations from market scans", async () => {
      reset(); const messages = [];
      document.getElementById("market").innerHTML = '<div><span>Global Fees Paid</span><span>12 SOL</span></div><div><span>Price</span><span>$0.1</span></div><div><span>Liquidity</span><span>$20K</span></div>';
      window.chrome = {runtime: {sendMessage(message, callback) { messages.push(message); callback?.(); }}};
      await script(document, "../content.js"); await pause(620);
      const packet = messages.find(message => message.type === "AXIOM_TRADES_UPDATE").packet;
      const stats = messages.filter(message => message.type === "AXIOM_STATS_UPDATE").at(-1).snapshot;
      assert(packet.events.length === 19 && stats.tradingContext.tokenKey === packet.context.tokenKey && stats.stats.globalFees === "12 SOL", "Existing snapshot and independent trade packet");
      assert(packet.context.identityStatus === "unresolved" && !packet.context.mintAddress && !packet.context.poolAddress, "Maker addresses never become token or pool identity");
      const before = messages.length; let scans = 0; const original = document.querySelectorAll;
      document.querySelectorAll = function(selector) { if (selector === "span") scans++; return original.call(this, selector); };
      outer(panel)[0].querySelector('[data-row-accessory="age"]').textContent = "10s";
      await pause(230); document.querySelectorAll = original;
      assert(scans === 0 && messages.slice(before).some(message => message.type === "AXIOM_TRADES_UPDATE") && !messages.slice(before).some(message => message.type === "AXIOM_STATS_UPDATE"), "Trade-only mutation avoids full market scan/publication");
      assert(messages.some(message => message.type === "AXIOM_LIQUIDITY_UPDATE" && message.row.value === 20000), "Liquidity collection still runs");
      document.getElementById("market").dataset.tokenMint = address(500); await pause(560);
      assert(messages.filter(message => message.type === "AXIOM_TRADES_UPDATE").at(-1).packet.events.length === 0, "Identity change guards unchanged trade rows");
      window.dispatchEvent(new Event("pagehide"));
      const count = messages.length; outer(panel)[0].querySelector('[data-row-accessory="age"]').textContent = "11s"; await pause(230);
      assert(messages.length === count, "Page lifecycle disconnects trade observation");
    });
    await test("Dashboard separates counts, unique addresses, currency volumes, unidentified denominator and safe wallet labels", async () => {
      reset(); const read = AxiomTradeFeed.extract(panel), now = Date.now(), context = T.sourceContext(base, "ui", 1);
      const events = read.rows.map(row => T.makeEvent(row, context, now, "initial-sync"));
      events[0].traderDisplay = '<img src=x onerror="throw 1">';
      const coverage = {tokenKey: context.tokenKey, recordingStartedAt: now, lastReadAt: now, status: "available", filters: read.filters};
      const iframe = document.createElement("iframe"); iframe.style.cssText = "width:1100px;height:700px";
      const html = await (await fetch("../dashboard.html")).text();
      iframe.srcdoc = html.replace(/<script[^>]*><\/script>/g, "").replace('href="dashboard.css"', 'href="../dashboard.css"');
      const loaded = new Promise(resolve => iframe.onload = resolve); document.body.append(iframe); await loaded;
      const win = iframe.contentWindow, doc = iframe.contentDocument, listeners = []; let pending = null;
      win.chrome = {runtime: {onMessage: {addListener(fn) { listeners.push(fn); }}, sendMessage(message, callback) {
        if (message.type === "AXIOM_TRADES_GET") callback({ok: true, events, coverage, losses: [], archiveStatus: {pending: 19}});
      }}};
      await script(doc, "../holderTableExtractor.js"); await script(doc, "../tradingParticipation.js"); await script(doc, "../tradingDashboard.js");
      win.AxiomTradingUI.setSnapshot({tradingContext: context, tradingStatus: coverage});
      assert(doc.getElementById("participationEvents").textContent === "14 buys / 5 sells", "Event counts independent of identities");
      assert(doc.getElementById("participationDenominator").textContent.includes("552.94") && doc.getElementById("participationRows").children.length === 17, "Volume and full-address table");
      assert(doc.getElementById("participationRows").textContent.includes("<img") && !doc.getElementById("participationRows").querySelector("img"), "Source labels rendered as inert text");
      assert(doc.getElementById("participationCoverage").textContent.includes("does not cover this full window") && doc.getElementById("participationFilters").textContent.includes("unknown"), "Incomplete recording and unknown column filter coverage explicit");
      listeners.forEach(fn => fn({type: "AXIOM_TRADES_LIVE", tokenKey: context.tokenKey, events: [events[0]], coverage,
        losses: [{tokenKey: context.tokenKey, from: now - 1000, through: now, reason: "archive-record-cap", count: 1}]}));
      assert(win.AxiomTradingUI.inspect().summary.events === 19 && doc.getElementById("participationLoss").textContent.includes("archive-record-cap"), "Rereads deduplicate; cap loss shown");
      listeners.forEach(fn => fn({type: "AXIOM_TRADES_LIVE", tokenKey: context.tokenKey, events: [], coverage, losses: []}));
      assert(doc.getElementById("participationLoss").textContent.includes("archive-record-cap"), "A heartbeat cannot erase recorded archive truncation");
      doc.getElementById("participationTiming").value = "observation-time"; doc.getElementById("participationTiming").dispatchEvent(new win.Event("change"));
      assert(doc.getElementById("participationTimingNote").textContent.includes("Observation-time window"), "Timing basis is visible");
      win.chrome.runtime.sendMessage = (message, callback) => { pending = callback; };
      win.AxiomTradingUI.setSnapshot({tradingContext: {...context, tokenKey: "source-b"}}); const late = pending;
      win.AxiomTradingUI.setSnapshot({tradingContext: {...context, tokenKey: "source-c"}});
      late({ok: true, events, coverage, losses: []});
      assert(win.AxiomTradingUI.inspect().rows.length === 0, "Late archive data cannot populate another token");
    });
    assert(!errors.length, errors.join("; "));
    document.getElementById("results").textContent = JSON.stringify({passed: results.length, tests: results}); document.body.dataset.testStatus = "passed";
  } catch (error) {
    monitor?.disconnect(); window.dispatchEvent(new Event("pagehide"));
    document.getElementById("results").textContent = JSON.stringify({passed: results.length, tests: results, error: error.stack}); document.body.dataset.testStatus = "failed";
  }
})();
