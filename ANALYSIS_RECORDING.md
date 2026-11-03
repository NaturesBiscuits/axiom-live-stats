# Manual recordings for LLM analysis

Use **Record for AI analysis** near the top of the dashboard:

1. Keep the desired Axiom token page open and wait for recent observations.
2. Leave **All analyzer summaries** selected, choose a 5/15/30-second log interval, and click **Start recording**.
3. Click **Stop & produce report**, then **Copy report** and paste into your LLM.

There is no required file download. The completed report also appears in a read-only text box. If clipboard access fails, the entire report is selected for Ctrl+C/Cmd+C. Source text stays inert, including token names containing HTML. Nothing is sent to an AI service or any new external API.

The dashboard shows a live **Elapsed recording time** in `HH:MM:SS`, followed by the fixed **Recorded duration** after Stop. UTC start/end timestamps and the same readable duration are included at the top of the copyable report, alongside the exact `durationMs`. The duration remains fixed when a completed report is reopened; gaps are still part of the elapsed session interval.

The latest recording is retained locally. Copy it before **Start new recording**, which replaces the prior recording atomically. A failed Start leaves the previous recording available. Closing and reopening the dashboard preserves the recording/report; keep the Axiom source tab open while recording.

## Included data

The default records summaries rather than every wallet row or trade:

- **Market:** raw Axiom Price, Market Cap, Supply, liquidity, fees, ATH, 5m volume, buys/sells/net volume, holder count, Bundlers and reported Top 10 percentages, with market observation time.
- **Supply & Valuation:** every explicitly typed/unspecified supply field, raw and exact normalized decimal values, currency, definitions, source labels, original field timestamps, verification/approximation status, and supported calculated estimates with references to their recorded inputs. Market Cap remains independently Axiom-reported. Zero remains distinct from null. Incompatible source fields cannot support a calculation.
- **Token Info:** Axiom-reported tiles, CA/developer identity and funding context, including their source/status/time. These remain unverified source observations.
- **Holders:** current rendered count, rendered Bundlers, unresolved identities, retained session identity count and concentration results with partial-coverage/sort/denominator explanations. Pool exclusions are disabled for this report so its methodology does not depend on a dashboard checkbox.
- **Liquidity:** available currency-isolated liquidity summaries, actual attempts/endpoints, 30s/1m/5m/15m changes when supported, current alert rule/states and the latest five matching alerts. Alert evidence retains its original time and **Cause unverified** status; retained/included counts disclose the five-alert bound.
- **Trading:** rolling 60-second observation-time summaries for each available currency, including buy/sell counts, unique/repeat/both-side addresses, volume/shares, unresolved counts, filter coverage and data-loss/storage notes. No currency conversion is performed.

**Supply & Valuation only** is an optional smaller scope. Individual wallet lists, raw trade events, all one-second chart samples and optional historical provider candles/valuations are omitted. Recording does not trigger historical lookups. Existing historical/chart/trade exports remain independent.

Some rolling liquidity/trading summaries can include earlier observations from before Start. Successive 60-second trading windows overlap and must not be summed to obtain a session trade count. Missing coverage is explicit; a zero count without coverage does not prove no trading occurred. No network, supply definition, circulation, on-chain verification or safety conclusion is invented.

## Timing and report format

The plain-text report uses **axiom-analysis-log-v2**, a compact, lossless format intended for LLM reading. It starts with session metadata and interpretation notes, followed by **SAMPLE CLOCK**, **BASELINE**, and **FIELD TIMELINES**, and ends with **END OF RECORDING**. Metadata includes token/network/pool context, source tab, scope, UTC start/end, starting/ending price, exact duration, stop reason, entry count, first/last observation times and any recording storage error.

The baseline contains the first sample's full analyzer data, including definitions, sources and quality labels. Unchanged fields appear only there. Each field timeline names its full JSON Pointer path(s) and supplies either values aligned with all sample rows, or indexed changes carried forward from that path's baseline. Paths with identical timelines share one list of values. This avoids repeating field names, explanations and identical data in every snapshot. There is no rounding, downsampling, truncation or numerical summarization. Each report includes its reading rules; it does not require an external dictionary or decompression tool.

SAMPLE CLOCK rows are `[sequence, loggedMs, observedMs, gapBeforeMs]`. The offsets are exact milliseconds from metadata `startedAt`; they can be negative for an observation before Start. `elapsedMs` equals `loggedMs`, and the duplicated numeric/ISO start-of-row times are recoverable by addition and ISO formatting. Field timelines that match a sample-clock column reference it directly. Other time fields may use `time: "msFromStart"` with exact offsets, while baseline field times retain their original Unix-millisecond values. No times are rebased to the target interval.

JSON Pointer paths escape literal `/` as `~1` and `~` as `~0`, and use zero-based array indexes. Timeline markers `["absent"]`, `["object"]` and `["array"]` preserve absent paths, object/array shape changes and empty containers; actual source arrays are traversed, so these markers cannot collide with source strings or arrays. Explicit null, zero, empty text, decimal strings, missing fields and every original source timestamp remain distinct. All samples remain represented even when no analyzer values change.

Formatting is separate from storage: the full original entries remain in IndexedDB, and previously saved recordings are reformatted when reopened. The clipboard and text box contain the same compact report. A representative 60-sample regression fixture reduced raw entry JSON from 418,028 to about 20,000 characters (roughly 95%); savings depend on repetition and are smaller for very short or highly variable recordings. Round-trip tests reconstruct the original entries independently from the text and compare every field, including structural transitions and missing/zero distinctions.

Each stored entry has a sequence number, `loggedAt` / `loggedAtUTC`, `observedAt` / `observedAtUTC`, elapsed milliseconds and the included summaries; the compact report preserves or exactly reconstructs these fields as described above. Stored numeric timestamps are Unix milliseconds. `loggedAt` is when the worker logs the received snapshot. `observedAt` is the source's actual market DOM read, while supply, Token Info, holder, liquidity, trade and alert evidence retain their own times. These are observation times, not independently established market or blockchain event occurrence times.

The first entry may be a baseline observed up to ten seconds before Start. A snapshot republish cannot advance its original observation time. Subsequent entries require a newer, sufficiently recent market observation and the selected interval since the last logged entry. The recorder does not interpolate, replay missed intervals or reuse stale market snapshots as fresh records. A delayed next entry records the real time; `gapBeforeMs` flags intervals exceeding twice the requested cadence. The report start/end interval can include gaps, and its last observation can precede Stop.

The report warns the receiving LLM that token labels and other source text are untrusted data, not instructions. Exact supply quantities and calculated products remain decimal strings throughout recording, persistence, copy and restore; other analyzer modules retain their existing raw/numeric precision and quality labels. The report displays its character count so a long recording can be assessed against the chosen LLM's input limit; longer intervals produce fewer entries.

## Source isolation and persistence

Start is accepted only from the extension dashboard and requires a recent source observation with a consistent source context. The worker pins the recording to its original Axiom tab plus source/network/token/pool context. Updates from other tabs cannot change the recording. A context change from the pinned tab automatically stops it before adding the new token's values. Matching trading/liquidity rows and alert states are also filtered to the pinned tab, including when another tab shows the same pool. Public addresses are retained only where they form part of the selected summary/identity evidence.

The worker collects independently of the dashboard. A separate IndexedDB database, `axiom-analysis-recording-v1`, holds one session and its ordered entries. Each append commits its metadata and entry together. Starting another recording replaces both stores in one transaction. This does not modify existing chart, liquidity, trading or alert archives, calculated chart histories, Chrome host permissions or API behavior.

Bounds are one hour, 720 entries, or approximately 4 MiB of serialized UTF-16 entry text, whichever is reached first. Size/count limits stop recording rather than silently dropping earlier entries. The entry-size bound can stop a dense all-summary recording before an hour. Silent-source expiry is finalized when the dashboard checks status or a new source message arrives; no later observations enter an expired recording.

An interrupted extension worker/browser session is restored as stopped at the last persisted log time with `worker-restarted-recording-interrupted`. It never pretends to have recorded continuously through a restart. Closing the source tab also stops recording. On a write failure, capture stops and the report remains copyable from the running worker's memory with a storage error. Copy it before closing/restarting; unpersisted entries may otherwise be lost. A subsequent Stop retries the full in-memory recording atomically. Failed initial reads never authorize overwriting an unread saved report.

## Files and validation

Added `analysisRecorder.js`, `analysisRecordingArchive.js`, `analysisRecordingDashboard.js`, `tests/analysis-recorder.test.js`, `tests/recording-browser-tests.html`, `tests/recording-browser-tests.js`, `tests/recording-storage-tests.js` and this document. Updated `background.js`, `dashboard.html`, `dashboard.css`, `dashboard.js`, `package.json`, `README.md`, `tests/background.test.js`, `tests/browser-tests.js`, `tests/run-browser-tests.js`, `tests/storage-tests.html` and `tests/storage-tests.js`. Preexisting uncommitted supply/historical changes are preserved.

Validation commands are `npm.cmd test`, `npm.cmd run test:browser` and `npm.cmd run test:storage`. The compact-report change passed 150 unit tests, 85 browser scenarios and 47 native IndexedDB write/restart checks. Recording coverage includes lossless text round trips for both scopes, size reduction, changing array/object shapes, escaped keys, missing/null/zero distinctions, fresh/stale/missing inputs, zero/large exact quantities, cadence/gaps, single-source isolation, all-summary aggregation, overlapping trading-window labels, Start/Stop sequencing, worker interruption, bounded storage/replacement, failed reads/writes, clipboard/manual-copy behavior and inert source text. Existing analyzer regressions remain in these runs.

No authenticated live Axiom session was available for manual verification. After reloading the extension and refreshing Axiom/dashboard, compare a short recording with its source page, switch tokens while recording to check automatic Stop, reopen the dashboard, and paste the copied report into the LLM you intend to use. Browser tab throttling and upstream Axiom freshness remain outside the recorder's control.
