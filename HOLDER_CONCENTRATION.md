# Holder concentration: sources, evidence and limits

The extension remains free and read-only. Concentration uses Axiom's rendered DOM, not a wallet connection, trading action, backend or new API integration. No `AGENTS.md` or `PROJECT_CONTEXT.md` was found in the project or checked parent locations for this change. Existing liquidity, price, market-cap, holder layouts and Axiom-reported Top 10 extraction remain in place.

## Audit of available data

| Field | What it means | What it does not establish |
| --- | --- | --- |
| `nativeBalance`, `balanceCurrency` | Displayed wallet SOL, ETH or BNB balance; the unit comes from explicit row/header evidence | Quantity of the selected token, ownership of those native funds, or token concentration |
| `remainingTokenValue`, `remainingValueCurrency` | Displayed current holding valuation, such as `$563` or `$0.525`; preserved as text | Token quantity, exact valuation, token decimals or independently verified balances |
| `remainingPercentage` | Axiom's displayed supply percentage, preserved as a complete text fragment | An independently checked supply denominator, an unrounded balance or a complete owner ranking |
| `tokenQuantity`, `tokenQuantitySource` | Current quantity only when explicitly exposed as `data-field="token-quantity"` with numeric quantity text | A value derived from dollars, native balance, supply, price, or Bought minus Sold |
| `boughtAmount`, `soldAmount` | Existing displayed trade amounts | Current holdings |
| `boughtTokenQuantity`, `soldTokenQuantity` | Historical traded quantity when an explicit quantity field or the captured quantity/count secondary line exposes it | Current token quantity; transactions/transfers outside those cells are unknown |
| `walletAddress`, `identityStatus` | A unique full public address from consistent wallet-cell text, attributes or account/address links; contradictory hints produce a null address and `conflicting` status | Independent owner identity or aggregation of multiple blockchain token accounts |
| `rank` | Axiom's displayed row number | Largest token holder without reliable sort and leading-set evidence |
| `stats.top10Holders` | Separate Axiom-reported Top 10 tile | A value calculated from our holder rows or independently verified on-chain |

`remainingDisplayText` retains the Remaining cell's text for inspection. Ambiguous unmarked Remaining amounts are not relabeled as dollar values or token quantities. The legacy `solBalance` alias remains available only for an identified SOL balance.

The supplied reduced SOL fixture has ranks 1–2, native SOL balances and Remaining values/percentages. BNB has ranks 75–76 and shortened addresses. ETH has ranks 1, 2 and 7, native ETH balances and small subscript Remaining values. Their Top/Remaining sort buttons do not expose a reliable direction. They do not provide current token quantity fields, full identities for the named pool entries, explicit wallet-classification fields, or independent supply definitions. The supplied Top 10 tile exposes only the reported percentage and label. The literal `LIQUIDITY POOL`, `UNISWAP V4 POOL`, funder names and protocol icons do not establish independently known classifications.

## Current extraction versus session history

Every actual holder-table read produces:

- `extractedAt`: actual extraction time in Unix milliseconds;
- `extractionId`: an identifier shared by this read's rows;
- `context`: the current network, token/mint, pool and route hints, plus `sourceKey` and any identity conflict;
- row `observedAt`, `extractionId` and `tokenContext`, copied from that read;
- current active-table and sort metadata.

Reusing a snapshot or updating `capturedAt` does not modify these fields. A real reread of unchanged visible cells can refresh current observations. It does not refresh older wallets retained in the session cache. Unchanged-value monitor callbacks remain suppressed, while the current state can contain a newer actual read time. Dashboard row rendering ignores timestamp-only changes; observation/status indicators update separately.

The Axiom-reported Top 10 tile has its own `marketObservedAt` from the actual market DOM read. Holder-only republication preserves this time. A snapshot with no original market read time displays observation time unavailable.

Calculations accept only one current extraction: all input rows must share its extraction ID, exact observation time, source key, network, mint, pool and route context. A missing/conflicting context, mixed-age rows, a future extraction time, or an extraction older than **10 seconds** makes the result unavailable. The 10-second bound is a local usability threshold; it does not certify Axiom's upstream freshness. A dashboard timer reevaluates age even if no new snapshot arrives.

When the dashboard snapshot supplies its active chart/token context, the holder extraction must also match that context. A coherent but older holder extraction from another token/network/pool on the same route is rejected. Actual DOM rows hidden by `hidden`, `aria-hidden`, `display:none` or CSS `visibility:hidden/collapse` are excluded from the current extraction and are not refreshed in the session cache. Existing older session observations retain their original times.

The monitor retains at most **1,000 full-address session observations**, with explicit truncation, and examines at most **500 rendered row candidates** per read. Session count and observation range are displayed separately; session rows are never used to fill a current ranking. Context changes—including a new mint or pool on the same route—reset the cache and preserve the unchanged-previous-token-row guard. Full-address deduplication and scoped/coalesced observers remain in place. Holder history remains session memory; this change does not add a holder archive or alter price/liquidity IndexedDB storage.

## Active table and sorting

The actual fixtures identify Holders with `data-perf-id="token-table-holders"`. Known Top Traders table markers and visible, recognized `role="tab" aria-selected="true"` states suppress holder extraction when another view is active. Contradictory selection evidence stays unknown. Unknown table containers are not parsed using the Holders layout. Cached/hidden Holders rows cannot become Top Traders holder observations.

Sorting is accepted only from exactly one visible, recognized header exposing `aria-sort="ascending"` or `"descending"`. The captured header structure and ARIA/TH headers are supported; arbitrary row attributes, icons, empty buttons and display rank alone do not establish a sort. Other cases display **Sort order unknown**. An explicitly sorted native balance, Bought column or ascending Remaining column is reported as such and cannot establish largest token holders.

The current captures expose no reliable direction. Tests that add ARIA sort or semantic classification/quantity fields are synthetic evidence tests; they do not claim that current live Axiom exposes those attributes.

## Calculation rules and labels

The reported market tile is labeled **Top 10 Holders — Axiom-reported** and never substituted for a calculated result.

For each requested count, 1, 5 or 10:

1. Use current rows only and identify valid full addresses. Normalize EVM address casing; preserve Solana address casing. Shortened addresses and equal names remain unresolved rows. Conflicting full-address hints within a wallet cell cannot be resolved by taking the first address; they stay unresolved and are not session cache keys.
2. Deduplicate identical full-address rows. Keep raw current rows for duplicate/rank validation. Conflicting percentages, displayed values or explicit token quantities for the same address make calculations unavailable. An address at multiple ranks cannot establish wallet-level leading order. This is DOM deduplication, not blockchain token-account aggregation.
3. Require valid complete percentage strings. Zero is valid. Missing, negative, malformed or greater-than-100 percentages for an identifiable wallet make calculation unavailable. Malformed fragments are not salvaged by extracting a valid-looking substring.
4. Sum decimal display strings using exact decimal alignment before conversion for presentation. A valid identifiable subset totaling more than 100% is rejected, even if rounding might explain it. Results remain approximate because the underlying percentages are displayed/rounded values; no token decimals are needed to add percentages.
5. Apply only selected, supported exclusions and count eligible identities afterward. Exclusion never renormalizes the denominator.
6. Establish a leading set only with an explicit Remaining-descending sort, contiguous ranks beginning at 1 through the required nonexcluded count, valid unique identities, and percentages consistent with descending order. Missing ranks, unresolved leading rows, duplicated ranks, inconsistent percentages, unsupported rows and the rendered-row safety limit prevent this proof. Different/unresolved addresses sharing one rank invalidate the leading-order evidence even for Top 1; identical DOM copies of the same full address at the same rank remain deduplicated. Excluded leading entries still require an identifiable address and valid evidence/percentage.

When that evidence exists, label the result **Top N — Axiom table order** with an explicit DOM source and “not independently verified” explanation. This is a qualification of Axiom's current displayed table order, not an independent token-wide owner ranking.

Otherwise, if enough identifiable wallets and valid percentages exist, label the sum **Largest N observed wallets — partial coverage**. It describes only the valid identifiable current subset; it never claims those are the token's actual largest owners. With fewer than N eligible identities, or invalid/mixed/stale evidence, show **Unavailable** and the specific reason.

The denominator is always **Axiom-reported supply; exact definition unavailable; unchanged by exclusions**. Removing a pool from the numerator does not turn the denominator into circulating supply or supply minus pools/burns/lockers. Matching Axiom's reported holder count never proves completeness.

## Classification and supported exclusions

Each row includes `classification.category`, `source`, `evidence` and `verificationStatus`. Categories are `pool`, `burn`, `locker`, `other-contract` and `unknown`.

- Default: **unknown**, unverified. Display labels can be retained as `display-label-only` evidence without converting names/icons/address shapes into a category.
- An explicit `data-field="wallet-classification"` field with a recognized category records an **Axiom-reported hint**, not independent verification. This is a supported semantic input, absent from the current supplied captures.
- A full row address equal to the current unambiguous, explicitly identified Axiom pool address can record a pool hint with `pool-address-match` evidence. A route address, funding label or abbreviated pool name is insufficient.
- No path marks a row independently verified. Burn destinations, lockers and other contracts stay unknown unless explicit supported classification evidence exists. There is no hardcoded address list or explorer/API lookup.

The dashboard offers an opt-in **Exclude supported Axiom-reported pool entries** control, off by default. It only excludes address-resolved pool hints with supported evidence and the Axiom-reported status/source. The evidence contents are validated: an explicit classification must actually say Pool; a pool-address match must identify the same full row address and current explicit context pool without a context conflict. An evidence tag alone, a mismatched address, or a contradictory classification on duplicate rows cannot support exclusion. Excluded addresses, percentages, source, evidence and reasons are listed next to the results. Unknown rows remain included where identifiable and otherwise valid. Other classification categories are displayed but are not automatically excluded. An exclusion based on Axiom DOM evidence is clearly labeled unverified independently.

## Missing resources and independent verification

No new integration was added. DOM observations cannot establish independent on-chain wallet rankings. Before choosing any API, the following capabilities would need to be documented and verified for the intended **Solana, Ethereum, BNB Chain and Base** tokens:

| Required capability | Evidence needed before integration |
| --- | --- |
| Chain/token coverage | Exact supported chains, token standards/programs and any exclusions; support cannot be assumed from a generic market-data response |
| Complete holder enumeration | An endpoint enumerating all relevant holders/accounts, with pagination/cursors, limits, deterministic ordering and a reliable end-of-list indicator |
| Token-account-to-owner aggregation | For applicable chains, token-account address, owner address, mint and raw quantity; a documented complete aggregation into owner totals, not a limited largest-account list |
| Exact amounts and decimals | Integer raw amounts, token decimals, precision guarantees and token identity; no balances derived from fiat valuations |
| Supply definition | Exact block/slot supply and an explicit total/circulating denominator; treatment of burns, pools, lockers and contracts must be separately defined |
| Snapshot consistency | Block/slot identifiers and a way to keep paginated pages on one consistent snapshot, or an explicit inability to do so |
| Freshness | Source observation/block time, indexing lag, cache behavior and update cadence distinct from fetch time |
| Free-tier feasibility | Documented free access, chain coverage, request/page limits, monthly credits, rate limits and behavior after exhaustion; quota metadata only if actually exposed |
| Classification verification | Chain-specific evidence supporting pool/burn/locker/contract roles at the relevant snapshot; names and address appearance are insufficient |

No provider is assumed to supply this complete set. No paid service, API key, secret value, new host permission or independent verification claim was added. Keys must never be requested in chat or committed.

Specific missing live HTML:

1. The full Holders/Top Traders tablist and panel linkage, including selected/inactive states.
2. The header and sort-control DOM before/after sorting Remaining in both directions, including any reliable state attributes and rank/virtualized-position semantics.
3. Full-address markup for named pool/locker/burn/contract rows and the exact classification badge structure, if any.
4. A current token-quantity field, if Axiom exposes one, and authoritative text explaining the percentage denominator.

These gaps do not block partial observed-wallet analysis. Unsupported results remain unavailable instead of inventing evidence.

## Regression checks and manual validation

Run `npm.cmd test` and `npm.cmd run test:browser`. Tests cover current/other views, sort evidence and directions, complete/incomplete leading sets, duplicates, abbreviated identities, rounded/invalid/missing percentages, pool exclusions, unknown classifications, mixed-age snapshots, session separation, context switches, existing bounded caches, and reported-versus-calculated values. Browser tests continue to exercise SOL/BNB/ETH mapping, scoped observers, holder transitions, market statistics and existing charts.

Validation on 2026-10-30 after the follow-up audit: **65 unit/protocol tests, 39 browser scenarios, 20 native IndexedDB checks and `git diff --check` passed**. No remaining automated failures. Added cases exercise hidden rows, contradictory address hints, duplicate rank numbers, evidence contents and a changed dashboard token context on the same route. The storage suite was also run to verify existing price/liquidity persistence and browser-restart behavior. Chromium used temporary local profiles with execution permission outside the restricted sandbox, as required by this environment. Live authenticated Axiom checks, independent chain verification and the optional external-API smoke script were not run; no new integration exists to validate.

Changed files for the complete feature: added `holderConcentration.js`, `tests/holder-concentration.test.js` and this document; updated `holderTableExtractor.js`, `content.js`, `dashboard.html`, `dashboard.js`, `dashboard.css`, `package.json`, `tests/background.test.js`, `tests/browser-tests.html`, `tests/browser-tests.js` and `README.md`. The follow-up audit preserved those existing uncommitted changes and refined only `holderTableExtractor.js`, `holderConcentration.js`, `dashboard.js`, the concentration unit/browser tests, `README.md` and this document. No dependencies, vendor bundles, host permissions, price/liquidity archives or trading behavior changed. No commit or push was made.

After reloading the extension and refreshing Axiom/dashboard:

1. Compare native balance, Remaining value and supply percentage with several visible rows. Current token quantity should stay unavailable unless explicitly present.
2. Switch Holders/Top Traders. Only Holders may produce concentration; inspect whether real selected-tab/header attributes are supported.
3. Change each sort direction and column. Unsupported state says Sort order unknown; native balance/rank alone cannot produce a largest-holder claim.
4. Scroll the virtualized list. Current identifiable count and partial sums should reflect only visible rows; session count can grow separately and never complete a Top N result.
5. Switch tokens/networks/pools, including unchanged loading rows. Check cleared current results and cache reset. Pause the source for over 10 seconds; cached concentration must become unavailable even if a snapshot is republished.
6. Compare the independent Axiom-reported Top 10 card. Pool exclusion should list full addresses and reasons, leave its reported value untouched and retain the original supply denominator.
7. Inspect mobile/narrow widths and the console. No new API calls, trading actions, keys or independent-verification claims should appear.
