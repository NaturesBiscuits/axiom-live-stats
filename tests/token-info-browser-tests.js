/* The complete supplied capture is retained verbatim in fixtures/token-info.html. */
globalThis.TokenInfoBrowserTests = (() => {
  "use strict";
  let capture;
  const ca = "8vhj28i4FS87DQWac3uMr54vfrX7nin1SnSFuyc6pump";
  const da = "Fe5i9MriTnRYbDJiZeUn2isJsx6zQkanzw7HisZj4uJi";
  const funder = "3vgSf47KM5PNyjZ6Jc32ifUZDuCCcqTH59i6nqzjVAbj";
  const nodes = root => [...root.querySelectorAll("span")].filter(node => !node.children.length);
  const read = root => AxiomTokenInfo.extract(nodes(root), {routeKey: "route", observedAt: Date.now()});
  const label = (root, name) => nodes(root).find(node => node.textContent.trim() === name);
  const value = (root, name) => label(root, name).parentElement.previousElementSibling.querySelector("span");
  async function extraction(test, assert, fixture) {
    capture = await (await fetch("fixtures/token-info.html")).text();
    const reset = () => { fixture.innerHTML = capture; };
    await test("Full Token Info capture reads all ten exact tiles, zeros, addresses, username and funding context without actions", () => {
      reset(); let clicks = 0; fixture.addEventListener("click", () => clicks++, {once: true});
      const info = read(fixture);
      const expected = {tax: 1.25, top10Holders: 24.61, developerHoldings: 0, sniperHoldings: 0,
        insiders: 5.01, bundlers: 29.62, lpBurned: 100, holderCount: 181, proTraders: 117, dexPaid: "unpaid"};
      for (const [key, amount] of Object.entries(expected)) assert(info.tiles[key].value === amount, `${key}: ${JSON.stringify(info.tiles[key])}`);
      assert(info.token.address === ca && info.developer.address === da, "CA and DA are separate full explorer addresses");
      assert(info.developer.username === "devngineer" && info.developer.usernameVerification === "self-chosen-unverified", "Self-chosen name is not verified");
      assert(info.funding.sourceAddress === funder && info.funding.transactionUrl.startsWith("https://solscan.io/tx/3Fj"), "Funding address and transaction scoped separately");
      assert(info.funding.amount === "0.91" && info.funding.currency === "SOL" && info.funding.relativeAgeText === "9mo", "Displayed funding amount/unit/relative age preserved");
      assert(info.funding.badgeText === "0 / 1" && info.funding.badgeMeaning === "uninterpreted", "Badge never decoded");
      assert(info.funding.transactionTimestamp === null && info.verifiedTransfers === null && info.decodedSales === null && info.walletClustering === null, "No invented chain evidence");
      assert(info.funding.sourceText.includes("9mo") && Number.isFinite(info.funding.observedAt) && clicks === 0, "Source, time and read-only behavior");
    });
    await test("Tile labels and nested tooltip wrappers never select neighboring percentages", () => {
      reset();
      const tax = label(fixture, "Tax %"); tax.innerHTML = "Tax %";
      const wrapper = document.createElement("span"); wrapper.dataset.tooltipTrigger = "";
      tax.replaceWith(wrapper); wrapper.append(tax);
      const icon = document.createElement("span"); icon.innerHTML = "<svg></svg>"; wrapper.parentElement.append(icon);
      const tab = document.createElement("button"); tab.setAttribute("role", "tab"); tab.innerHTML = "<span>Holders</span>"; fixture.append(tab);
      const val = value(fixture, "Dev H."); val.innerHTML = '<span data-tooltip-trigger><span>0%</span></span>';
      let info = read(fixture);
      assert(info.tiles.tax.value === 1.25 && info.tiles.developerHoldings.value === 0 && info.tiles.sniperHoldings.value === 0, "Wrappers and icons supported");
      assert(info.tiles.holderCount.value === 181, "An exact Holders tab label cannot conflict with the Holders tile");
      value(fixture, "Dev H.").textContent = "oops";
      info = read(fixture);
      assert(info.tiles.developerHoldings.value === null && info.tiles.top10Holders.value === 24.61 && info.tiles.sniperHoldings.value === 0, "Invalid dev value cannot borrow either neighboring percentage");
      label(fixture, "Dev H.").textContent = "Dev H. extra";
      assert(read(fixture).tiles.developerHoldings.status === "missing", "Exact label required");
    });
    await test("Malformed, conflicting, out-of-range, hidden and missing tile values stay unavailable", () => {
      for (const raw of ["-1%", "101%", "100.00000000000000001%", "4% 5%", "bad", "", "0.1.2%", "1e2%"]) {
        reset(); value(fixture, "Dev H.").textContent = raw;
        assert(read(fixture).tiles.developerHoldings.value === null, raw);
      }
      for (const hide of [node => node.hidden = true, node => node.style.display = "none", node => node.style.visibility = "hidden", node => node.setAttribute("aria-hidden", "true"),
        node => node.style.opacity = "0", node => node.parentElement.style.opacity = "0"]) {
        reset(); hide(value(fixture, "Snipers H."));
        assert(read(fixture).tiles.sniperHoldings.value === null, "Hidden value is unavailable");
      }
      reset(); value(fixture, "Dev H.").remove();
      assert(read(fixture).tiles.developerHoldings.value === null, "Missing value cannot use nearby zero");
      for (const tileHTML of ['<div><span></span></div>', ""]) {
        fixture.innerHTML = `<div><div>${tileHTML}<div><span>Dev H.</span></div></div><div><span>71%</span></div></div>`;
        assert(read(fixture).tiles.developerHoldings.value === null, "An empty/removed value band cannot borrow an unlabeled neighboring percentage");
      }
      reset(); const clone = label(fixture, "Dev H.").parentElement.parentElement.cloneNode(true);
      clone.querySelector("span").textContent = "2%"; fixture.append(clone);
      assert(read(fixture).tiles.developerHoldings.status === "conflicting", "Conflicting labeled tiles are unavailable");
    });
    await test("CA, DA, funding and social links cannot substitute for one another; full-address conflicts stay explicit", () => {
      reset(); const daLink = fixture.querySelector(`a[href$="/account/${da}"]`);
      daLink.remove(); let info = read(fixture);
      assert(info.developer.address === null && info.token.address === ca && info.funding.sourceAddress === funder, "Social search and funding never establish DA");
      fixture.querySelector('a[href*="x.com/search"]').remove(); info = read(fixture);
      assert(info.developer.username === "devngineer" && info.developer.address === null && info.funding.sourceAddress === funder, "Username-only developer display stays unverified and funding stays separate");
      reset(); fixture.querySelector(`a[href$="/account/${ca}"]`).href = "http://solscan.io/account/" + ca;
      info = read(fixture); assert(info.token.address === null && info.developer.address === da, "CA requires HTTPS in its own block");
      reset(); const link = fixture.querySelector(`a[href$="/account/${da}"]`), conflicting = link.cloneNode(true);
      conflicting.href = "https://solscan.io/account/" + ca; link.parentElement.append(conflicting);
      info = read(fixture);
      assert(info.developer.status === "conflicting" && info.developer.address === null && info.developer.candidates.length === 2, "Full-address conflict retained");
      assert(info.tiles.developerHoldings.value === 0, "Missing/conflicting developer does not block tiles");
      reset(); const caLink = fixture.querySelector(`a[href$="/account/${ca}"]`), caConflict = caLink.cloneNode(true);
      caConflict.href = "https://solscan.io/account/" + da; caLink.parentElement.append(caConflict);
      info = read(fixture); assert(info.token.status === "conflicting", "CA conflicts retained");
      const context = AxiomTokenContextDetector.detect(fixture, {href: "https://axiom.trade/meme/pool-route"}, info.token);
      assert(context.conflict && !context.mintAddress, "Conflicting CA makes token context unresolved");
    });
    await test("Explicit CA reconciles mint hints without treating the route, developer or funding as the mint", () => {
      reset(); const info = read(fixture);
      let context = AxiomTokenContextDetector.detect(fixture, {href: `https://axiom.trade/meme/${funder}`}, info.token);
      assert(context.mintAddress === ca && context.routeAddress === funder && context.poolAddress === null && context.blockchain === "solana" && !context.conflict, "Untyped route stays separate");
      for (const address of [da, funder]) fixture.querySelector(`a[href$="/account/${address}"]`).href = "https://solscan.io/token/" + address;
      const separate = read(fixture);
      context = AxiomTokenContextDetector.detect(fixture, {href: `https://axiom.trade/meme/${funder}`}, separate.token, separate);
      assert(context.mintAddress === ca && !context.conflict, "Developer and funding explorer token paths cannot become token mint hints");
      const hint = document.createElement("div"); hint.dataset.tokenMint = da; fixture.append(hint);
      context = AxiomTokenContextDetector.detect(fixture, {href: `https://axiom.trade/meme/${funder}`}, info.token);
      assert(context.conflict && context.mintAddress === null, "Contradictory explicit mint stays unresolved");
    });
    await test("Cached Token Info reader clears reused token panels, persists guards, and accepts replacement", () => {
      reset(); const reader = AxiomTokenInfo.createReader();
      const get = routeKey => reader.read(nodes(fixture), {routeKey});
      assert(get("a").tiles.tax.value === 1.25, "Initial token");
      assert(get("b").status === "awaiting-token" && get("c").developer.address === null, "Rapid switches suppress old panel");
      assert(get("c").funding.sourceAddress === undefined && get("c").tiles.tax.value === null, "Repeated reads do not revive stale context");
      fixture.querySelector(`a[href$="/account/${ca}"]`).href = "https://solscan.io/account/" + funder;
      let info = get("c");
      assert(info.token.address === funder && info.developer.status === "awaiting-token" && info.tiles.tax.value === null, "CA can update before old tiles and DA");
      info = get("c"); assert(info.developer.address === null && info.tiles.tax.value === null, "Partial panel guard persists across rereads");
      value(fixture, "Tax %").textContent = "2%";
      assert(get("c").tiles.tax.value === 2, "Changed tile becomes current independently");
      fixture.innerHTML = capture;
      info = get("d"); assert(info.developer.address === da && info.tiles.tax.value === 1.25, "Replacement panel is a fresh observation");
      fixture.replaceChildren(); info = get("d");
      assert(info.tiles.tax.value === null && info.developer.address === null, "Removed panel clears all fields");
    });
    fixture.replaceChildren();
  }
  async function dashboard(test, assert, frame) {
    await test("Token Info dashboard preserves both holder counts, renders text safely, validates links and ages observations", () => {
      const {win, doc} = frame;
      const root = document.createElement("div"); root.innerHTML = capture; document.body.append(root);
      const info = read(root); root.remove();
      const now = Date.now(); info.observedAt = now;
      info.developer.username = '<img src=x onerror="throw 1">'; info.developer.usernameTitle = "<script>unsafe</script>";
      info.funding.sourceExplorerUrl = "javascript:alert(1)"; info.funding.transactionUrl = "https://evil.test/tx/something";
      const context = {sourceKey: "info-token", routeKey: "route", mintAddress: ca};
      const snapshot = {url: "route", tokenKey: "route", chartContext: context, capturedAt: now, marketObservedAt: now, tokenInfo: info, stats: {holders: "182", top10Holders: "24.61%", bundlers: "29.62%"}};
      win.render(snapshot);
      assert(doc.getElementById("tokenInfo-developerHoldings").textContent.includes("0%") && doc.getElementById("tokenInfo-dexPaid").textContent.includes("Unpaid"), "Zero and payment status shown");
      assert(doc.getElementById("tokenInfoHolderCounts").textContent.includes("181") && doc.getElementById("tokenInfoHolderCounts").textContent.includes("182") && doc.getElementById("tokenInfoHolderCounts").textContent.includes("disagree"), "Counts and sources preserved");
      assert(doc.getElementById("tokenInfoIdentity").textContent.includes("<img") && !doc.querySelector("#tokenInfoIdentity img, #tokenInfoIdentity script"), "Unsafe source text is plain text");
      assert([...doc.querySelectorAll("#tokenInfoIdentity a")].every(link => link.protocol === "https:" && link.hostname === "solscan.io" && link.rel.includes("noopener")), "Only validated explorer URLs rendered");
      const row = {walletAddress: da, identityStatus: "resolved", observedAt: now, extractionId: "match", tokenContext: context, remainingPercentage: "0%", remainingTokenValue: "$0", tokenQuantity: null};
      const holders = {context, activeTable: {kind: "holders"}, tableStatus: "available", extractedAt: now, extractionId: "match", rows: [row]};
      win.AxiomTokenInfoUI.render(snapshot, holders, now);
      assert(doc.getElementById("developerHolderMatch").textContent.includes("Full-address developer match") && doc.getElementById("developerHolderMatch").textContent.includes("0%"), "Current full developer address matches holdings");
      win.AxiomTokenInfoUI.render(snapshot, holders, now + 10001);
      assert(doc.getElementById("tokenInfo-tax").querySelector(".value").textContent === "Unavailable" && !doc.getElementById("developerHolderMatch").textContent.includes("Full-address developer match"), "Stale source is unavailable even if republished");
      win.AxiomTokenInfoUI.render({...snapshot, tokenKey: "new", chartContext: {...context, routeKey: "new"}}, holders, now);
      assert(doc.getElementById("tokenInfo-tax").querySelector(".value").textContent === "Unavailable", "Token mismatch clears old fields");
    });
  }
  return {extraction, dashboard};
})();
