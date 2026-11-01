# Trading Participation — Axiom DOM observations

This feature records the trade rows Axiom materializes in `[data-perf-id="token-trades-panel"]`. It requires no API, backend, wallet connection, additional host permission or payment. It never clicks source controls, opens traders, changes filters or scrolls Axiom. Existing uncommitted Token Info/developer, holder, liquidity and chart work is preserved. No `AGENTS.md` or `PROJECT_CONTEXT.md` was found in the project or checked parent locations. No commit or push was made.

## Capture and extraction

`tests/fixtures/trades.html` comes from the supplied HTML with fetching asset attributes (`src`, `srcset`, `poster`) and CSS image URLs removed. Public explorer links and identity metadata remain. Regression checks establish **19 outer trade rows**, **38 repeated transaction-key attributes including nested trader buttons**, and **17 distinct raw maker addresses**. The captured Total fields contain **14 buys, 5 sells and approximately 552.94 USD**. These are fixture assertions; production reads live text.

Outer `div[data-transaction-key]` rows are extracted once. Nested keyed buttons are never separate events. Known compact rows missing a reliable key are counted as unsupported identifiers and excluded from deduplicated metrics; no ID is derived from a name, timestamp, amount, rank or transaction signature.

The supplied DOM stores columns in a different order from their visual CSS order. Total extraction requires its visible `data-figure="total"` / **Total** header and the row's `--trades-tape-figure-floor-total` width marker, or an explicit matching `data-figure` field. Amount uses the corresponding **Amount** header/marker. Naive child indexes, CSS `order`, the MC/price field and row gradients never supply volume. Hidden/missing/ambiguous fields stay unavailable. A missing Total does not discard a supported maker, token amount or event identifier.

Direction comes only from exact `text-increase` / `text-decrease` semantic classes in the scoped Total field: buy / sell respectively. Both or neither produce unknown. Badge, avatar, header-icon, MC and gradient colors cannot classify direction. Supported historical direction evidence survives an incomplete reread, while contradictory observed direction markers make the event unknown permanently within retained history.

Amounts reuse the existing liquidity/rolling-chart parsers, including separators, suffixes, native/fiat units and Unicode/HTML/CSS subscript notation. Original display text is retained. An unqualified numeric Amount under the tested Amount header is a displayed token quantity. Explicit monetary units in that field are not relabeled as selected-token quantities. Missing/invalid totals, missing currency, and valid zero remain distinct. No value is calculated from MC, token amount, current price, wallet native balance or holdings.

## Event schema and identity

Each retained event includes:

| Field | Meaning |
| --- | --- |
| `source`, `tokenKey`, `context` | DOM provenance and isolated source context: network, mint, pool, route hint, identity status |
| `eventKey` | Complete opaque `data-transaction-key`, including every suffix |
| `makerAddress`, `makerCandidates`, `identityStatus` | Validated full public maker address, or unresolved/conflicting identity |
| `traderDisplay` | Display label, separate from address identity |
| `direction`, `directionMarkers`, `directionEvidence` | Buy/sell/unknown with scoped semantic evidence |
| `total`, `totals` | Latest raw displayed Total plus separately retained observations per explicit currency |
| `tokenAmount` | Displayed token quantity when the tested header/field and unit support it |
| `transactionUrl`, `transactionLinkStatus` | Validated HTTPS explorer transaction link, never an event identifier |
| `firstSeenAt`, `lastReadAt`, `appearance` | Actual observation clocks and synchronization/newly-observed classification |
| `rawAge`, `ageStatus`, `timing`, `estimatedTradeAt`, `timingStatus` | Latest relative age and the frozen first valid age estimate with uncertainty/provenance |
| `filters`, `hadRestrictedFilters`, `hadUnknownFilters` | Filter coverage when first seen and supported subsequent filter observations |

Address validation reuses the holder extractor's 32-byte Base58/EVM validators. EVM casing is canonicalized; Solana casing is preserved. Usernames, avatar labels, social handles and abbreviated addresses never identify wallets. Identical names can represent different addresses. Conflicting full maker attributes remain unresolved. Missing maker identity does **not** discard an event or its usable Total.

Deduplication is **source context + the complete opaque event key**. Different keys sharing one transaction URL remain distinct events. Suffix meanings are neither stripped nor invented. Repeated reads, changing ages, repeated nested attributes, identical DOM copies and recycled DOM nodes with unchanged keys do not increment counts. A recycled node with a genuinely new key can supply a new event.

Conflicting maker identities, direction evidence, same-currency totals, token quantities or transaction links are retained as conflicts rather than resolved by choosing the newest hint. A later supported read can enrich a previously missing field. Switching the displayed Total currency preserves separately observed totals per currency for the same event; it never adds a second trade or converts an old amount using current prices.

When network, mint and pool are all unambiguous valid DOM hints, the source key is stable across page/worker restarts for that same network/mint/pool. It is still not independently verified. Unknown pools/networks/mints and conflicting identities use explicit page-session/context-epoch isolation. Unresolved sessions are not silently joined after a page reload. Maker and transaction links inside the feed are excluded from the existing token-context detector; a route address is never assumed to be a mint or pool.

## Timing, synchronization and windows

Supported relative ages are numeric seconds/minutes/hours/days/weeks (`6s`, `1m`, `1.5m`, etc.). The first valid age observation creates:

- a point estimate: actual age-observation time minus the displayed age;
- uncertainty bounds: plus/minus one displayed unit of precision, with the latest bound clamped to the observation time;
- the original age, observation time, precision, approximate confidence and the explicit fact that Axiom's rounding rule is unavailable.

For example, a first read of `6s` estimates six seconds before that read, with conservative five-to-seven-second age bounds. This accommodates unknown floor/nearest/ceiling rounding. No exact blockchain timestamp is claimed. Months/years, ambiguous labels and malformed ages remain unsupported. The raw text is preserved and first-seen timing remains usable.

The estimate freezes at the **first valid age reading**, including if an initially missing age becomes readable later. Rereading `6s`, then `7s`, or redelivering a saved event does not move its event time forward. First-seen time also remains fixed; last-read time advances only on an actual DOM reread.

Initial panel reads, replacement/resume/filter synchronization and newly appearing events are distinguished. Already present rows are not represented as transactions that all occurred when the extension started. Supported ages locate them approximately in the past. Synchronization rows without ages can only participate in an explicitly labeled observation-time view.

The dashboard offers **1m, 5m and 15m** windows and these timing views:

- **Automatic:** approximate trade-time windows when retained events have supported ages; otherwise first-seen observation-time windows.
- **Approximate trade time:** only events with a supported frozen age estimate. Untimed recently observed events are reported as excluded; choose first-seen time to include them.
- **First seen time:** all events timed by their original local observation, clearly labeled as observation windows rather than occurrence-time windows.

An estimated event belongs to a window when its fixed point is after the window start and at or before now. Intervals crossing the start are counted separately as boundary-uncertain. These are approximate observed-feed windows, never complete market-wide 1m/5m/15m history. Recording duration is the elapsed known recording span, capped to retained 24 hours, and includes gaps/revisits. An earlier recording start does not establish uninterrupted observation. Current visibility, filter coverage, source-read time, timing quality and incomplete initial recordings are displayed separately.

## Metric definitions

Event counts and unique-address counts use all supported events in the selected timing window, independently of their usable currency/volume. Missing volume never blocks these counts.

| Metric | Definition |
| --- | --- |
| Observed buy/sell events | Deduplicated events with supported buy/sell direction |
| Distinct buyers/sellers | Resolved full addresses with at least one observed event on that side |
| Both sides | Resolved addresses with at least one buy and one sell in the window |
| Repeat buyers/sellers | Resolved addresses with at least two events on the same side |
| Events per address | Total events and separate buy/sell/unknown counts per resolved address |
| Buy/sell volume | Sum of valid displayed Total observations in the selected explicit currency on that side |
| Unidentified volume | Selected-currency volume whose maker is unresolved/conflicting |
| Unknown-direction volume | Selected-currency volume without supported direction, whether maker is identified or not |
| Largest 1/3/5 observed wallets | Sum of those resolved wallets' selected-currency observed volumes divided by the denominator below |

**Every wallet-volume share uses the same denominator:** all valid observed Total values in the selected currency/window, **including unidentified and unknown-direction volume**. Those two categories can overlap and must not be added as disjoint groups. Unidentified volume is displayed explicitly instead of disappearing from concentration calculations. The table displays each address's numerator and share; it shows at most 200 addresses, while metrics use the retained event set and explain table truncation.

A zero/no usable denominator makes shares unavailable. Fewer than N resolved addresses with usable volume makes the corresponding largest-N result unavailable. Valid displayed zero volume is retained. Events with another currency, unknown currency, missing/invalid/conflicting Total are counted in the missing-volume coverage for the selected unit. Currencies are never combined. Sums/shares are approximate because the DOM displays rounded values and parsing uses finite numeric observations.

Wallet counts do not establish independent people. Repeat activity and concentration do not prove wash trading, common ownership or coordinated behavior. These are observed trading-flow measures, separate from token holder concentration, developer holdings and independent transaction decoding.

## Filters, lifecycle and collection

The capture supports inactive **Mine**, **Tracked** and **Dev** toggle styling. Explicit `aria-pressed`, `aria-checked` and `data-filter-active` states are also supported when actually present. Contradictory states remain unknown. Column-filter popovers saying `data-state="closed"` do **not** establish that their filters are inactive; the supplied capture therefore has **unknown column-filter coverage**. A supported selected filter makes coverage restricted. Repeated reads under restricted/unknown filters are recorded, and the dashboard reports current controls plus filter coverage of selected events.

The source uses one coalesced (180ms) observer scoped to the current trade panel. Header support is determined once per bounded read; row extraction never scans the whole document. Existing market observation excludes trade/holder subtrees. Panel discovery uses the stable panel selector on initial discovery/replacement and existing market heartbeats; cached-panel reads avoid document scans. At most 500 materialized row candidates are examined per read. Offscreen virtualized overscan rows can be materialized DOM observations; this does not enumerate the full feed.

Hidden/missing panels produce explicit coverage states. Navigation/context changes block previous-source event keys, including age-only changes and reused rows, until genuinely new current-source keys appear. Partial identity loading may conservatively withhold unchanged rows. Replacement panels reconnect observation and deduplicate known keys. The existing back/forward-cache lifecycle disconnects/resumes the trade observer along with holders/charts. There is no fabricated backfill for missed rows, throttled timers, hidden periods or filter changes.

Packets use separate `AXIOM_TRADES_UPDATE` messages. Current trading context/status also travels with the existing market snapshot; events do not inflate the snapshot or refresh unrelated market observations. The worker validates source senders, merges event identities and broadcasts live deltas. Dashboard history reads are restricted to the extension dashboard and reject late responses after token switches.

Collection and storage work with the dashboard closed. Automatic dashboard opening now happens once per browser session; closing it leaves it closed while collection continues. The toolbar still explicitly opens/focuses it. No source control or trading behavior changes.

## Persistence, retention and limits

Trading uses its own IndexedDB database, **`axiom-trading-participation-v1`**, and compound event primary key. Existing price/liquidity archives are unchanged.

| Layer | Bound / retention |
| --- | --- |
| Source panel read | 500 outer candidates per read; unread-row truncation is reported |
| Source event dedup | 5,000 entries per active context; older entries can be reread, with worker/archive dedup still applying |
| Navigation guard | Up to 5,000 previous keys, prioritizing currently materialized rows |
| Worker live events | 20,000 globally / 24h from original first seen |
| Dashboard retained events | 20,000 for the selected source / 24h; cap loss is displayed |
| Pending writes | 5,000 latest event records; overflow records source-specific loss intervals |
| IndexedDB events | 50,000 globally / 24h from original first seen, oldest-first pruning |
| Context/loss metadata | 64 recent source contexts/loss entries, with conservative global overflow loss metadata |
| Writes | 15-second batches and best-effort page-hide flush; forced shutdown can lose a pending batch |

The archive merges rereads with persisted records before writing, preserving original first-seen/age estimates across worker/browser restarts. Counts are never incremented by a database upsert. Pruning occurs on writes and reads. The age bound is based on first observation rather than refreshed last-read time, so repeated rereads do not retain an event forever.

**Deduplication retention is bounded by retained records at each layer.** The authoritative archive's guarantee is up to 24h / 50,000 events; it has no unlimited tombstone ledger. Once an event is removed from all dedup layers, it can be observed again as a fresh local observation. Count/retention limits may shorten practical dedup retention. This limitation is explicit rather than claiming lifetime uniqueness.

Memory, pending-write and archive caps record source-specific time ranges that may intersect a selected window. Archive cap and pending-delivery loss survive persistence/restart; source metadata and loss overflow are bounded. Loss ranges cover both estimated and first-seen timing so either timing view can flag a potentially affected window. Aggregate ranges can conservatively flag gaps between individual losses. A later heartbeat does not erase an earlier archive-loss warning. Rendered-row caps and identifierless-row exclusions are also visible. Missing loss metadata is not proof of complete coverage. Storage failures remain visible and leave bounded live collection working independently of price/liquidity persistence.

## Validation and manual checks

Run `npm.cmd test`, `npm.cmd run test:browser`, `npm.cmd run test:storage`, JavaScript syntax checks and `git diff --check`. The browser runner includes the existing compatibility page and the new Trading Participation page. Native storage checks launch separate Chromium processes with one temporary profile to verify restart behavior. Tests use local files and a sanitized fixture; they do not require authenticated Axiom or external requests.

Validation on 2026-10-31: **87 unit/protocol tests, 56 browser scenarios (46 existing compatibility + 10 trading), 33 native IndexedDB/restart checks (15 write + 18 restart), 15 JavaScript syntax checks and `git diff --check` passed**. Failed checks remaining: none. Unrun: live authenticated Axiom/manual checks, alternate live feed layouts and independent chain/timestamp verification. No API integration was added. Chromium ran with permitted local execution outside the restricted sandbox.

After reloading the extension and refreshing Axiom/dashboard:

1. Compare several trade rows' **Total**, MC, Amount and buy/sell styling. Total must supply trading volume; changing column order must not swap fields.
2. Observe repeated names, repeated maker addresses, multiple events in one transaction and live age updates. Event counts should only grow for genuinely new retained keys; age updates must not change first-seen/estimated event times.
3. Start on an already populated feed. Check synchronization counts and incomplete recording duration. Older ages must not all appear at monitoring start in approximate-time mode.
4. Compare 1m/5m/15m and timing views. Unsupported ages should be visibly excluded in approximate mode and available in the explicitly labeled first-seen view. Inspect rounded-boundary uncertainty.
5. Toggle **Mine/Tracked/Dev** or column filters manually. Verify restricted/unknown coverage is labeled without the extension touching the controls. Check actual active-filter attributes against supported evidence.
6. Switch tokens/networks/pools rapidly, including while old rows remain visible. Prior keys must not become new-token trades. Hide/show or replace the panel; new rows should resume collection, and old keys should deduplicate.
7. Change Total currency manually if available. Counts must remain unchanged; select each explicitly observed currency to compare volumes. Missing totals/identities must leave other metrics available. Confirm the unidentified/unknown-direction categories can overlap.
8. Close the dashboard, leave Axiom observing, then reopen via the toolbar. Recorded events should load. Reload/restart the browser with fully identified network/mint/pool and check retained event identity/timing; unresolved contexts intentionally start isolated sessions.
9. Review storage/retention diagnostics, selected-window truncation messages, narrow layouts and the console. No source clicks, scrolling, trader-panel opening, new host requests or trading actions should occur. Existing holders, Token Info, liquidity and charts should continue working.

Specific additional markup needed: **active and cleared Mine/Tracked/Dev toggle HTML when no semantic state attribute exists; active/cleared Total, MC, Amount and Trader filter badges/values/tooltips; alternative Total/Amount headers and currencies/layouts; a documented relative-age rounding rule; exact event timestamps if Axiom exposes them; and full explicit network/mint/pool metadata for unresolved routes.** These gaps leave coverage/timing/identity qualified and do not block supported metrics. Complete market-wide history, independent people counts, wash-trading/common-owner claims, decoded trades or chain verification require evidence this DOM capture does not provide.

## Files changed for this feature

Added production modules: `tradingParticipation.js`, `tradeFeedExtractor.js`, `tradingArchive.js`, `tradingDashboard.js`, and this document.

Added regression resources: `tests/fixtures/trades.html`, `tests/trading-participation.test.js`, `tests/trading-browser-tests.html`, `tests/trading-browser-tests.js`, `tests/trading-storage-tests.js`.

Updated integration/docs: `background.js`, `content.js`, `tokenContextDetector.js`, `manifest.json`, `dashboard.html`, `dashboard.js`, `dashboard.css`, `package.json`, `README.md`.

Updated existing test harnesses: `tests/background.test.js`, `tests/browser-tests.html`, `tests/browser-tests.js`, `tests/run-browser-tests.js`, `tests/storage-tests.html`, `tests/storage-tests.js`. Previously uncommitted Token Info/developer modules, fixtures and documentation remain in the working tree.
