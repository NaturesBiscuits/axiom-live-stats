# GeckoTerminal historical price and volume

The optional historical-candle integration now provides price and provider volume for an explicitly selected token and pool, including indexed periods before this extension started local recording. It remains separate from the DOM charts, liquidity alerts, holders, and Axiom-observed Trading Participation. It is read-only: no backend, wallet, trade execution, subscription, key, or new browser permission is added.

## Setup and use

1. Reload the extension in `chrome://extensions`, then refresh Axiom and the dashboard.
2. Open **Historical price & volume**. Reliable existing network, token and explicit pool hints prefill the selection. Complete missing fields; native SOL/ETH/BNB balance symbols do not establish the network, and an untyped route does not establish the token or pool.
3. If the pool is unknown, click **Find pools**, grant optional GeckoTerminal host access if prompted, and choose a candidate. Candidates show full network/pool identity and available USD liquidity. Explicit zero liquidity and unavailable liquidity are different. Only the first provider page is shown; it is not an exhaustive pool directory. No candidate is selected automatically, including the highest-liquidity result. A known full pool address or supported provider pool ID can also be entered directly.
4. Click **Load 1-minute candles**. The client independently verifies the selected network/pool and that the token belongs to the pair, then resolves the base/quote request side. Selecting a candidate does not establish that it matches Axiom's pool.
5. Select **15m** or **1h** for the viewing period. Both use one-minute candles. Zoom/pan price and volume together, hover either pane, or use **Reset view** to fit available candles. **Refresh from provider** explicitly bypasses the local candle TTL while respecting pacing/cooldowns; provider-side caching may still return the same data.
6. **Export OHLCV CSV** exports available candles in the selected period, including incomplete candles with explicit status and provenance. No missing candles are manufactured.

Missing or conflicting identity produces field-level guidance and does not block the rest of the analyzer. Editing network, token or pool, navigating to a new source token, or changing current identity hints clears the previous chart and invalidates outstanding permissions/requests. Delayed responses cannot populate another selection, even if transport cancellation is ignored.

## Source, verification and public access

The existing public client and optional `https://api.geckoterminal.com/*` host permission are reused. Permission is requested only from **Find pools**, **Load**, or **Refresh**. No request runs on a snapshot heartbeat, ordinary rendering, range changes, reset, hover, or page load.

The provider's [public OpenAPI definition](https://api.geckoterminal.com/docs/v2/swagger.json) and [interactive documentation](https://api.geckoterminal.com/docs/index.html) describe these endpoints on `https://api.geckoterminal.com/api/v2`:

- `GET /networks/{network}/tokens/{token_address}/pools?include=base_token,quote_token&page=1`
- `GET /networks/{network}/pools/{pool_address}?include=base_token,quote_token`
- `GET /networks/{network}/pools/{pool_address}/ohlcv/minute?aggregate=1&limit=100&currency=usd&token={base|quote}&include_empty_intervals=false`

Network-prefixed pool IDs/token relationships, separate valid addresses, selected-pool equality and selected-token membership are checked. EVM bytes32 pool IDs are supported as pool identifiers; they are never accepted as token addresses. Supported networks remain Solana, Ethereum, BNB Chain and Base. An unsupported or unindexed selection has an explicit error; there is no automatic alternate pool or paid-service fallback.

**Important metadata distinction:** the pool response's base/quote relationships establish the pair and selected token side. The OHLCV response orients `meta.base` to the requested token. When `token=quote`, its `meta.base` is the original pool quote token, and `meta.quote` is the other token. Nonempty candle responses must match that selected-token orientation. Missing or contradictory metadata is rejected. This behavior was checked with actual base- and quote-side public requests, rather than inferred from pool relationships alone.

Requests omit credentials/referrers, use the existing versioned Accept header, retain normal TLS verification, and time out after 15 seconds. The public definition currently documents approximately ten calls/minute and one-minute endpoint caching. Calls are queued at least 6.5 seconds apart; rate limits, Retry-After and bounded service/network cooldowns persist. No indefinite retries run. HTTP 401/403 explains denied public access; HTTP 404 explains unsupported/unindexed identity. Network failure, rate limiting, invalid JSON, malformed candles, contradictory identity and no indexed history have distinct messages.

## Price, volume, coverage and summaries

The genuine six-field provider array maps directly to `[timestamp, open, high, low, close, volume]`. Timestamps are UTC minute starts. Candlesticks reuse the existing small-price formatter. Provider **USD volume** appears in a separate histogram pane with its own price scale and shared horizontal navigation/crosshair. Volume colors follow candle direction; they do not represent measured buy/sell volume.

Finite nonnegative OHLC values must have consistent high/low bounds. Explicit zero price/volume is valid. A null volume preserves the valid price candle but produces no volume bar; its hover/export says unavailable. Invalid rows are omitted with a visible rejected-row count; all-invalid data is an error. Duplicate minute entries are deduplicated and sorted. Missing intervals stay blank: neither DOM prices, rolling five-minute volume, synthetic candles nor fabricated zeros fill them. A successful refresh uses only its current provider response, so a previously observed candle omitted by that response is not silently resurrected.

The display identifies provider, network, token, full pool, selected token side, USD price/volume currencies, one-minute interval, viewing period, fetch time, local-cache status and staleness. The selected period ends at the fetch minute and includes that minute; its expected slot count is 15 or 60. Available candle count, absent intervals, unavailable volume values and incomplete candle count are explicit. Missing minutes may mean no swaps or unavailable/unindexed history; absence is not evidence of zero activity or an exact pool creation time.

Summaries use only returned candles in the selected period: first available open, latest available close, highest high, lowest low, open-to-close percentage change, and sum of available provider volume. A zero/missing first open makes percentage change unavailable. No usable volume makes the volume sum unavailable; an available sum of zero remains zero. Partial coverage is shown beside these figures, and the chart fits the available history of a young or sparse pool.

An unfinished minute is marked **Incomplete** on the chart, in hover and exports. `finalized` is retained for compatibility and means only **interval ended at fetch time**, with provider revisions still possible. It is not on-chain finality or a guarantee that historical values cannot change. Cached incomplete observations remain labeled as of their fetch time until refreshed.

OHLCV contains no trade counts or unique wallets. These are unavailable from this source. Existing Trading Participation remains **Axiom-observed**, with independent timing, filters and partial coverage; it is not presented as all trades in the selected GeckoTerminal pool.

## Cache, failed refresh and export

The existing local `chartCache`/`chartApiBudget` storage is reused. Candle TTL is one minute, with at most four datasets and 500 normalized candles per dataset. The requested response limit stays 100 candles, enough for the 1h view when those minutes are indexed. Pool verification caches up to eight identities for ten minutes; pool discovery caches up to eight first-page lists for one minute in the client. Source/token/network/pool/currency/timeframe keys remain isolated. Persisted candle data is validated on restoration. These caches do not write to the DOM observation archives.

After a failed refresh, previous results remain only if network, token and pool still match. They are explicitly **stale**, including after range changes and in export. Data also becomes stale when the local one-minute TTL elapses. Automatic UI age updates make no API requests or navigation resets. Provider caching, indexing delays and historical revisions remain limitations even immediately after a successful response.

CSV/JSONL helpers preserve exact numeric OHLCV, Unix and ISO UTC timestamps, interval-ended/incomplete status, selected token side, original pool pair addresses, network/token/pool identity, quote/volume currencies, selected viewing period, source URL/provider, fetch time, stale state and volume availability. The existing `finalized` column remains, and incomplete candles are included explicitly by the UI export. Null volume exports as an empty value with `volumeAvailable=false`, distinct from numeric zero.

## Changed files and validation

- `chartDataCollector.js`: explicit candidate discovery, independent pool verification, selected-side metadata validation, missing-volume handling, summaries, force refresh, validated cache and enriched exports.
- `historicalChart.js`: candidate selection, field-level guidance, two-pane chart, summaries, source/coverage/status, manual refresh, stale matching results, cancellation and export.
- `tokenContextDetector.js`: explicit bytes32 pool hints remain separate from token addresses; untyped routes remain untyped.
- `dashboard.html`, `dashboard.css`: selection controls, accessible guidance, readable summaries, price/volume chart and source limitations.
- `tests/chart-data.test.js`: normalization, identity/side, pool discovery, pool IDs, summaries, volume, cache/pacing/cancellation, errors and exports.
- `tests/historical-browser-tests.html`, `tests/historical-browser-tests.js`, `tests/run-browser-tests.js`: isolated real-Chromium price/volume/selection/navigation/error regressions, alongside existing analyzer tests.
- `tests/chart-live-check.js`: opt-in public discovery, explicit pool verification, both selected-token sides and exact raw OHLCV comparisons.
- `README.md`, `HISTORICAL_MARKET_DATA.md`: setup, behavior, verification and remaining checks.

Run `npm.cmd test`, `npm.cmd run test:browser`, `npm.cmd run test:storage`, and `git diff --check`. Unit/browser API responses are mocked and are separate from actual provider validation. Browser fixtures exercise the real bundled chart library, including native wheel zoom, drag pan, shared crosshair, reset, partial volume, markers, stale export and delayed-response rejection. Existing DOM charts, holders, liquidity alerts, token info, trading participation and native archive restart checks remain included.

Run the actual public check separately with `node tests/chart-live-check.js` (network access required). Defaults explicitly select Ethereum WETH and pool `0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640`, then explicitly select the pool's other token to validate quote-side data. `GECKO_TEST_NETWORK`, `GECKO_TEST_POOL`, and `GECKO_TEST_MINT` can specify a different known identity together. These are public addresses, not secrets. A single successful provider check does not establish coverage for every token/network or guarantee future free access.

Validation completed on **2026-11-02 (Asia/Manila)**:

| Check | Result |
| --- | --- |
| `npm.cmd test` | 116 unit/worker tests passed, including 19 collector tests |
| `npm.cmd run test:browser` | 69 scenarios passed: 51 analyzer/DOM/liquidity, 10 trading compatibility, 8 historical UI scenarios |
| `npm.cmd run test:storage` | 40 native IndexedDB checks passed across separate write/restart browser processes |
| JavaScript syntax and `git diff --check` | Passed |
| Actual `node tests/chart-live-check.js` | Public discovery, pool verification, base OHLCV and quote OHLCV all HTTP 200, without authentication |

The final live run found **19** verified first-page WETH pool candidates, validated **100 WETH/base candles and 100 USDC/quote candles** against the exact raw six-field arrays, and reported no rejected rows for the initial selected-token dataset. Its WETH fetch time was `2026-11-01T18:24:29.688Z` (`2026-11-02 02:24:29.688` in Manila). No provider credentials, wallet access, proxy service, paid endpoint or TLS bypass was used. Live quote-side testing first exposed the metadata orientation difference described above; implementation and mocked responses were corrected before the final passing live/browser checks. Mocked checks are not counted as live provider validation.

## Remaining manual checks

Reload in Chrome and test on authenticated Axiom pages across the supported networks. Compare explicit network/token/pool hints with Axiom, choose multiple provider candidates, and verify that their pool prices can differ from Axiom. Check unknown pool/token layouts, denied/revoked permissions, rapid token/network/pool changes, a young/sparse pool and a temporarily unavailable provider. Verify narrow layouts, keyboard selection, both crosshair panes, exported timestamps/currencies, refresh/reset and existing analyzer features. Live provider validation does not substitute for these Axiom/extension permission-flow checks. No commits or pushes are part of this implementation.
