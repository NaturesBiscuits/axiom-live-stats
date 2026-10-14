# Free Chart V2 — technical feedback

Implemented in the existing extension in three increments: parser/timing fixes, the local chart, then IndexedDB and recorded-window controls. Version is 0.6.0. No ZIP, separate project, backend, paid endpoint, credentials, or trading functionality was added.

## Fixing delayed and stale updates

The old reader treated unchanged polling as old data, conflating a quiet number with disconnection. The reader now reads only its cached Price/Market Cap cells before each sample. Successful reads advance `domReadAt`; the store advances `valueChangedAt` only for numeric/unit changes. Relevant content mutations independently advance `domUpdatedAt`. Invalid reads produce null attempts without resetting the last numeric-change time.

This measures DOM readability. A frozen Axiom upstream feed can still expose a readable number, so the dashboard explicitly leaves upstream freshness unknown. `sampledAt` records actual execution, `timestamp` its floored UTC-second slot, and the worker stamps `deliveredAt` upon receipt. Sampling and delivery delays remain independent. The timer realigns to the next second after each run and visibility restore. A late callback records the current observation only; missed slots remain null markers.

## Values and renderer

Subscript counts expand before numeric conversion, including multi-digit counts. The reader preserves semantic/CSS subscripts instead of flattening `$0.0<sub>5</sub>123` into the incorrect `$0.05123`. Explicit full numeric attributes/tooltips are preferred when supplied, preserving displayed currency. Invalid formats, contradictory units, overflow, and nonzero numeric underflow are rejected.

`lightweight-charts` is pinned to 5.2.1 with a lockfile and loaded from `vendor/` only. Native line series contain contiguous valid observations; gaps create distinct segments. More than 32 segments switches to isolated points, bounding renderer cost without interpolation across gaps. A whitespace-only timeline supplies the 900-slot axis and contains no observations. Normal updates append/update points, and periodic rebuilding removes expired internal data.

Autoscaling and UTC second labels improve readability. Hover values show the full stored number, expanding scientific notation where necessary; axis labels use readable significant digits. Price and market cap remain independent. DOM sampling provides no genuine OHLCV, so only lines/points are implemented. Apache-2.0 licensing and TradingView attribution are preserved; see the [official library documentation](https://tradingview.github.io/lightweight-charts/docs).

Numbers remain IEEE-754 JavaScript values, not arbitrary-precision decimals. The original decoded display text is retained as `displayText` for auditing.

## Persistence and bounds

Native extension-origin IndexedDB uses `[tokenKey, valueType, unit, timestamp]` keys plus timestamp/token-metric-time indexes. Metadata stores settings and migration state. Actual attempts, including honest null unavailable attempts, persist; absent sampling slots do not. Upserts favor newer `sampledAt`, and saved/live merging removes duplicate timestamps.

The worker caps pending records at 5,000 and flushes every 15 seconds. Removing a completed batch cannot delete a newer same-key replacement that arrived during the write. Storage failure leaves live collection working and exposes an error; pending overflow is counted. Best-effort navigation/page-hide flushing helps, but abrupt shutdown can lose uncommitted records.

Memory retains four tokens × two metrics × 900 slots; the dashboard caches eight recorded windows. Default archive bounds are 24 hours/25,000 global records, configurable up to seven days/100,000 records. Both limits apply: two metrics at 1 Hz exhaust 25,000 records in roughly 3.5 hours, so duration is a ceiling, not guaranteed coverage. Indexed reads return only the chosen 900-second period and one consistent unit. Reads/writes/settings prune expired or excess data. Old local rolling history migrates once; saved data never seeds live freshness.

Recorded selection is explicitly UTC and ignores stale asynchronous responses after selection changes. A current SOL quote cannot replace an older selected USD window. Gap markers are reconstructed for display/export and remain distinct from observed records. Never-observed periods stay empty. Collection does not depend on an open dashboard.

## Optional free history investigation

Backfill remains disabled. On 2026-10-14 at 07:16:43 UTC, an opt-in check validated 100 real one-minute candles from Solana pool `AnrCHvfJUzMtos8DGjpT2XKurVPPYAVLDturASNwXcd4`, mint `CQCDTp8rsFV3PhaPeYjcCW5LdGTxi6jFx7eC3UXnpump`. It confirmed `[timestamp, open, high, low, close, volume]`, zero rejected records, and one incomplete current candle. Pool and mint were distinct.

The [public OpenAPI specification](https://api.geckoterminal.com/docs/v2/swagger.json) currently documents approximately 10 calls/minute, one-minute caching, and minute/hour/day timeframes. The verified request required no credentials. This is a possible optional one-minute source, not one-second backfill or guaranteed Axiom equivalence. No provider dependency/host permission was added; runtime never imports the reference API collector.

## Validation

All checks passed on 2026-10-14:

| Suite | Passed | Evidence |
| --- | ---: | --- |
| Node unit/protocol | 17 | Parsing, independent clocks, repeated reads, delayed timers, bounds, identity/unit isolation, exports, worker validation/batching |
| Chrome DOM/dashboard | 17 | Real MutationObserver, no full-span scan during sampling, existing market/Bundlers/holders behavior, native chart gaps, precise archived values, UTC selection, independent units, exports |
| Native IndexedDB | 14 | Two separate actual Chrome processes; restart data/precision/settings, compound keys, older-duplicate protection, real attempts only, token/metric separation, historical-window reads, age/count eviction |
| Optional API investigation | 1 live check | 100 real one-minute candles, field order verified; runtime remains disabled |

Storage fixtures use local test-page origins with isolated temporary profiles; runtime uses the extension origin. Unit tests simulate throttling/long pauses; the DOM fixture runs in real wall-clock Chrome time and checks approximately 1,000 ms between visible-source samples. These validate behavior and bounds; a live Axiom background-throttling session and a 16-minute active run remain manual checks. Current authenticated Axiom markup was unavailable for an end-to-end live test.

```powershell
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:storage
```

[README.md](README.md) includes extension reload, manual Axiom validation, retention/export instructions, and local library rebuild commands.

## Modified files

Runtime updates: `rollingChartCollector.js`, `liveValueObserver.js`, `content.js`, `background.js`, `chartDashboard.js`, `dashboard.html`, `dashboard.css`, `manifest.json`.

New runtime modules: `chartView.js`, `sampleArchive.js`.

Dependency/build files: `package.json`, `package-lock.json`, `.gitignore`, `scripts/vendor-charts.js`, `vendor/lightweight-charts.standalone.production.js`, `vendor/lightweight-charts.LICENSE`, `vendor/fancy-canvas.LICENSE`, `vendor/NOTICE`.

Tests: `tests/rolling-chart.test.js`, `tests/background.test.js`, `tests/browser-tests.js`, `tests/run-browser-tests.js`, `tests/chart-view.test.js`, `tests/chromium-harness.js`, `tests/storage-tests.html`, `tests/storage-tests.js`, `tests/run-storage-tests.js`.

Documentation: `README.md`, `TECHNICAL_FEEDBACK.md`.

Existing `holderTableExtractor.js`, `tokenContextDetector.js`, and `dashboard.js` were preserved. Holder extraction stays scoped/read-only, and Bundlers reproduces Axiom's classification.
