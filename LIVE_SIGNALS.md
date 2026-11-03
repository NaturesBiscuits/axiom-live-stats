# Live Signals — first paper-evaluation release

Live Signals is a deterministic, read-only monitor. It runs from existing incoming DOM observations without AI, a backend, API calls, wallet connections or order execution. There are no predictive probabilities or measured performance claims. Use **Paper** tracking first.

No `AGENTS.md` or `PROJECT_CONTEXT.md` was present in the checked project/parent locations. Work remains on the existing `feature/live-ai-monitor` branch. No branch change, commit or push was performed.

## Use paper mode first

1. Reload the unpacked extension, then refresh Axiom and the dashboard. Live Signals appears above the manual AI recorder.
2. Keep the intended token page available. The dashboard follows its existing most-recent-reporting source-tab selection. Keep one source tab active while evaluating. Price, liquidity and observed trading normally need at least 60 seconds of fresh coverage.
3. Expand **Entry conditions, risk unknowns and strength factors**. Missing required inputs explain why no entry can trigger. Check the displayed source tab, currency and source age before acting on a signal.
4. Leave **Momentum Breakout / Starter** selected initially. Settings are explicit engineering heuristics, not an optimized or proven profitable strategy. All parameters can be edited in the profile form; there is no automatic strategy selection.
5. Expand **Manual / paper position**, keep **Paper**, and enter an entry price, matching currency, local entry time and optional token size. Review stop, target, trailing percentage and confirmation count before logging. Blank entry price/time are never inferred. Entry time must be within the last 24 hours and not in the future.
6. Watch Holding, exit-warning and sell-trigger states. **Mark position closed** stops tracking; it does not assert a sale, exit execution price or realized PnL.
7. Copy **evaluation JSONL** regularly. It includes retained signals, user position-log/close events, subsequent evaluated observations, position plans, and a separate outcome-inspection section. The manual AI recorder remains independent and unchanged.

**Manually reported real position** is a separate label for user-reported tracking. It has exactly the same read-only behavior; no wallet or execution is verified. Only one open position per token/source/currency context is allowed, with at most 16 tracked contexts. Existing positions keep their strategy version and complete settings snapshot when the profile changes.

## Shared live state and identity

The worker adapts existing price packets and `recordingExtras` calculations. It does not install another content collector. Price history for this engine is a short, tab-isolated buffer of the already collected samples, rather than a new sampling mechanism. Trading uses the existing `AxiomTrading.analyze` 60-second **observation-time** window, holder summaries use the existing concentration calculation with pool exclusions disabled, and liquidity windows and warnings reuse the current liquidity modules.

The shared snapshot includes price/range data, raw current market stats, trading counts/volume/participation/shares, liquidity windows and original warning evidence, holder/developer observations, context, missing reasons and original timestamps. It is available in the engine view and retained evaluation records. Existing liquidity warning history is not recalculated or overwritten. The signal adapter includes all unresolved existing liquidity episodes, in addition to the latest five history records normally included in a manual recording.

Scopes include source tab, source key, blockchain, mint, pool and price currency. Same-token tabs remain independent. Currency changes, source changes and return visits cannot bridge pending confirmation or a preceding price window. Old requests cannot modify a position for another selected source. Unknown network/pool metadata stays unknown within its existing page/source identity; no identity is guessed. Historical API candles never enter this DOM strategy or its price buffer.

`observedAt` / `priceObservedAt` is a DOM read time. `sampledAt`, worker delivery time and `evaluatedAt` remain distinct. Underlying trade/blockchain occurrence time is unknown (`sourceEventTime`/`eventTime` null); the original trading module's approximate timing is not relabeled exact. Source-to-evaluation and sample-to-delivery delays are recorded. The observation timestamp associated with a condition can precede evaluation; it is not an execution timestamp.

## Direction-strength formula

Every factor has an observed value, window, signed direction, weight, contribution and unavailable reason. Signed factors are bounded to [-1,1].

| Factor | Weight | Signed value and neutral behavior |
| --- | ---: | --- |
| Price momentum | 40 | Current/preceding baseline change divided by 2 percentage points, clamped; absolute movement below 0.1% is neutral. Window defaults to 60s. |
| Observed volume pressure | 35 | `2 * (buyVolume / (buyVolume + sellVolume) - 0.5)`; shares within 0.05 of 0.5 are neutral. Existing 60s window, one currency. |
| Observed count pressure | 15 | `(buys - sells)/(buys + sells)`; absolute imbalance at most 0.1 is neutral. 60s. |
| Liquidity change | 10 | Existing 60s percentage change divided by 5 percentage points, clamped; absolute change below 0.5% is neutral. |

`bullish = 50 + 50 * sum(available weighted signed contributions) / sum(available weights)`; bearish is `100 - bullish`. Two-sided neutral observations give 50/50. These are technical-condition scores, never probabilities of profit, forecasts or rug-pull probabilities.

Price momentum and volume pressure are required to display any score. Missing optional factors are omitted from the denominator and reduce displayed weight coverage; they never become zeros. Missing required factors produce **Insufficient data**. Available-input weight coverage is distinct from price sampling coverage and the always-partial Axiom trade/holder coverage.

Usable trading requires a fresh source reading, a full elapsed 60s observation window, valid positive same-currency directional volume, finite counts, no reported loss interval/storage error, no missing or other-currency volume, no unknown directions, and some newly observed events. Initial synchronization rows alone are insufficient. Explicitly restricted filters block it. Unknown filter settings remain disclosed; the DOM feed is never claimed exhaustive. Successive overlapping summaries are never summed.

## Momentum Breakout v1.0.0

The registry has one operational strategy with stable ID `momentum-breakout`, version, description, required/optional inputs, parameter schema, an entry-assessment callback and documented invalidation/exit definitions. The engine, persistence and UI are shared for future additions; there are no operational-looking placeholders.

The preceding range excludes the current/candidate read. A baseline must be within ±2.5 seconds of the requested window start, the actual span must cover the window, and occupied one-second slots must meet the coverage threshold. No missed price slots are invented. The first qualifying candidate freezes its preceding high and supporting range timestamps for confirmation. Subsequent confirming prices compare against that original high, rather than moving the reference upward with the candidate itself.

| Starter parameter | Default |
| --- | --- |
| Preceding price window | 60,000ms; configurable 30,000–300,000ms |
| Evaluation interval | 5,000ms, driven by incoming distinct price observations |
| Maximum source age / confirmation gap | 10,000ms / 7,500ms |
| Minimum price/liquidity coverage | 0.8 |
| Breakout above preceding high | More than 0.2% |
| Entry confirmation | 3 consecutive eligible evaluations |
| Reference invalidation/rearm | At or below 0.2% beneath original high, confirmed twice |
| Supporting observed buy share / trades | At least 0.60 directional volume share / 5 observed events in 60s |
| Optional participation | At least 3 observed unique buy/sell wallets when available |
| Optional observed largest-wallet volume share | At most 60% when resolvable; unknown unresolved-volume denominator stays unavailable |
| Liquidity requirement | Fresh same-currency value, supported 60s change of at least -5%, adequate coverage and available existing warning rules |
| Risk thresholds | Axiom-reported Top 10 and largest-ten observed holdings above 50%; developer holdings above 10%; observed largest-wallet volume above 60%; existing confirmed liquidity drop |
| Position exit defaults | 5% stop, 10% target, 5% trail, 2 confirmations; zero disables an individual price threshold |

Required conditions are fresh price, preceding breakout, supporting buying, liquidity and available liquidity-warning rules. Missing optional participation/concentration is visible and does not block otherwise supported analysis. Available adverse optional evidence does block entry. Holder/developer data is never silently treated as safe when missing.

Direction strength cannot cancel a risk veto. Axiom-reported Top 10 and current-table largest-ten holdings retain separate labels, evidence and original denominators. Partial observed holdings are not presented as a complete holder ranking. LP Burned, funding labels and developer names do not establish contract safety. Mint/freeze permissions, ownership, locks and contract behavior remain explicitly unverified checks.

The state sequence is warming-up → watching → setup-forming → buy-trigger, with a separate data-delayed view. A latched entry emits once, then requires confirmed price invalidation before rearming. If current conditions fail after a trigger, the historical trigger stays recorded while the current view returns to Watching with the reason; it does not keep claiming current entry conditions are met.

Only newer eligible DOM-read timestamps advance confirmation. Duplicates, status requests, dashboard renders, restored records and delayed/out-of-order observations cannot manufacture confirmations. Fresh unchanged source readings can count. Gaps reset entry, recovery and exit confirmation. Stale or missing evidence preserves active risk warnings and labels recovery unconfirmed. Holder/developer/volume warnings recover after two fresh below-threshold evaluations; liquidity recovery is taken directly from the existing engine's confirmed recovery evidence.

## Position exits

Position rules use the captured plan, including its original risk thresholds and strategy version, independently of later profile edits. No position means no position PnL or position-specific sell trigger. Gross estimated PnL uses `(observedPrice - enteredPrice) * enteredTokenSize` and `(observedPrice / enteredPrice - 1) * 100`; fees and slippage are excluded and this is not an executable quote. No size means no quote-currency position PnL estimate.

The high-water reference starts at the explicitly entered price and is raised only by fresh observations received after the position is logged and at/after its reported entry time. Earlier recorded highs are not used; retrospective entry does not pretend the engine observed its entire intervening high-water history.

Priority when exits overlap: **active risk → stop loss → trailing stop → take profit → strategy invalidation**. All met conditions remain listed. The highest-priority reason must meet the captured exit-confirmation count; before that the state is exit-warning. Changing reasons resets confirmation. Strategy invalidation is a price below the captured entry breakout high, when one exists, or momentum at/below -1% with buy share below 45%. Missing invalidation inputs do not qualify. A confirmed sell-trigger stays latched until the user marks tracking closed, and never executes an order. Missing/stale risk evidence cannot clear a prior position warning or advance confirmation from that missing evidence.

## Persistence, alerts and evaluation

Monitoring continues without the dashboard while source observations and the browser are available. No immortal service-worker timer is assumed. Native `axiom-live-signals-v1` IndexedDB uses atomic metadata/journal transactions and incremental journal writes, following the existing recording archive pattern. It is separate from manually started AI recordings and existing chart/liquidity/trade archives. Every evaluated sample is recorded at the configured evaluation cadence, not every one-second input tick.

Retention is 24 hours and at most 500 events, 2,000 evaluated observations, approximately 4MiB of serialized journal text, and 16 runtime source/currency contexts. The first reached bound applies, so retained duration is not guaranteed. User position plans remain until replaced/closed within the 16-position bound; logging and closing events preserve previous plans in bounded history. Exports disclose retention and may lack an outcome endpoint. Storage errors are visible; in-memory monitoring continues but unsaved changes can be lost. Failed initial reads cannot authorize overwriting unread data.

Restarts restore settings, positions, original evidence, suppression records and observation watermarks; they clear pending confirmation and live price buffers. Historical events are marked outdated, source freshness is not restored, and a fresh preceding price window is required again. Confirmed entry latches and active risks survive without replaying notifications or claiming recovery.

Alerts appear in the dashboard first. Notifications default off. Checking **Enable Chrome notifications** requests only the optional `notifications` permission from that user action; it does not request a host, wallet or backend permission. Newly generated buy/sell and risk-warning events may notify, with a shared one-per-minute ceiling, a 15-second event-age ceiling and persisted per-event duplicate suppression. Suppression is saved before attempted delivery. Restored/outdated events do not notify; notification API/permission errors are visible. Opting out stops notification delivery; Chrome's existing granted permission is not revoked automatically. OS notification presentation still requires manual verification.

Each generated event retains strategy ID/version and settings, token/source/currency, original supporting values/times, frozen breakout range, passed/failed/unavailable conditions, warnings/unknown checks, signal price and observation age, trigger/evaluation times, recovery details, coverage and latency. Paper/manual tracking actions are labeled separately from market triggers.

Outcome inspection is a separate function applied after generation. It looks for supported observations at 30/60/300 seconds **after actual evaluation time**, within 7.5 seconds of each horizon, in the same full context/currency. Missing endpoints stay unavailable. Values are gross observed price changes from the signal's observed price, not fills, net returns, win rates or predictive accuracy. Neither later prices nor those outcomes affect earlier signals. Chronological replay tests compare a prefix run with the same prefix of a longer run.

## Validation and remaining manual checks

Automated checks use deterministic fixtures, a simulated Chrome worker, real browser DOM controls and separate real Chromium processes for native IndexedDB restart tests. These are not authenticated live Axiom trading validation.

Commands: `npm.cmd test`, `npm.cmd run test:browser`, `npm.cmd run test:storage`.

Completed validation: **167 unit/worker tests**, **93 browser scenarios**, and **52 native IndexedDB write/restart checks** passed. The worker integration test drives existing one-second price samples, five-second liquidity attempts and deduplicated observed trades through the actual worker adapters to a confirmed entry, with manual recording off. Browser tests cover explicit paper entry, frozen plans, source/tab isolation, missing-data display and notification opt-in; notification permission/delivery calls are stubbed in those UI tests. Native persistence runs use separate Chrome processes. Live Axiom and OS notification delivery remain manual checks.

Before relying on the display, manually compare one active Axiom token with the Live Signals source/currency, let both 60-second windows warm, inspect every failed/unavailable condition and check for throttling. Log a paper position with explicit inputs and verify stop/target/trailing settings, then edit the global profile and confirm the old plan stays fixed. Switch tokens/tabs/currencies and verify old positions are not shown as current. Close/reopen the dashboard, restart the extension and confirm interrupted/warming status with retained evidence. Test optional notifications with OS permission enabled, duplicate suppression, permission denial/revocation and the one-minute ceiling. Export paper evaluations before retention removes observations. No profitability, accuracy, win-rate or rug-probability validation has been performed.

Changed implementation: `liveSignals.js`, `liveSignalArchive.js`, `liveSignalService.js`, `liveSignalsDashboard.js`, notification icon, `background.js`, dashboard HTML/CSS/JS and `manifest.json`. Tests: `tests/live-signals.test.js`, browser/storage signal fixtures, worker integration regressions, suite runners and `package.json`. Existing collectors, strategy-independent calculations and the compact manual AI report remain in place.
