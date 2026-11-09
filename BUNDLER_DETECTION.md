# Local Bundler Detection

The separate **Bundler Detection** panel shows a local **0–100% heuristic suspicion score**, an observed-signal coverage percentage, Axiom's own Bundlers percentage, and a signal table. It is not a calibrated probability, on-chain bundle classifier or safety rating. Weights and thresholds are engineering choices without measured classification accuracy.

Each signal shows its observed percentage, matching/eligible count, weighted points, and source limitations. Expand **Repeated values, groups & wallet addresses** for exact repeated values, wallet labels/full addresses when exposed, balance/Bought/Remaining/funding context, and approximate trade ranges. Expand the separate duplicate-address section for repeated full wallet addresses and occurrence counts. Duplicates count once and do not contribute suspicion. Equal shortened names never establish a shared identity.

## Signals and denominators

| Signal | Weight | Ratio and evidence |
| --- | ---: | --- |
| Repeated native balances | 10 | Rows in repeated positive displayed balance/unit groups / rows with a valid positive native balance and known currency. Supports SOL, ETH and BNB without mixing currencies. |
| Repeated Bought totals | 15 | Rows in repeated positive cumulative Bought amount/unit groups / rows with a valid positive displayed Bought amount and known currency. These are cumulative totals, not individual purchase sizes. |
| Similar small holdings | 10 | Rows in similar positive holdings groups / rows with valid holdings of at most 5% each. Sort by percentage and form disjoint groups whose maximum/minimum is at most 1.10. Show combined Axiom-displayed supply exposure; no renormalization. If displayed percentages sum above 100%, with a 1e-9 percentage-point float tolerance, holdings points and combined exposure are unavailable. |
| Shared displayed funding addresses | 25 | Rows in repeated full funding-address groups / rows with a resolved funding address. Only full addresses actually exposed in the Funding cell qualify. A transaction URL never identifies its sender. Groups with an explicit known exchange label contribute zero points. Funding direction, ownership and pre-launch timing remain unverified. |
| Repeated funding labels | 5 | Rows in repeated non-exchange label/short-address groups / rows with such a label and no full funding address. This is weak text similarity; labels can collide. Missing/unknown labels are excluded. |
| Displayed developer funding match | 10 | Rows whose full displayed funding source matches the fresh resolved Axiom developer address / rows with full funding addresses. Exchange-labeled rows do not contribute. This is a DOM identity match, not a verified developer transfer. |
| Similar-size buys within 5s | 10 | Distinct full-address buyers in qualifying bursts / eligible distinct full-address buyers in the last 5m. Require at least 3 wallets, equal positive displayed Total/unit, and a complete approximate time span at most 5s. |
| Similar-size sells within 5s | 10 | Same method for observed sales. Transfers or token movements never count as sales. |
| Axiom-flagged rendered rows | 5 | Rows with the exact Axiom Bundler badge / rows with an observed boolean badge result. Show their combined remaining supply percentage when valid. This reuses Axiom's classification with a small explicit weight. |

The Axiom token-wide Bundlers percentage is shown separately as context and contributes no points. The displayed percentage denominators are observed rows/wallets for that signal, not token-wide wallet totals. Equal rounded balances, repeated trade sizes, and shared services can arise naturally. Fee repetition is not scored.

**Unavailable evidence:** funding before launch, first-slot/same-slot activity, developer-to-wallet token transfers, and transfer-to-wallet-then-sale paths. The existing extension does not collect the directed decoded transactions, launch timestamp or slot numbers needed to establish these. These remain explicit unavailable rows, with no fabricated percentage.

## Score calculation

Groups of two or more rows appear in the evidence ratios. Size, holdings, funding and developer-match groups must contain at least **3 rows** to contribute points. Axiom's badge signal counts each flagged row directly. A signal's points are its weight multiplied by its supported matching fraction. The weights sum to 100; missing signals contribute zero and available weights are **not renormalized**. Thus the score remains conservative when most kinds of evidence are unavailable. Multiple correlated patterns are not independent proof.

The sum is multiplied by `min(current analyzed holder rows / 10, 1)` to reduce small-sample scores. When more than half the holder rows lack full wallet identities, cap the final score at **45%**. Unresolved rows still support explicitly labeled row-pattern ratios, without claiming they represent distinct wallets. Trade-only evidence uses a factor of 1 because its bursts separately require 3 distinct full addresses. Round the final score to an integer.

**Observed signal coverage** is the sum of weights whose denominators are available. It describes available signal inputs, not wallet coverage, verification quality or probability. An insufficient/stale source has an unavailable score; a zero score means no weighted pattern was established from available inputs.

## Eligibility, timing and isolation

The market source and current holder extraction must be at most 10 seconds old. Holder rows must belong to the same token/network/route and exact extraction ID/time. Hidden, awaiting-token, inactive, Top Traders or unknown views contribute no rows. Supported rows from partially unsupported tables remain usable with the unsupported count disclosed. Never fill current groups from the session cache or infer complete coverage from matching holder counts.

Use full wallet addresses to deduplicate, with case-insensitive EVM keys and case-sensitive Solana keys. Exclude wallets with conflicting duplicate balances, holdings, Bought amounts, funding or badge evidence. Display duplicate address occurrences separately. Exclude supported Axiom-reported pool/contract rows or the resolved pool address; a protocol name alone is insufficient. Unresolved rows remain separate observations. Zero values and unknown currencies cannot form size-repetition evidence. Exact decimal strings normalize displayed decimal/suffix amounts without float equality or rounding tolerance; equal display values are not proven equal precise balances.

Trade evidence is filtered to the selected source tab and matching token/trade context. It uses the latest **1,000** unique eligible in-memory events from a **5-minute** observation window, with omitted/conflicting event counts disclosed. This analysis cap does not alter the independent trade archive. Initial feed synchronization, unresolved maker identities, unknown directions and coarse ages cannot establish bursts. Complete approximate age intervals, rather than only estimated centers, must fit inside 5 seconds. Bursts use nonoverlapping windows within each amount/currency group; filters and unavailable coverage are disclosed. These are approximate displayed trade times, not blockchain timestamps or slots. Busy launches can produce the same pattern.

The dashboard requests the current worker result approximately every 3 seconds, with immediate holder-only local calculation on snapshot updates. Selection generations and context checks prevent late responses from populating another token/tab. Stale source observations clear the score. There are no new host permissions, API calls, backend services, automated page actions or trading actions.

## Recordings and validation

The **All analyzer data + holder rows** scope includes `bundlerDetection`: score, formula/version, signal ratios and denominators, contributions, groups and member identities, duplicate addresses, coverage/limits and source times. Supply & Valuation-only recordings omit it. Compact export preserves the recorded evidence; existing recordings cannot acquire new evidence retrospectively. Detailed evidence uses the existing bounded recording storage, so long/dense recordings can reach its size limit sooner.

Implementation: `bundlerDetection.js` (pure analysis), `bundlerDashboard.js` (panel), `holderTableExtractor.js` (full displayed funding identity and Bought/Sold currency), worker adapter/command, recorder projection, dashboard markup/styles and documentation. Tests cover pure scoring/denominators, precision/currencies, small samples, zero/missing data, duplicate/conflicting addresses, stale/mismatched sources, exchange labels, unsupported on-chain signals, burst timing/source isolation and caps, compact reports, worker commands and browser rendering. Screenshot-like ETH balance and short funding-label patterns are exercised without treating those abbreviations as resolved identities.

Validation passed: **181 unit tests, 100 browser scenarios and 56 native IndexedDB write/restart checks**. Browser checks use local fixtures and require Chrome subprocess execution outside the filesystem sandbox. No live Axiom session or independently labeled on-chain bundle dataset was used, so classification accuracy remains unmeasured.
