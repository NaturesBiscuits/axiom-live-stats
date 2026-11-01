# Supply & Valuation

This section works from Axiom's rendered DOM without an API. It explains the source, meaning and quality of each figure without treating Axiom's labels as independent blockchain verification. Existing Price and Supply cards are preserved; the Market Cap card displays Axiom's reported value. The new section retains the original text alongside normalized values and shows unrelated valid figures even when a supply definition is unresolved.

## Fields and definitions

| Snapshot field | Exact supported Axiom labels | Meaning |
| --- | --- | --- |
| `price` | Price | Displayed token price, including its displayed currency when recognized. |
| `marketCap` | Market Cap, MarketCap, Mkt Cap | Axiom-reported Market Cap; its denominator is not established by the label. |
| `displayedSupply` | Supply | Axiom-displayed supply, type unspecified. |
| `circulatingSupply` | Circulating Supply | Axiom explicitly identifies this quantity as circulating; circulation methodology remains unverified. |
| `totalSupply` | Total Supply | Axiom explicitly identifies total supply; it does not establish circulating or maximum supply. |
| `maximumSupply` | Maximum Supply, Max Supply | Axiom explicitly identifies a maximum; issuance rules remain unverified. |
| `reportedFDV` | FDV, Fully Diluted Valuation | Axiom-reported FDV; the label alone does not identify a diluted quantity. |

Each `snapshot.supplyValuation.fields` record carries `source`, `sourceField`, `rawText`, `normalizedValue`, `currency`, `unit`, `supplyType`, `definition`, `observedAt`, `fetchedAt`, `context`, `normalization`, `verificationStatus`, `approximationStatus`, `abbreviated` and `status`. DOM `fetchedAt` is null. Context includes the existing source key, network, token and pool hints; conflicting identity remains unresolved. Multiple candidate labels retain their individual raw observations. Conflicting candidates make only that field unavailable.

Valid zero is the string `"0"`; missing/invalid normalized values are null. Missing, malformed, hidden, conflicting, identity-conflict and awaiting-token statuses remain distinguishable. Explicit Unlimited, Uncapped, infinity or No maximum supply text is retained as `unbounded`; it does not establish a finite cap or prove issuance rules on-chain. A missing maximum never becomes total or circulating supply.

Only the matching visible tile is read, excluding table/trade rows and nearby unrelated labels. Values use the displayed text, including supported subscript zero notation; a tooltip is not substituted for the original display. Whitespace is normalized and semantic/CSS subscripts are preserved as Unicode in `rawText`. Unsupported layouts remain unavailable rather than borrowing a neighboring value.

## Supported calculations

| Figure | Required supply basis |
| --- | --- |
| Circulating market cap | Explicitly labeled circulating supply |
| Total-supply valuation | Explicitly labeled total supply |
| FDV — explicit maximum-supply basis | Explicitly labeled finite maximum supply |
| Valuation using Axiom-displayed supply | Generic Supply, with its unknown definition disclosed; checkbox disabled initially |

All calculations multiply an observed price by the corresponding quantity and display **Calculated estimate**. FDV here documents maximum supply as its basis; a reported FDV, generic Supply or Total Supply cannot supply that missing denominator. Other possible diluted bases are not implemented. No pool, treasury, locker, holder or burn-address balances are subtracted to invent circulating supply. There is no assumption that total, circulating and maximum supply are equal.

Both inputs must have compatible source, supported network, full token identity and pool context, with no identity conflict. Each observation must be at most 10 seconds old, no more than one second in the future, and within five seconds of the other input. Unresolved currency blocks a calculation; a bare number is never assigned USD. Recognized explicit symbols/codes include the Axiom `$`/USD display convention, EUR, GBP and the listed native/stablecoin codes in the parser. A SOL-denominated price produces a SOL valuation even when a separately reported Market Cap is in USD. No foreign-exchange conversion or combination with provider/global quantities is performed.

Each calculation retains copies of its price and supply inputs, including their original sources, raw values, identities and times. Missing-input reasons are shown for each result. Source-field details expose both timestamps; the dashboard age timer cannot refresh them. Successful unchanged DOM reads establish current DOM readability, not the age or correctness of Axiom's upstream data. A token/network/pool switch blocks unchanged reused cells independently until each cell changes or its node is replaced; rapid successive switches preserve this guard. This conservative rule may leave a legitimately unchanged supply unavailable until its tile is refreshed.

## Precision and quality

Normalized quantities and calculated values are decimal **strings** across extension messaging/storage. Parsing K/M/B/T, scientific notation and thousands separators does not pass through floating point. BigInt coefficients are used only inside exact multiplication and are never serialized. Large raw integer strings retain all digits; unsafe integer Number quantities are rejected because their original precision is already lost. Inputs and exponents have bounded lengths to avoid unbounded arithmetic.

Displayed token quantities are already token units: token decimals are never reapplied to them. The explicit `fromBaseUnits(integerString, decimals)` helper divides a raw integer exactly once, requires decimals in 0–255, and marks the normalization. Passing a normalized record back as raw units is rejected. No RPC reader is connected in this implementation.

Abbreviated/approximate display inputs retain that quality. Even exact multiplication of displayed decimals remains an economic estimate: unabridged displayed numbers do not certify upstream precision, independently verified circulation, correct issuance rules, or an executable price. No blanket verified/safe badge is shown. Specifically verified RPC supply/decimals would still not independently establish circulating supply; none is claimed here.

## Optional existing provider enrichment

The DOM path makes no API requests. An explicit historical **Load 1-minute candles** or **Refresh from provider** action uses the existing optional GeckoTerminal host permission, request pacing, metadata/candle caches and failure handling. There is no new permission or automatic lookup. Merely opening this section or toggling the generic estimate does not request access.

When that existing pool response actually includes `data.attributes.market_cap_usd` or `data.attributes.fdv_usd`, their original names and raw values are retained in historical metadata `providerValuations`. Absent fields, provider nulls, malformed values and valid zero remain separate. The response establishes no typed circulating/total/maximum supply field, so none is advertised or synthesized.

These are **Provider-reported** values from **GeckoTerminal Public API**, with response/definition URLs and original metadata fetch time in provenance. The metadata's existing ten-minute cache does not inherit a new timestamp from a subsequent candle fetch; this section marks provider figures stale after 60 seconds. A failed lookup leaves previous matching values explicitly stale and does not block DOM calculations. Old persisted historical datasets without these fields leave enrichment unavailable until a successful explicit lookup.

Pool valuations remain attached to the pool base token. Selecting quote-token candles does not relabel them as quote-token valuations. The dashboard requires the active Axiom token/network to match that base token; otherwise it explains the mismatch. A provider lookup for another pool remains labeled with its actual pool identity. Provider market cap can have global/cross-chain scope and is never treated as this chain's circulating quantity or cap. Provider FDV remains a reported valuation with an unspecified diluted quantity; it is not a basis for our calculated FDV.

References: the [public GeckoTerminal response schema](https://api.geckoterminal.com/docs/v2/swagger.json) names these pool fields; [CoinGecko's pool response documentation](https://docs.coingecko.com/reference/pool-address) explains USD valuation fields and the potentially cross-network market-cap scope. Provider methodology/verification is not independent blockchain verification by this extension.

## Integration and changed files

- `supplyValuation.js`: field definitions, exact parsing/normalization, eligibility checks, calculations and provider-field attribution.
- `supplyExtractor.js`: visible cached label reads and per-field navigation guards, reusing existing observers/heartbeat.
- `supplyDashboard.js`: compact figures, opt-in generic estimate, missing-input reasons, age and expandable provenance.
- `content.js`, `manifest.json`: load the modules and carry supply evidence in the existing atomic snapshot; preserve existing Price/Supply and add raw reported Market Cap.
- `dashboard.html`, `dashboard.css`, `dashboard.js`: section, styling and snapshot rendering.
- `chartDataCollector.js`, `historicalChart.js`: retain actual pool valuation fields/time/identity and pass them to the section only through existing explicit historical requests.
- `package.json`, `tests/supply-valuation.test.js`, `tests/supply-browser-tests.html`, `tests/supply-browser-tests.js`, `tests/chart-data.test.js`, `tests/browser-tests.html`, `tests/browser-tests.js`, `tests/trading-browser-tests.html`, `tests/run-browser-tests.js`: unit, provider, DOM, dashboard and real content-flow coverage, plus fixture dependency loading.
- `README.md`, this document: feature behavior and validation instructions.

Preexisting uncommitted historical-market-data work was preserved, including edits in shared files. No calculated values are assigned to `stats.marketCap`, the live value reader, rolling chart packets, observed chart histories, provider candles or observation archives. The supply UI sends no runtime/storage messages. Latest supply evidence uses the existing snapshot storage rather than adding a calculated valuation history.

## Validation and remaining checks

Run `npm.cmd test`, `npm.cmd run test:browser` and `npm.cmd run test:storage`. The completed suites passed 129 unit tests, 78 browser scenarios (including nine supply-specific scenarios), and 40 native IndexedDB write/restart checks. Coverage includes unknown versus explicit supply types, K/M/B/T, large integers, decimals once, zero/missing, currency/network conflicts, input age/skew, rapid token switches, provider null/cache/failure handling, inert source text, and unrelated existing features. A real content-script fixture proves that reported Market Cap 999 stays 999 in chart packets while a separately calculated total-supply valuation is 300.

Browser provider responses are controlled fixtures, not a live API or wallet verification. No authenticated live Axiom page was available for this validation. After reloading the extension and refreshing both pages:

1. Compare Axiom's visible Price, Supply and Market Cap with raw/source details. Generic Supply must remain unspecified; unsupported typed supply must say unavailable.
2. If explicit typed supply exists, compare each separate calculation and denominator. Check the optional generic estimate and turn it off again. A missing maximum must not borrow total supply for FDV.
3. Switch tokens/networks during loading and confirm old figures cannot populate the new context. Leave Axiom inactive to check that stale inputs eventually make estimates unavailable.
4. Exercise the historical lookup only if desired, including declining permission and API errors. Confirm original provider names/time/pool identity and continued DOM availability.
5. Compare the observed price/market-cap charts before and after toggling the estimates. Their samples must remain independently observed.

Future Axiom markup variants, unsupported networks/currency notations, live performance and upstream data freshness still require inspection. There is no RPC verification, circulating-supply discovery, supply audit, FX conversion or cross-chain aggregation.
