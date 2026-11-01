# Token Info & Developer Exposure

This extension reads Axiom's displayed DOM. The observations are Axiom-reported, publicly displayed context; they are not independent on-chain verification. No new API, host permission, backend, wallet access or page action is involved. Existing optional historical-price requests remain user initiated and separate.

## Supported fields

| Display label | Snapshot field under `tokenInfo.tiles` | Type |
| --- | --- | --- |
| Tax % | `tax` | Displayed percentage; no established buy/sell split |
| Top 10 H. | `top10Holders` | Axiom-reported percentage |
| Dev H. | `developerHoldings` | Axiom-reported developer holdings percentage |
| Snipers H. | `sniperHoldings` | Axiom-reported sniper holdings percentage |
| Insiders | `insiders` | Axiom-reported classification percentage |
| Bundlers | `bundlers` | Axiom-reported classification percentage |
| LP Burned | `lpBurned` | Axiom-reported LP percentage; not token supply burned or a safety guarantee |
| Holders | `holderCount` | Nonnegative integer tile count |
| Pro Traders | `proTraders` | Nonnegative integer count |
| Dex Paid | `dexPaid` | `paid` / `unpaid` status; no trading-fee or security inference |

Each tile records its exact label, type, numeric/status value, original display text, relevant source text, status, source and actual DOM observation time in Unix milliseconds. Valid zero is retained. Missing, hidden, malformed, contradictory and out-of-range values remain null/unavailable. Count parsing never accepts percentages, abbreviated counts or payment statuses. Percentages must be complete strings within 0–100, including decimal-boundary validation before floating-point conversion.

The supplied HTML is preserved verbatim as `tests/fixtures/token-info.html`. Its values are fixture expectations, not constants in extraction. Exact labels and local value/label branches determine scope; icons and nested tooltip wrappers are supported. A missing value cannot borrow an adjacent tile's percentage. Multiple conflicting copies of a tile are unavailable. The reader checks rendered visibility rather than treating hidden DOM values as current observations.

`stats.top10Holders` and `stats.bundlers` remain compatible aliases of these same tile observations. Their existing cards now sit in the Token Info section. There is one source for each percentage. `stats.holders` continues to mean the **Holders tab count**; it never gets overwritten by the **Holders tile**. The dashboard displays both sources and flags disagreements. Neither count proves complete holder coverage.

## Identities and funding

`tokenInfo.token` uses the **CA:** address block; `tokenInfo.developer` uses **DA:**. Full public addresses come from validated HTTPS explorer links within the corresponding row. Abbreviated text, a username, a social-search query and funding links cannot establish either identity. Conflicting addresses retain candidate addresses and a conflicting status instead of choosing the first link. Recognized explorer hosts are Solscan, Solana Explorer, Etherscan, BscScan and BaseScan; unsupported links remain unavailable. Hosts, paths, scheme, credentials, ports and address shapes are checked; unrelated query/fragment parameters are discarded. These checks validate public-link format, not chain ownership or the contents of the linked page.

The developer's `username`, `usernameTitle` and `usernameVerification` are separate from its full address. The fixture's `devngineer` title explicitly identifies a **self-chosen pump.fun username, not a verified identity**. The dashboard preserves that qualification. A username-only developer display can remain present with an unresolved address.

The scoped developer funding subsection records:

- `sourceAddress`, `sourceExplorerUrl`, resolution status and candidate addresses;
- a validated public `transactionUrl`;
- displayed `amount` and `currency`, separately (`0.91` and `SOL` in the capture);
- `relativeAgeText` (`9mo` in the capture), source text and actual observation time;
- `badgeText` (`0 / 1`) with `badgeMeaning: "uninterpreted"`.

The badge is retained as metadata and omitted from the main analysis. Funding relative age is preserved verbatim. It is not token age, and `transactionTimestamp` remains null. An ambiguous funding address, transaction or amount is unavailable for that field; other supported fields remain usable. No control is clicked, including the funding badge, Blacklist dev, Scan developer address, or trading controls.

The existing token-context detector accepts the scoped CA as an explicit Axiom token hint, reconciles it with existing mint/network hints and records disagreement. Developer/funding identities are excluded from generic token-explorer hints. Route, token mint and pool addresses remain separate. A route address alone never becomes a mint. This improves DOM context without claiming independent token verification.

## Lifecycle and current holder matches

The reader uses the existing cached label discovery, coalesced market observer and `AXIOM_STATS_UPDATE` snapshot/storage flow. Regular reads examine the bound local tiles and identity rows. Holder-only changes reuse the last Token Info observation and preserve its timestamp. The existing full-document label discovery is limited to initial discovery, route changes, and throttled discovery after relevant added/replaced labels; each DOM mutation does not trigger a document-wide scan. Changes to explorer hrefs, source titles, `hidden` and `aria-hidden` also schedule bounded reads. CSS visibility is rechecked during the existing heartbeat without subscribing to every class/style animation across the document. No additional source polling loop or document observer was added for Token Info.

Route changes suppress reused old panel nodes. An explicit CA change can arrive before replacement of other cells, so unchanged reused tiles, DA and funding parts remain unavailable until their own display changes or their nodes are replaced. This is deliberately conservative: an unchanged value during a partial token transition can remain unavailable until Axiom refreshes that part. Rapid switches do not revive prior data. Detached or hidden panels clear on the next coalesced read; discovery of replacement labels can take up to the existing 2.5-second discovery interval plus 500ms coalescing. Back/forward cache lifecycle uses the existing disconnect/resume behavior.

The dashboard displays observation times, source and unavailable states. A 10-second local age limit clears stale Token Info and developer matches even without a new snapshot. It only measures local DOM readability, not Axiom's upstream freshness. Legacy snapshots retain their existing Top 10/Bundlers cards without creating new Token Info observations. Text uses `textContent`; explorer links are validated again before rendering.

A developer match requires the same resolved **full** address in the current Holders extraction and a matching, nonconflicting token context. Current rows must be at most 10 seconds old and share the extraction ID/time/context. Identical DOM copies do not add holdings; contradictory holdings for the address produce a conflicting match. Names, abbreviations and the session cache never establish a match. The displayed match includes observed supply percentage, holding value and explicit current token quantity when available. Not observing a developer in a virtualized subset does not establish zero holdings. A decrease in a displayed holding is only an observed change. `verifiedTransfers`, `decodedSales` and `walletClustering` remain unavailable until transaction evidence exists.

## Validation and manual Axiom checks

Run `npm.cmd test`, `npm.cmd run test:browser` and `npm.cmd run test:storage`. The regression suite covers all supplied tiles and valid zero, exact scoping, icons/tooltips, malformed/hidden/missing values, separate count/payment grammars, scoped identities and conflicts, username-only identity, funding text/badge, route/partial-panel switches, full-address holder matching, safe rendering, no page clicks, timestamp preservation, and existing market/holder/chart/storage compatibility.

Validation on 2026-10-31: **70 unit/protocol tests, 46 browser scenarios, 20 IndexedDB/restart checks, JavaScript syntax checks and `git diff --check` passed**. The supplied capture was checked byte-for-byte against the attachment. Failed checks remaining: none. The initial sandboxed Chromium attempt timed out; permitted execution outside the sandbox passed. Unrun: live authenticated Axiom/manual checks and independent transaction verification. No new external integration requires a live API test. No commit or push was made.

Automated fixture tests do not replace a live authenticated Axiom check. After reloading the extension and refreshing Axiom and the dashboard:

1. Compare all ten tiles to the live Token Info panel, including zero values. Values may differ from the capture as Axiom updates.
2. Compare the Holders tile and tab count. Both must retain their own values if they disagree.
3. Compare CA, DA and funding explorer targets without invoking page controls. Verify a shortened address or username does not change the recorded full identity.
4. Check the developer username qualification, displayed funding amount/unit and relative age. No exact funding date or token age should be inferred.
5. Switch tokens/routes/networks, including during loading, and replace/collapse the panel. Prior values and developer matches must clear; unrelated tiles must work without a developer block.
6. Open Holders manually. A developer match requires a visible resolved full-address row; scrolling a virtualized list can remove it. Verify zeros and unavailable quantities are displayed faithfully.
7. Stop source updates for over 10 seconds and confirm the dashboard clears stale values. Check narrow widths, text wrapping, browser console and existing charts.
8. Check extension/source network activity: this feature must not request an API or use wallet/trading controls.

Additional evidence needed to interpret ambiguous fields: the **funding badge's explanatory tooltip HTML** (including the text explaining both sides of `0 / 1`); authoritative Tax %, LP Burned, Insiders/Snipers/Bundlers, Pro Traders and Dex Paid definitions/tooltips if stronger interpretations are wanted; and transaction evidence for exact timestamps, transfers, sales or clustering. Unsupported alternate-chain or changed panel layouts need their own HTML capture. Until supplied, those meanings and independent verification remain unavailable.
