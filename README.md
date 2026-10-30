# Axiom Live Stats — Free Chart V2 (v0.6.0)

A read-only Chrome Manifest V3 extension with Axiom statistics, Bundlers, Holders Intelligence, and precise charts of locally recorded DOM observations. Everything remains free. The chart library is bundled locally; loading the extension needs no npm installation, API keys, backend, or wallet permissions. Node.js is used for development tests and rebuilding the bundle.

## Set up using VS Code

1. Open the existing `axiom-live-stats` folder in VS Code (**File → Open Folder**).
2. Open Chrome and visit `chrome://extensions` (or Edge at `edge://extensions`).
3. Enable **Developer mode** in the top-right corner.
4. Select **Load unpacked**, then choose the `axiom-live-stats` folder containing `manifest.json`.
5. Open https://axiom.trade/ and navigate to a token detail page showing Global Fees Paid and volume.
6. After approximately a second, an **Axiom Live Stats** tab appears in the background. Open it to view the dashboard.
7. The extension toolbar icon can also focus the dashboard. If you use two monitors, keep Axiom open and visible in another window for the most reliable updates.

## Collected stats

Global Fees Paid, Price, Liquidity, Supply, ATH, 5m Volume, Buys, Sells, Net Volume, Holders, and Axiom's displayed Bundlers and Top 10 Holders percentages. The compact **Liquidity history** section records Axiom-reported liquidity locally from monitoring start, including coins only seconds old; no API or credits are used.

See [LIQUIDITY_HISTORY.md](LIQUIDITY_HISTORY.md) for sampling/identity rules, baseline tolerance, coverage, separate retention limits, regression coverage and live Axiom checks.

## Test changes

After changing extension files, click **Reload** on `chrome://extensions`, then refresh the Axiom page and dashboard. Axiom is the only required host permission; loading optional historical candles requests GeckoTerminal access. The manifest injects the holder extractor, token detector, rolling chart store, cached live-value reader and liquidity recorder before `content.js`.

## Common issues

- Dashboard doesn't open: Check you're actually on a token page, not the homepage. Verify Global Fees Paid or 5m Vol appears on-screen. Reload the extension and refresh Axiom.
- Missing metric `—`: Some coins/chains use a different page layout, or Axiom changed its HTML structure. Edit the label map in `content.js`.
- Dashboard says “No recent updates”: Keep Axiom visible/active; the page may slow live updates when hidden.
- Multiple open Axiom tabs: This MVP displays the most recently reporting tab. A source-tab selector is a v2 feature.
- Error inspection: Check the page DevTools console and the service worker errors under `chrome://extensions`.

## Architecture

- `holderTableExtractor.js`: Extracts only the scoped Holders table, observes row mutations, and retains up to 1,000 full-address session observations.
- `holderConcentration.js`: Validates one current extraction, deduplicates full addresses, checks percentage totals and sort/leading-set evidence, and applies explicit supported pool exclusions without renormalizing supply.
- `tokenContextDetector.js`: Reads public token/pool DOM hints and recognized URL identity parameters; keeps untyped route addresses separate from mint and pool hints.
- `content.js`: Reads market DOM text and sends a roughly 3-second heartbeat. Holder-only changes reuse the last market reading without rescanning the document. Holder sessions use recognized route identity plus detected network/mint/pool context.
- `rollingChartCollector.js`: Small/subscript price parsing, independent clocks, one-second slots, bounded histories, null gaps, merges and exports.
- `liveValueObserver.js`: Cached cells and reused MutationObserver; successful unchanged reads renew DOM readability without changing the numeric-change time.
- `liquidityHistory.js`: Independent five-second attempts, displayed amount parsing, explicit identity/status, window baselines and coverage math.
- `liquidityDashboard.js`: Currency-isolated liquidity summaries and 30s/1m/5m/15m charts of actual attempts, with exact hover values.
- `background.js`: Existing dashboard/snapshot flow, independent delivery timestamps, bounded pending records and 15-second IndexedDB batches.
- `sampleArchive.js`: Native IndexedDB, token/metric/unit keys, indexed historical-window reads, deduplication and retention.
- `chartView.js`: Locally bundled chart, precise hover values, UTC axis, autoscaling and separate gap segments.
- `chartDashboard.js`: Metric/window selection, independent timing/status indicators, recorded-period reload, retention settings and JSONL/CSV exports.
- `dashboard.html`, `.css`, `.js`: Displays the latest snapshot.

## Scope and privacy

Read-only extension. Local market statistics, holders and liquidity/price observations come from Axiom's rendered DOM without external API calls. The existing optional historical-price view calls GeckoTerminal only on explicit request. Neither feature needs Axiom credentials, wallet access, network interception, screenshots or session tokens. Token identity uses a whitelist of chain/network/mint/pool query parameters; unrelated query parameters are not collected. Actual chart sampling attempts persist locally in IndexedDB with bounded age/count retention. No machine learning or automated trading is included.


## Top 10 Holders — Axiom-reported

The **Top 10 Holders — Axiom-reported** market card reads the percentage displayed above Axiom's exact **Top 10 H.** label in its Token Info tile, including the supplied icon/value/label layout. For example, `14.05%` is preserved as displayed and sent as `stats.top10Holders` through the existing snapshot flow. It is Axiom-reported holder concentration, not a percentage calculated from the extension's partial holder table. Valid `0%` is retained; missing, hidden, malformed or out-of-range values display `—`. Reads stay scoped to the matching tile, so nearby Bundlers percentages are not substituted. The browser fixture in `tests/fixtures/top-ten-holders.html` covers the supplied markup and regression checks cover value updates, zero, invalid/hidden states and dashboard clearing. Reload the extension and refresh Axiom/dashboard to enable the card, then compare it with the live Top 10 H. tile.

## Bundlers % (v0.2)

The Bundlers tile reads the percentage already displayed by Axiom under
Token Info. It is **Axiom's classification**, not independently detected
on-chain Jito bundles or an identification of individual bundled wallets.
If Axiom has not rendered this tile, the dashboard displays —.

## Holders Intelligence (Phase 1)

### Holder concentration and data sources

**Top 10 Holders — Axiom-reported** remains separate from calculations using the current table. The concentration panel shows source, actual extraction time, network/token context, active view, sort, identifiable and unresolved counts, duplicate rows, partial coverage and session-cache truncation. An explicit Remaining-descending sort and a complete valid leading set can support **Top 1/5/10 — Axiom table order**; otherwise results are **Largest 1/5/10 observed wallets — partial coverage**, or unavailable with a reason. The supplied captures expose no reliable sort direction, so **Sort order unknown** is expected for them.

Native SOL/ETH/BNB balance, displayed holding value and Axiom supply percentage are distinct fields. Current token quantity is collected only when explicitly exposed, never inferred from dollars or Bought/Sold history. Rows carry actual extraction time and context; republished snapshots do not renew them. Mixed-age/context or older-than-10-second extractions are unavailable. Session observations never fill current rankings. Percentage sums are approximate and retain Axiom's original, otherwise unspecified supply denominator.

Classifications default to unknown; names/icons alone do not prove pools, burns, lockers or contracts. Optional supported Axiom-reported pool exclusions validate the evidence contents and list the full addresses, evidence and reasons without changing the denominator. Hidden rows and contradictory full-address hints do not enter current identifiable-wallet calculations. Duplicate rank numbers cannot establish a Top 1 result, and holder data must match the dashboard's active token context. No classification or ranking is presented as independent on-chain verification. See [HOLDER_CONCENTRATION.md](HOLDER_CONCENTRATION.md) for the field audit, exact eligibility rules, classification sources, missing live HTML, independent API capability requirements and regression/manual checks.

### Holder table extraction

Open the **Holders** tab on the Axiom token page. The new dashboard section appears beneath the existing market cards. It reports Axiom's total holder count, the currently rendered rows, Axiom-flagged bundlers **among those rows only**, address-resolved session observations, and coverage status. The scrollable dashboard table shows the currently rendered rows, including nearby virtualized rows, rather than a full holder list.

The extractor is scoped to `[data-perf-id="token-table-holders"]`. It maps fields from the table's headers and supports the supplied Solana layout and BNB/ETH layouts with a Fees Paid column. Zero-width Follow Sell controls are excluded from data cells. Nested wrappers, explicit grid cells and positioned rows approximately 48px high (32–72px tolerated) are supported. Without headers, the original nine-column layout and the captured EVM layout with recognizable Bought/Sold/currency markers are supported; unexplained layouts remain unavailable. A table observer coalesces mutations over 180ms and only publishes changed values. The existing market polling locates replacement tables; observers and pending callbacks disconnect when the table or token changes. The holder extractor adds no automatic scrolling, wallet API calls, Helius integration, or permissions.

### Extracted fields

Each normalized row contains `rank`, `walletDisplay`, `walletAddress`, `identityStatus`, `nativeBalance`, `balanceCurrency`, `lastActive`, `boughtAmount`, `buyCount`, `soldAmount`, `sellCount`, `unrealizedPnl`, `feesPaid`, `feesPaidCurrency`, `remainingTokenValue`, `remainingPercentage`, `fundingSourceLabel`, `fundingTransactionUrl`, `holdingDuration`, and `axiomBundler`. The legacy `solBalance` field remains populated only for identified SOL balances. The dashboard labels the balance currency and shows Fees Paid when that column is present. Missing or ambiguous values remain `null` and appear as unavailable. Trade counts require an explicit field, a recognizable count label, or the captured Bought/Sold `token quantity / count` format; unrelated numbers are not guessed. Semantic/CSS zero-count subscripts are preserved and expanded as decimal strings for holder amounts and percentages. Funding URLs require an HTTPS transaction path. The exact `img[alt="Bundler"]` badge is the source of the Axiom flag; other badges are ignored.

Future fields `commonFundingSource`, `similarSolBalancePatterns`, `synchronizedBuys`, `sameBlockActivity`, `clusterId`, `evidenceScore`, and `clusterConfidence` remain `null`. A displayed funding label does not establish a common funding relationship. The dashboard does not calculate cluster scores or an overall Bundler percentage from rows.

### Identity, coverage and limits

- Full public addresses, when rendered in the wallet cell or its account/address link, are the only session cache keys. DOM nodes, ranks, display names and abbreviated addresses never identify a wallet. Resolved duplicates are merged by address; unresolved rows remain separate current observations and are not retained across scrolls.
- The session card counts **retained address-resolved wallets**, with current unresolved rows listed separately. An exact unique session total is unavailable when identity is unresolved. The cache retains at most 1,000 addresses and explicitly indicates truncation; after eviction, the retained count is not a lifetime unique count. At most 500 row candidates are processed per extraction.
- Coverage always remains partial. Matching the reported count does not prove complete coverage. The rendered bundler count is never presented as a total. The existing Bundlers market tile continues to show Axiom's own reported percentage.
- Session observations reset when the source token pathname or recognized chain/mint/pool query parameters change. Navigation to a new token with unchanged previous-token rows shows a waiting state until row content updates. Multiple tabs retain the existing most-recent-reporting-tab behavior.
- Hidden, empty, unloaded and unsupported tables produce explicit status messages. Changing the source token, closing a table or hiding it removes current rows from the dashboard; retained identified session observations stay available until the token changes.

### Automated checks

With Node.js and an installed Chrome/Chromium browser:

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:storage
```

If necessary, set `CHROME_PATH` to your Chromium browser executable. The browser runner creates and removes its own unique temporary profile and loads only local fixture files. These development tools are not part of the extension's runtime. The HTML test fixture can also be opened directly to inspect extractor tests; full dashboard tests need a local HTTP server or Chrome's file-access test flag, which the runner supplies.

The real-browser fixtures exercise the supplied row structure, every extracted field, exact badge matching, shortened-name collisions, DOM recycling, resolved deduplication, token resets, delayed SPA rows, scoped mutation handling, bounded caching, missing/hidden/empty/unsupported states, messaging, all existing market metrics, dashboard rendering, and inert handling of untrusted text/links. Background tests check source validation, atomic snapshot caching, dashboard reuse, worker restart, toolbar activation, and compatibility with market-only snapshots.

### Manual checks on Axiom

1. Reload the extension, refresh Axiom, open a token, and open **Holders**. Confirm all existing market cards still match Axiom, including its Bundlers percentage.
2. Compare several rendered holder rows with the dashboard: rank, wallet, balances, activity, trades/counts, PnL, remaining value/percentage, funding link and duration. Missing fields must remain unavailable.
3. Compare rows with `img[alt="Bundler"]` and other badges. Only the exact Bundler badge should produce the orange **Axiom flagged** indicator. The count must be labeled rendered-only.
4. Scroll Axiom manually. Confirm the dashboard shows newly rendered rows, does not scroll Axiom itself, and never merges equal display names or short addresses. Identified session observations should persist within the token.
5. Switch tokens. Confirm old rows and session identities clear, including during loading. Close/reopen the Holders tab to check unavailable/hidden states.
6. Leave the trading interface updating and check responsiveness. Holder-only mutations should not trigger a full market-span scan; identical holder data should not rebuild the dashboard table. Check page and service-worker consoles for errors.

### HTML inspection still needed

Regression fixtures include reduced user-provided SOL, BNB and ETH holder captures, including liquidity pools, Follow Sell controls, Fees Paid, abbreviated wallets and small subscript amounts. They validate these structures, not every current Axiom variant. New layouts, tooltip-only full addresses and token switches without pathname changes still need live inspection. Unsupported rows are skipped with an inspection message; ambiguous fields stay unavailable. Phase 1 cannot establish unique identities for shortened wallets, full coverage, independent bundling, or wallet clusters. After reloading the extension, compare balances, fees, Remaining, funding and held times on both SOL and EVM pages; coin age is not used to select a layout.

## Free Chart V2

The collector attempts a sample every **1,000 ms**, aligned to the next UTC second, retaining **900 one-second slots** per metric in a live **15-minute window**. Price and market cap are independent displayed values, never converted using supply. These are **DOM observations, not exchange ticks or one-second OHLCV**. No candle highs/lows or trade volume are synthesized.

### Values, freshness and timing

The parser supports currency prefixes/suffixes, scientific notation, K/M/B/T multipliers and subscript zero counts. For example, `$0.0₅123` decodes to `0.00000123 USD`, and `$0.0₁₂45` to `0.00000000000045 USD`. The reader recognizes Unicode, semantic `<sub>`, CSS subscripts and explicit full-value attributes/tooltips. Ambiguous formats and nonzero numeric underflow remain unavailable. Unspecified currency is not assumed USD.

The existing MutationObserver supplies relevant records. Sampling reads only cached Price/Market Cap cells, without scanning the entire document. Successful unchanged reads renew **DOM readability**, while numeric-change timing stays fixed. A readable DOM value cannot certify Axiom's upstream feed freshness.

| Field | Meaning | Unit |
| --- | --- | --- |
| `timestamp` | Aligned UTC-second slot | Unix seconds |
| `domReadAt` | Latest DOM read attempt | Unix milliseconds |
| `observedAt` | Latest successful read; compatibility alias | Unix milliseconds |
| `valueChangedAt` | Last observed numeric/unit change; initial acquisition starts it | Unix milliseconds |
| `domUpdatedAt` | Latest relevant content mutation seen by this reader | Unix milliseconds |
| `sampledAt` | Actual sampler execution | Unix milliseconds |
| `deliveredAt` | Worker receipt | Unix milliseconds |

`sourceAgeMs`, `samplingDelayMs` and `deliveryDelayMs` describe different delays. Connection status reflects recent extension delivery and DOM readability; upstream freshness remains unknown.

Unavailable values produce real null sampling attempts. Valid reads older than five seconds become stale/null. Missed timer/delivery slots have `gap: true`, `value: null`, `sampledAt: null` and source `unobserved-slot`. They are markers, not observations; later prices are never copied backwards. Chart lines break across stale/missing/nonadjacent points.

The self-scheduling timer realigns after each execution and visibility restore. Background throttling and browser suspension can still interrupt exact 1 Hz sampling. Delay, hidden-source state, separate read/change/sample/delivery times, usable counts and gaps remain visible.

### Chart and recorded periods

The locally bundled `lightweight-charts` 5.2.1 renderer provides an autoscaling price axis, UTC seconds and a hover crosshair. The invisible timeline uses a separate overlay scale, so its default formatting cannot override tiny-price labels on the right scale. Hover text shows the full stored JavaScript numeric value; axis labels use readable significant digits. Distinct line segments preserve gaps; heavily fragmented views use isolated points. The rendering library loads locally, with no CDN.

**Live observations** follow current time. **Recorded observations** accept an end time in UTC to inspect retained observations. The initial viewport fits available data instead of stretching a few points over 15 empty minutes. **1m / 5m / 15m** selects a viewing period; **Fit available** fits usable observations inside that period. Dragging or scrolling pauses tracking while collection continues; **Follow live** returns to the current period and resumes tracking. Revisiting a token with only older saved data automatically shows its last recorded period. Unknown periods remain empty, and saved records never establish a live connection.

The summary shows the latest usable observation with its timestamp, first-to-last observed percentage change within the selected period, and source connection status. This change covers available observations, which may not span the entire period. A zero initial value makes percentage change unavailable. Collection timestamps, source identity, delay and storage controls are inside **Collection diagnostics & local storage**. New samples also record `domReadDurationMs` and `collectorDurationMs`; compare these with sampling delay and `sourceHidden` to investigate visible versus hidden tab timing. These durations measure our read/sampling work, not other page work or upstream feed latency.

**Reload local history** reads IndexedDB only. DOM CSV/JSONL exports contain the full retained 15-minute window ending at the selected time, independent of chart zoom, including explicit gap markers, token identity hints, metric, unit, numeric/null values, source, freshness and independent timing fields. No OHLCV fields are added.

### Persistence and retention

Database `axiom-free-chart-v2` uses compound keys `[tokenKey, valueType, unit, timestamp]`. Tokens, metrics and units remain separate. Newer duplicates replace older samples; older duplicates cannot overwrite newer observations. Saved/live records merge without duplicate timestamps. Gap markers are reconstructed for display/export and are not stored as actual observations.

The source continues collecting with the dashboard closed. Worker persistence uses **15-second batches**, plus a best-effort navigation/page-hide flush. Abrupt browser/extension shutdown can lose pending batches. IndexedDB failure leaves the live chart running in bounded memory and reports a storage error.

Bounds: four live tokens, two metrics each, 900 slots each; 5,000 pending disk records; eight dashboard saved windows. Archive defaults: **24 hours and 25,000 global records**. Settings offer 15 minutes/24 hours/3 days/7 days and a maximum of 100,000 records. Age and count limits apply together; the count cap can shorten retention, especially with two metrics. Reads, writes and settings changes prune expired/excess records. Existing local rolling history migrates once without creating observations.

### Optional historical candles

**Historical price candles** is a separate opt-in view. The required host permission remains Axiom only; `https://api.geckoterminal.com/*` is an optional permission requested when **Load 1-minute candles** is clicked. No API requests run automatically. Declining access leaves local observation collection available.

Select a supported network and provide full token and pool addresses. Unambiguous DOM hints prefill these fields; unresolved values require input. The API verifies that the pool belongs to that network and contains the selected token, then requests USD price candles for its correct base/quote side. This UI never silently chooses a top pool or assumes the pool's base token. A manually selected pool may differ from Axiom's market. Token changes or form edits clear results and invalidate pending requests.

The separate candlestick chart offers 15m / 1h periods ending at the fetch minute, zoom/pan, reset and OHLCV CSV export. Missing minutes remain blank. Incomplete candles are marked in hover text and exports; elapsed intervals can still be revised by the provider. Results show fetch time, verified identity and USD currency. Refresh is manual, cached for one minute and paced at least 6.5 seconds between API calls; rate-limit/service-error cooldowns persist. A failed refresh keeps previous results explicitly labeled. Historical candles are never merged with DOM samples or converted into market-cap data.

On 2026-10-19, `node tests/chart-live-check.js` verified public API access against a real Solana pool and validated all 100 returned one-minute candles against the raw six-field OHLCV arrays. The [public API documentation](https://api.geckoterminal.com/docs/index.html) describes approximately 10 calls/minute. This source does not provide supported one-second history or guarantee an exact Axiom chart match.

### Automated tests and rebuild

Run from this folder with Node.js and an installed Chrome/Chromium browser:

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:storage
```

Other shells can use `npm`. Windows `npm.cmd` avoids PowerShell execution-policy issues. Set `CHROME_PATH` if browser detection fails. Runners use their own safely removed temporary profiles. The storage runner launches two separate Chrome processes sharing only its test profile.

Results on 2026-10-19: **28 unit/protocol tests, 27 browser scenarios and 14 native IndexedDB checks passed**. They cover tiny-price formatting, available-data fitting, paused navigation through live updates and rebuilds, unchanged reads vs changes, callback durations, aligned slots, simulated throttling/long pauses, 900-slot bounds, token/metric/unit isolation, existing market/holder behavior, native chart gaps, exports, UTC recorded selection, optional API permission denial, verified pool/candle metadata, request invalidation, retention and browser-process restart persistence.

The bundle is already included. To rebuild during development:

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd run vendor
```

See [TECHNICAL_FEEDBACK.md](TECHNICAL_FEEDBACK.md) for implementation decisions, modified files and test details.

### Manual Chrome/Axiom validation

1. Reload the extension and refresh Axiom/dashboard. Compare existing market cards, Bundlers and Holders with Axiom. Coverage remains partial and exact badge matching remains unchanged.
2. Hover a small displayed price, including subscript notation, and compare the exact decoded value. Select Market cap and verify independent values/units.
3. Keep Axiom visible for a minute. Samples should arrive approximately once per second. With an unchanged value, DOM-read/sample times should advance while value-change time stays fixed.
4. Pause source execution in DevTools or background it long enough to throttle. Resume and confirm measured delay, null gap slots and broken lines. Hide/remove a value cell to check null unavailable attempts while delivery continues.
5. Switch tokens, revisit, and switch metrics. Confirm isolated histories and no unchanged previous-token text reused during loading.
6. Observe for 16 minutes: the live window must contain at most 900 slots within the last 15 minutes. Inspect worker IndexedDB `axiom-free-chart-v2`: records should arrive in batches.
7. Wait at least 15 seconds, restart Chrome, reopen the same token and reload local history. Select a recorded UTC period. Never-observed periods must stay empty. Uninstalling/clearing extension data removes the archive.
8. Export CSV/JSONL and inspect UTC-second timestamps, precise numeric/null values, units, identity, timing and gap provenance. No fabricated OHLCV fields.
9. Save a lower retention/count limit and confirm pruning. Close/reopen the dashboard while keeping Axiom running to check continuous collection.
10. Inspect extension Network/console panels. No external market API/CDN calls, credentials, trading actions or collector errors should appear.

Automated fixtures are not a live authenticated Axiom test. Current header/value markup was not supplied; unsupported layouts remain unavailable pending inspection. Browser timers cannot capture every market tick or guarantee every wall-clock second. DOM collection remains read-only and never scrolls or interferes with Axiom's trading controls.
