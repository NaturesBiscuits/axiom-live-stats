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

Global Fees Paid, Price, Liquidity, Supply, ATH, 5m Volume, Buys, Sells, Net Volume, Holders, and Axiom's displayed Bundlers percentage.

## Test changes

After changing extension files, click **Reload** on `chrome://extensions`, then refresh the Axiom page and dashboard. Version 0.6 uses only the Axiom host permission. The manifest injects the holder extractor, token detector, rolling chart store and cached live-value reader before `content.js`.

## Common issues

- Dashboard doesn't open: Check you're actually on a token page, not the homepage. Verify Global Fees Paid or 5m Vol appears on-screen. Reload the extension and refresh Axiom.
- Missing metric `—`: Some coins/chains use a different page layout, or Axiom changed its HTML structure. Edit the label map in `content.js`.
- Dashboard says “No recent updates”: Keep Axiom visible/active; the page may slow live updates when hidden.
- Multiple open Axiom tabs: This MVP displays the most recently reporting tab. A source-tab selector is a v2 feature.
- Error inspection: Check the page DevTools console and the service worker errors under `chrome://extensions`.

## Architecture

- `holderTableExtractor.js`: Extracts only the scoped Holders table, observes row mutations, and retains up to 1,000 full-address session observations.
- `tokenContextDetector.js`: Reads public token/pool DOM hints and recognized URL identity parameters; keeps untyped route addresses separate from mint and pool hints.
- `content.js`: Reads market DOM text and sends a roughly 3-second heartbeat. Holder-only changes reuse the last market reading without rescanning the document. Holder sessions use pathname plus recognized identity query parameters.
- `rollingChartCollector.js`: Small/subscript price parsing, independent clocks, one-second slots, bounded histories, null gaps, merges and exports.
- `liveValueObserver.js`: Cached cells and reused MutationObserver; successful unchanged reads renew DOM readability without changing the numeric-change time.
- `background.js`: Existing dashboard/snapshot flow, independent delivery timestamps, bounded pending records and 15-second IndexedDB batches.
- `sampleArchive.js`: Native IndexedDB, token/metric/unit keys, indexed historical-window reads, deduplication and retention.
- `chartView.js`: Locally bundled chart, precise hover values, UTC axis, autoscaling and separate gap segments.
- `chartDashboard.js`: Metric/window selection, independent timing/status indicators, recorded-period reload, retention settings and JSONL/CSV exports.
- `dashboard.html`, `.css`, `.js`: Displays the latest snapshot.

## Scope and privacy

Read-only extension. Market statistics, holders and chart values come from Axiom's rendered DOM. The active version makes no external market API requests and needs no Axiom credentials, wallet access, network interception, screenshots or session tokens. Token identity uses a whitelist of chain/network/mint/pool query parameters; unrelated query parameters are not collected. Actual chart sampling attempts persist locally in IndexedDB with bounded age/count retention. No machine learning or automated trading is included.


## Bundlers % (v0.2)

The Bundlers tile reads the percentage already displayed by Axiom under
Token Info. It is **Axiom's classification**, not independently detected
on-chain Jito bundles or an identification of individual bundled wallets.
If Axiom has not rendered this tile, the dashboard displays —.

## Holders Intelligence (Phase 1)

Open the **Holders** tab on the Axiom token page. The new dashboard section appears beneath the existing market cards. It reports Axiom's total holder count, the currently rendered rows, Axiom-flagged bundlers **among those rows only**, address-resolved session observations, and coverage status. The scrollable dashboard table shows the currently rendered rows, including nearby virtualized rows, rather than a full holder list.

The extractor is scoped to `[data-perf-id="token-table-holders"]`. It follows the supplied nine-column layout and positioned rows approximately 48px high (32–72px tolerated), with support for nested wrappers and explicit grid cells. A table observer coalesces mutations over 180ms and only publishes changed values. The existing market polling locates replacement tables; observers and pending callbacks disconnect when the table or token changes. The holder extractor adds no automatic scrolling, wallet API calls, Helius integration, or permissions.

### Extracted fields

Each normalized row contains `rank`, `walletDisplay`, `walletAddress`, `identityStatus`, `solBalance`, `lastActive`, `boughtAmount`, `buyCount`, `soldAmount`, `sellCount`, `unrealizedPnl`, `remainingTokenValue`, `remainingPercentage`, `fundingSourceLabel`, `fundingTransactionUrl`, `holdingDuration`, and `axiomBundler`. Missing or ambiguous values remain `null` and appear as unavailable. Trade counts require an explicit field or a recognizable count label; unlabeled numbers are not guessed. Funding URLs require an HTTPS transaction path. The exact `img[alt="Bundler"]` badge is the source of the Axiom flag; other badges are ignored.

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

The task supplied a selector and example extractor, not a complete live Axiom table capture. Automated fixtures validate that described structure; they do not establish compatibility with all current Axiom variants. Actual markup is still needed to confirm secondary count/last-active nodes, tooltip-only full addresses, column changes, chains, and any token switches without pathname changes. Unsupported rows are skipped with an inspection message; ambiguous fields stay unavailable. Phase 1 cannot establish unique identities for shortened wallets, full coverage, independent bundling, or wallet clusters.

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

The locally bundled `lightweight-charts` 5.2.1 renderer provides an autoscaling price axis, UTC seconds and a hover crosshair. Hover text shows the full stored JavaScript numeric value; axis labels use readable significant digits rather than two-decimal price rounding. Distinct line segments preserve gaps; heavily fragmented views use isolated points. There is no CDN or chart-provider API.

**Live 15-minute window** follows current time. **Recorded 15-minute window** accepts an end time in UTC to inspect retained observations. Revisiting a token with only older saved data automatically shows its last recorded period. Manual recorded selection stays in place while live collection continues. Unknown periods remain empty, and saved records never establish a live connection.

**Reload local history** reads IndexedDB only. CSV/JSONL exports contain the selected 15-minute view, including explicit gap markers, token identity hints, metric, unit, numeric/null values, source, freshness and independent timing fields. No OHLCV fields are added.

### Persistence and retention

Database `axiom-free-chart-v2` uses compound keys `[tokenKey, valueType, unit, timestamp]`. Tokens, metrics and units remain separate. Newer duplicates replace older samples; older duplicates cannot overwrite newer observations. Saved/live records merge without duplicate timestamps. Gap markers are reconstructed for display/export and are not stored as actual observations.

The source continues collecting with the dashboard closed. Worker persistence uses **15-second batches**, plus a best-effort navigation/page-hide flush. Abrupt browser/extension shutdown can lose pending batches. IndexedDB failure leaves the live chart running in bounded memory and reports a storage error.

Bounds: four live tokens, two metrics each, 900 slots each; 5,000 pending disk records; eight dashboard saved windows. Archive defaults: **24 hours and 25,000 global records**. Settings offer 15 minutes/24 hours/3 days/7 days and a maximum of 100,000 records. Age and count limits apply together; the count cap can shorten retention, especially with two metrics. Reads, writes and settings changes prune expired/excess records. Existing local rolling history migrates once without creating observations.

### Optional free API investigation

Backfill remains **disabled**. The active extension has only the Axiom host permission and works entirely from recorded local observations.

On 2026-10-14, the documented GeckoTerminal public endpoint was verified without credentials. Its [public OpenAPI specification](https://api.geckoterminal.com/docs/v2/swagger.json) describes approximately 10 calls/minute, one-minute caching and minute/hour/day OHLCV. An opt-in real-pool test returned 100 one-minute candles, validating `[timestamp, open, high, low, close, volume]` and incomplete-candle identification. This does not provide supported one-second history or an exact Axiom chart match.

`chartDataCollector.js`, `tests/chart-data.test.js` and `tests/chart-live-check.js` remain inactive investigation/reference code. The manifest, worker and dashboard do not import the API collector. Future backfill must remain optional/free and label genuine API candles separately from DOM observations.

### Automated tests and rebuild

Run from this folder with Node.js and an installed Chrome/Chromium browser:

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:storage
```

Other shells can use `npm`. Windows `npm.cmd` avoids PowerShell execution-policy issues. Set `CHROME_PATH` if browser detection fails. Runners use their own safely removed temporary profiles. The storage runner launches two separate Chrome processes sharing only its test profile.

Results on 2026-10-14: **17 unit/protocol tests, 17 browser scenarios and 14 native IndexedDB checks passed**. They cover small prices, unchanged reads vs changes, aligned slots, simulated throttling/long pauses, 900-slot bounds, token/metric/unit isolation, existing market/holder behavior, native chart gaps, exports, UTC recorded selection, deduplication, retention and browser-process restart persistence.

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
