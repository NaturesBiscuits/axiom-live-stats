# Liquidity Activity & Alerts

This read-only feature extends the existing five-second liquidity recorder. It uses Axiom's rendered Liquidity value, the existing source identity and stale-token guards, worker messages, and `axiom-liquidity-v1` IndexedDB archive. There is no additional collector, liquidity sample store, API, backend, wallet integration, dependency, or browser permission.

## Rule and starter defaults

The extension-wide editable starter rule is a **20% drop over 1 minute**, confirmed by **3 consecutive fresh eligible observations**. Minimum absolute drop is **disabled**. Recovery requires **2 consecutive fresh observations at a drop of 15% or less from the original trigger baseline**. These are engineering heuristics, not validated trading advice. The comparison window can be 30s, 1m, 5m or 15m.

Percentage and absolute drop conditions use unrounded numbers:

```
signedChangePercent = (current - baseline) / baseline * 100
absoluteDrop = baseline - current
qualifies = -signedChangePercent >= dropPercent
            && (minimumAbsoluteDrop is disabled || absoluteDrop >= minimumAbsoluteDrop)
```

Valid current zero can trigger a 100% drop; a zero baseline cannot support a percentage comparison. Missing, negative, malformed, nonfinite and stale values never become zero. Displayed abbreviated amounts retain Axiom's precision; the extension cannot recover digits Axiom did not render. Minimum absolute drop is in each observed currency with no conversion. Validation requires a supported window, a finite drop threshold greater than 0 and at most 100%, a recovery threshold at least 0 and below the drop threshold, positive optional absolute minimum, and integer confirmation counts from 1 to 20.

Recovery is anchored to the **baseline on the confirming trigger observation**, rather than a moving window. For example, a trigger from 100 to 80 remains active while liquidity stays at 80, even once the one-minute baseline has fallen to 80. Two new observations of at least 85 recover the default rule. Recovery does not require the optional absolute trigger filter. An active episode retains its original settings for recovery after a rule edit; the displayed new rule applies to future episodes. Every actual setting change resets pending trigger and recovery counts. Historical evidence is never rewritten to use a newer rule.

## Timing, identity and coverage

Baseline selection reuses `liquidityHistory.analyze`: select the nearest valid same-series observation within **±2,500ms inclusive** of `current.domReadAt - window`. Ties retain the earlier baseline. The recorded valid-observation span must cover the entire window. Forty seconds of recording cannot supply a one-minute result, even if a timing tolerance could otherwise match a sample. Missing baseline and zero baseline have separate explanations.

Only a distinct sampling attempt with a newer `sampledAt` can advance a counter. Worker delivery stamps do not make an old DOM read fresh. The endpoint must be a valid DOM observation no older than **12.5 seconds**. Duplicate messages, rendered updates, disk reads and restored checkpoints never advance confirmation or recovery. An unchanged value with a genuinely new sampling timestamp may count. Missing/invalid/stale attempts reset pending counters. Gaps over **7.5 seconds** also reset them; the next fresh eligible attempt starts a new sequence. Missing samples inside the comparison window reduce coverage without blocking otherwise valid endpoints.

Trigger evidence records actual baseline/current read and sampling times and actual interval; it does not pretend the interval is exactly the selected window. Interval coverage counts occupied valid five-second slots over that interval, divided by expected slots, and labels complete/incomplete coverage. Recovery and subsequent episode evidence use the original trigger baseline and the resulting longer actual interval. Retention and missing attempts can therefore reduce its coverage.

The recorder attaches a continuity ID to each uninterrupted page/context/currency run. Detected network, token or pool changes, page reloads, and currency transitions start new runs; returning to an earlier pool or currency does not bridge the intervening change. Existing chart history stays stored, and chart lines break between runs. Window summaries describe the latest run in the selected currency. Pre-feature records remain readable but cannot become a baseline for a new run.

Alert scopes include the recorder's token/source key, explicit network/token/pool hints, continuity ID, currency and reporting tab. Unknown DEX metadata is irrelevant to DOM analysis. An unresolved pool stays unresolved and uses the recorder's existing page-session token/source scope; no pool is guessed. A source or currency change ends live monitoring of the previous episode without claiming recovery. The historical entry retains its last confirmed alert state and explains the interruption. Source interruption also retains confirmed state with a delayed indication. Only the documented recovery sequence records recovery.

## Dashboard and evidence

The existing liquidity section now shows current value/currency, last successful read time, retained recorded duration, and available 30s/1m/5m/15m changes. The current alert uses these statuses:

- **Collecting history**: insufficient recorded duration, or confirmation is pending with its explicit observation count.
- **No configured drop threshold reached**: valid data did not meet the configured trigger conditions, or recovery just completed. This does not imply safety.
- **Liquidity drop detected**: the drop was confirmed and recovery has not been confirmed.
- **Data delayed/unavailable**: waiting, invalid/missing data, no usable baseline, zero baseline, stale endpoint or a restored record without a new live attempt. A previous confirmed alert remains explicitly visible.

Alert settings, history, and chart/technical diagnostics expand independently. The history retains network/token/pool context (including unresolved identity), Axiom-reported source, baseline/current amounts and currency, percentage/absolute change, read times, actual interval, coverage, original rule, trigger time and recovery time. Subsequent valid observations update the episode, rather than adding rows. All source strings render as inert text. **Cause unverified** remains visible. The existing Axiom-reported LP Burned tile is reused separately and never suppresses an alert or supplies a safety verdict.

Observed liquidity changes can reflect price changes, swaps, pool changes, migrations or other causes. This metric does not establish an actual withdrawal, a developer action, or an instruction to trade. A fresh DOM read verifies readability, not the freshness or accuracy of Axiom's upstream feed.

## Persistence and limits

Alert settings, bounded events and deduplication checkpoints share the existing liquidity archive's `meta` store under `activity-v1`; liquidity attempts stay solely in the existing `samples` store. Existing liquidity archive, price archive and other saved settings are preserved. Settings are extension-wide; history is retrieved for the current token/source key, retaining every episode's original scope and currency. Worker-only evaluation continues with the dashboard closed while the source page remains available.

- At most **200 episodes globally**, newest episode update first, and **7 days since the episode's last valid update**. Active episodes receive updates while fresh valid reads continue; interrupted episodes age out. Retention is storage expiry, not a recovery assertion.
- At most **64 context checkpoints**. Pending counts and live connectivity are never restored. Original sample timestamps and active episode references survive worker restarts.
- Existing liquidity limits remain **24 hours / 10,000 attempts**, with existing bounded memory and **15-second persistence batches**. Settings save immediately. Abrupt shutdown can lose a pending observation/event/checkpoint batch; this is a local best-effort recorder, not a durable notification service.
- Metadata failures have a separate visible alert-storage error, retain bounded in-memory state and retry with the existing batch schedule. They do not prevent liquidity/price sample persistence. Reloaded events are historical evidence, never proof of a current connection.
- If saved alert settings cannot be read, evaluation and settings writes wait for a successful retry; unknown saved rules are never overwritten with defaults. Liquidity recording continues independently. If only a checkpoint was lost, a stored observation still cannot count as a new attempt, and retained active episodes reconnect to their original evidence.
- Age pruning runs on activity reads/evaluation/export. Expired events disappear from returned history immediately and are removed from disk on the next state write. No extra worker wakeup permission is requested solely for idle cleanup.

## Implementation and verification

Feature files: `liquidityAlerts.js` (pure comparison/state logic), `liquidityAlertDashboard.js` (settings/status/evidence rendering), and this document. Existing `liquidityHistory.js`, `liquidityDashboard.js`, `background.js`, `dashboard.html`, `dashboard.css` and `dashboard.js` integrate continuity, evaluation, existing archive metadata, UI and LP Burned context. `package.json`, existing test entry points, `tests/background.test.js`, and three new liquidity-alert test files add regression coverage. `README.md` and `LIQUIDITY_HISTORY.md` link the behavior. Existing uncommitted feature work is preserved; no commits or pushes are part of this change.

The Chromium test harness waits for fixture navigation before evaluation, reads each launch's DevTools endpoint from stderr (avoiding Windows port-file locks/stale ports on restart), bounds socket startup, and closes only its own temporary browser process tree. Runner cleanup preserves the original test failure instead of masking it with a profile-removal error.

Changed files for this feature (other pre-existing working-tree changes are separate):

- `liquidityAlerts.js`, `liquidityHistory.js`, `background.js`: alert logic, recorder continuity, source validation, existing messaging and archive metadata.
- `liquidityAlertDashboard.js`, `liquidityDashboard.js`, `dashboard.html`, `dashboard.css`, `dashboard.js`: compact activity panel, editable rule, status, retained evidence and separate LP Burned context.
- `tests/liquidity-alerts.test.js`, `tests/background.test.js`, `package.json`: rule/state/worker and compatibility coverage in the unit entry point.
- `tests/liquidity-alert-browser-tests.js`, `tests/browser-tests.html`, `tests/browser-tests.js`: dashboard controls, evidence, stale state, safe text and late/same-pool-run delivery checks.
- `tests/liquidity-alert-storage-tests.js`, `tests/storage-tests.html`, `tests/storage-tests.js`: native metadata, two-process reload/deduplication/recovery and retention checks.
- `tests/chromium-harness.js`, `tests/run-browser-tests.js`, `tests/run-storage-tests.js`: reliable Windows Chromium navigation/startup and scoped cleanup with original errors preserved.
- `LIQUIDITY_ALERTS.md`, `LIQUIDITY_HISTORY.md`, `README.md`: rule semantics, compatibility, limitations, verification and manual checks.

Run `npm.cmd test`, `npm.cmd run test:browser`, `npm.cmd run test:storage`, and `git diff --check`. Unit/worker checks cover exact boundaries, absolute filtering, confirmation/recovery, unchanged reads/duplicates, zeros/malformed data, warm-up, missing baselines, incomplete coverage, stale interruptions, settings/context/currency changes, unresolved pools, restored state, deduplication, retention and independent storage failures. Browser fixtures verify the real settings/status/evidence DOM, inert identity text, historical connectivity, stale active state, LP Burned context, late responses, and existing features. Native IndexedDB checks use two browser processes to exercise original evidence/settings, restart deduplication/recovery, retention and preservation of liquidity observations.

Results on **2026-11-01**: **107 unit/worker tests, 61 browser scenarios (51 dashboard/extraction + 10 trading compatibility), and 40 native IndexedDB checks (17 write + 23 restart) passed**. JavaScript syntax checks and `git diff --check` passed. Initial browser attempts timed out; a subsequent run exposed a Windows DevTools port-file sharing race and cleanup masking. The harness fixes above were applied, then both complete browser/storage suites passed outside the restricted sandbox. No unrelated application defect remains identified by these checks.

Review addressed source-run connectivity isolation, replay after a lost checkpoint, active episodes after checkpoint eviction, interruption without false recovery, rule edits retaining original evidence, saved-rule read failures without overwrites, and independent sample/metadata failure handling. No commits or pushes were made. Live authenticated Axiom checks and opt-in external API smoke checks were not run; the local alert feature does not require that API.

## Manual Axiom checks

1. Reload the extension in `chrome://extensions`, then refresh Axiom and the dashboard. Open a young token, compare exact displayed liquidity/currency and timestamps, and wait through each selected window. New/unchanged fresh reads should advance time; short history must stay collecting.
2. In an isolated local fixture, exercise a sustained 20% drop for three reads, an internal missing sample, and recovery above 85% of the trigger baseline for two reads. Verify one episode, original evidence and explicit incomplete coverage. Do not alter a real market or trade to create a test condition.
3. Background/suspend the source, remove/hide the Liquidity cell, and resume. Check delayed status, retained confirmed state, reset pending counts and the absence of fabricated zeros or replayed samples. Upstream freshness remains unknown even after recovery.
4. Navigate between tokens, networks and pools on the same route; revisit earlier pools/currencies and check that a new run warms up. Verify stale previous-token cells never trigger. Unknown DEX/pool metadata should remain explicit without blocking otherwise eligible same-context observations.
5. Edit each setting, including invalid recovery/absolute values. Reload and verify persistence. Edit a rule during an active episode and check the original episode recovery rule and historical evidence.
6. Close the dashboard for a batch, reopen, and restart the worker/browser. Saved alerts must initially look historical/delayed; rereading them must not count. Compare existing price charts, holder analysis, token info, trading participation and liquidity recording.
7. Compare LP Burned with Axiom independently, including missing/zero/100% values. Confirm it never changes alert eligibility. Inspect narrow layouts, keyboard controls, expanded diagnostics and consoles. Live authenticated Axiom layouts and actual pool migrations require manual verification beyond these fixtures.
