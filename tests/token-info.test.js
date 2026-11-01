"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const T = require("../tokenInfoExtractor.js");
const address = "Fe5i9MriTnRYbDJiZeUn2isJsx6zQkanzw7HisZj4uJi";
test("Token Info percentages preserve zero and reject complete malformed or out-of-range values", () => {
  for (const [raw, expected] of [["0%", 0], ["1.25%", 1.25], ["100%", 100], ["24.61 %", 24.61]]) assert.equal(T.parse(raw, "percentage"), expected);
  for (const raw of [null, "", "—", "-1%", "101%", "100.00000000000000001%", "1e2%", "4% 5%", "0.1.2%", "1%foo"]) assert.equal(T.parse(raw, "percentage"), null, String(raw));
});
test("Token Info counts and payment status have independent grammars", () => {
  assert.equal(T.parse("0", "count"), 0); assert.equal(T.parse("1,234", "count"), 1234);
  for (const raw of ["1.2", "1%", "12,34", "1K", "9007199254740992", "Unpaid"]) assert.equal(T.parse(raw, "count"), null);
  assert.equal(T.parse("Unpaid", "payment-status"), "unpaid"); assert.equal(T.parse("Paid", "payment-status"), "paid");
  for (const raw of ["0", "1%", "Not Paid", "Unknown"]) assert.equal(T.parse(raw, "payment-status"), null);
});
test("Explorer links require supported HTTPS hosts, full public addresses and transaction paths", () => {
  assert.equal(T.explorerLink(`https://solscan.io/account/${address}?ref=ignored`).address, address);
  for (const url of [`http://solscan.io/account/${address}`, `https://solscan.io.evil.test/account/${address}`, `https://x.com/search?q=${address}`,
    `https://user:pass@solscan.io/account/${address}`, `https://solscan.io:99/account/${address}`, "javascript:alert(1)", "https://solscan.io/account/Fe5i...uJi",
    "https://solscan.io/account/0x" + "1".repeat(40)]) assert.equal(T.explorerLink(url), null, url);
  assert(T.explorerLink("https://solscan.io/tx/" + "3".repeat(88), "transaction"));
  assert.equal(T.explorerLink(`https://solscan.io/account/${address}`, "transaction"), null);
});
function matchingState() {
  const now = 1700000000000, context = {sourceKey: "token", routeKey: "route"};
  const info = {status: "observed", observedAt: now, routeKey: "route", developer: {status: "resolved", address}};
  const row = {walletAddress: address, identityStatus: "resolved", extractionId: "read", observedAt: now, tokenContext: context, remainingPercentage: "0%", remainingTokenValue: "$0", tokenQuantity: null};
  const holders = {context, activeTable: {kind: "holders"}, tableStatus: "available", extractedAt: now, extractionId: "read", rows: [row]};
  return {info, holders, context, now};
}
test("Developer match requires the same resolved full address in a current token extraction", () => {
  const s = matchingState();
  assert.equal(T.matchDeveloper(s.info, s.holders, s.context, s.now).status, "matched");
  assert.equal(T.matchDeveloper(s.info, s.holders, s.context, s.now).rows[0].remainingPercentage, "0%");
  for (const edit of [s => s.info.developer.address = "Fe5i...uJi", s => s.info.developer.status = "conflicting", s => s.info.routeKey = "other",
    s => s.holders.context = {sourceKey: "other"}, s => s.holders.rows[0].observedAt--, s => s.holders.rows[0].extractionId = "old",
    s => s.holders.activeTable.kind = "top-traders", s => s.now += 10001, s => s.context.conflict = "ambiguous"]) {
    const state = matchingState(); edit(state); assert.notEqual(T.matchDeveloper(state.info, state.holders, state.context, state.now).status, "matched");
  }
  s.holders.rows[0].walletAddress = null; s.holders.rows[0].walletDisplay = "devngineer";
  assert.equal(T.matchDeveloper(s.info, s.holders, s.context, s.now).status, "not-observed");
});
test("Conflicting current developer rows remain unavailable; no transfer/sale inference is created", () => {
  const s = matchingState(); s.holders.rawRows = [s.holders.rows[0], {...s.holders.rows[0], remainingPercentage: "1%"}];
  const match = T.matchDeveloper(s.info, s.holders, s.context, s.now);
  assert.equal(match.status, "conflicting"); assert.equal(match.rows.length, 0);
});
