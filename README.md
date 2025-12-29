# Metadata Audit

## Overview
Metadata Audit is a static web application that helps Pendo teams validate subscription metadata. The Integration API flow and the SPA rebuild offer similar core functionality but should be treated as distinct apps for hosting and documentation, and anything associated with the SPA should live under `root/SPA/`. Users can provide a SubID, domain, and integration key to pull metadata directly from the Engage API. Page-level controllers are written in vanilla JavaScript and store in-progress state in `sessionStorage` between screens.

## Quick start
- **Hosted use**: The Integration API flow can run from any static host (e.g., GitHub Pages) because all requests go straight to the Engage API.
- **Local development**:
  1. Serve the project from the repo root:
     ```bash
     php -S localhost:8000
     ```
  2. Open `http://localhost:8000/index.html` for Integration API testing.
- **Auth inputs**: Provide an integration key with read access. Use any modern browser that supports the Fetch API.

## Single-page rebuild (SPA)
- **Entry point**: `SPA/html/SPA.html` boots the new single-page experience through `SPA/js/spa.js`.
- **Purpose**: Consolidates the multi-page workflow into one view so the rebuilt tool can manage state without leaning on `sessionStorage` or `localStorage` between screens.
- **Directory boundary**: The SPA is fully self-contained in `root/SPA/`—HTML, CSS, JS, and shared assets for the single-page build should stay under this folder so it can be hosted or packaged independently of the legacy pages.
- **How to try it**: When serving locally, visit `http://localhost:8000/SPA/html/SPA.html` to load the SPA shell and exercise the emerging flow while the legacy pages remain available in parallel.

### SPA shell and navigation
- `SPA/js/spa.js` initializes navigation by rendering the shared nav bar from `SPA/html/nav.html` and wiring up the page switcher buttons. Navigation state is reflected through `aria-pressed` toggles so screen readers understand which view is active.
- Page switcher buttons load in a locked state and only enable after either SubID shortcut (Select Apps or Audit All) is clicked, preventing navigation before any auth inputs exist.
- Each numbered tab (1–5) represents a view backed by its own HTML partial (`SPA/html/1.html`–`SPA/html/5.html`). When a tab is selected, the SPA fetches that partial with `cache: 'no-cache'`, injects it into the main container, and invokes a matching initializer module (`SPA/js/1.js`–`SPA/js/5.js`) if one exists.
- View 4 now ships with a Pendo-styled "Subscriptions" card and canvas placeholder to host the first Chart.js visualization when the charting logic is added.
- Each partial now uses a shared `page-view` wrapper with a unique ID so cached DOM for one view cannot collide with another when sections are swapped back into the container.
- Loaded sections are memoized in a `Map` so revisiting a tab reuses existing DOM and skips redundant network fetches or initializers. Status text in the header (`[data-page-status]`) reports loading or error messages when a section is swapped. Views can optionally export an `onShow` handler to refresh data each time they are opened; the app selection preview uses this to respect credential changes without forcing a full reload.
- When the app selection preview re-renders, it reapplies any saved checkbox choices before enabling controls so returning to the tab preserves selections while still reflecting updated credential fetches.
- `SPA/js/nav.js` handles fetching and rendering the top-level navigation chrome and marks the active SPA entry via `aria-current`. This keeps the SPA host page aligned with the rest of the site navigation while keeping markup separate from logic.
- `calculateMetadataTableValue()` in `SPA/js/3.js` now stamps every lookback span for each SubID/App ID + namespace row with the discovered metadata field names (sorted and comma-separated) **from the requested window bucket only**, falling back to a "Pending..." placeholder until the 7-, 30-, or 180-day bucket is available and swapping to "No Data" when a processed bucket has no fields. The helper accepts a direct target element so callers can update a single span without scanning the entire DOM, and per-window bucketing keeps the three table columns independent as metadata calls resolve.

### SPA behavior and extensibility
- The SPA defaults to the first view on load and short-circuits re-renders when the active tab is selected again, preventing duplicate initializer calls. Each initializer can export `initSection(element)` to hydrate only the content relevant to its partial.
- View 3 (`SPA/js/3.js`) hydrates all four metadata tables (Visitor, Account, Custom, and Salesforce) with the SubID, app name, and app ID rows already selected on view 2, falling back to a fresh app name lookup only when no cached selections are available. After the tables render, `SPA/API/metadata.js` builds the next metadata call plan with the same credentials used for app discovery, queues the 7/23/150-day requests for every SubID + App ID row on the page, and runs the full queue in window order (all 7-day calls, then 23-day, then 150-day) while exposing queue controls in the console. The raw 7- and 23-day buckets are merged into a derived 30-day view only after both source windows finish, and that 30-day rollup merges with the 150-day window (once complete) to offer a derived 180-day bucket so downstream queries align with round-number timeframes and keep the later table columns empty until their source data exists. Metadata table rendering now also logs unexpected failures and drops a single status row across all four tables so the view never stays blank when upstream lookups fail.
- Metadata table refreshes now target only the SubID/App ID rows tied to the aggregation that just completed, reducing redundant rerenders while keeping 7-day spans and other lookback totals synchronized.
- SPA logging favors concise `console.log` statements that echo the executing function name for SPA helpers so you can quickly trace which lifecycle call is running during SPA view loads.
- `processAggregation()` in `SPA/API/metadata.js` receives aggregation responses from the SPA metadata queue helpers, logs SubID/app/timeseries context, and records every visitor/account/custom/Salesforce field into the window bucket returned by `getWindowNamespaceBucket()` so 7/23/150-day counts persist independently inside the `windows` map. Derived 30-day and 180-day buckets are created in the same structure by merging the shorter windows (7 + 23) and the resulting 30-day view with the 150-day lookback, keeping the earliest `timeseriesStart` across merged buckets. Field name lists can be retrieved safely (without exposing value counts) via `getMetadataFields()` for each namespace, which now reads from the preferred window bucket (180-day by default) instead of app-level rollups.
- Deep Dive aggregation payloads select only the metadata visitor, account, custom, and Salesforce blocks from each event, trimming identifiers from the `select` stage and relying on the provided credentials to scope the request.
- Section fetch failures (for example, missing HTML partials or network issues) surface both console errors and user-facing status text without breaking the rest of the shell. This makes it safe to add or iterate on new sections while keeping the overall SPA resilient.
- To add a new SPA view, create `SPA/html/<id>.html` and `SPA/js/<id>.js`, then register the `<id>` button in `SPA/html/SPA.html` and extend the loader map in `SPA/js/spa.js`. Keep assets under `SPA/` so the rebuild can stay deployable alongside (or independent of) the legacy flow.
- The app selection preview's Continue control (`#app-selection-continue-btn`) now triggers the page switcher button for view 3 (`#page-switcher-btn-3`), letting users jump straight to the metadata tables after confirming at least one app selection.
- App selection snapshots (Sub ID, app name, app ID, and whether each row was selected) are cached in `SPA/js/2.js` when Continue is clicked so later SPA steps can reuse the chosen state without re-querying the table DOM.

## Local storage and cached state
- **SubID launch data (`subidLaunchData`)**: `initSubIdForm()` serializes each SubID + domain + integration key row before redirecting to app selection so users can refresh or navigate without losing entries. Empty rows are pruned on save to keep the cache small.
- **App selection responses (`appSelectionResponses`)**: `initAppSelection()` hydrates previously cached SubIDs, populates app lists, and persists the full integration responses so downstream pages can render without refetching. Seven-day metadata previews are merged into this cache when available to keep Deep Dive defaults aligned.
- **Manual app names (`manualAppNames`)**: The app name modal on `metadata_fields.html` writes overrides through `appNames.js`, updating both in-memory caches and previously saved metadata rows so exports reflect the chosen labels even after refreshes.
- **Metadata field records (`metadataFieldRecords`, version 1)**: `metadata_fields.html` stores normalized visitor/account metadata for each app and lookback window. The snapshot is versioned and includes the integration key and domain used so stale entries can be discarded safely.
- **Deep Dive aggregates (`deepDiveMetaEvents`)**: `deep_dive.html` reuses the metadata selections and cached Deep Dive results exposed via `window.deepDiveData` to avoid redundant scans. Use the console helper `window.deepDiveData` to confirm what is currently cached before clearing `sessionStorage`.
- **SPA metadata aggregation summaries (`metadataAggregations`)**: View 3 stores SubID → App ID lookups with per-window namespace buckets, timeseries starts, and value/count tallies for visitor/account/custom/Salesforce fields so recent metadata distributions can be reviewed from the console without separate app-level rollups.

## API call queues and progress bars
- **Metadata fields progress text**: `setupProgressTracker()` on `metadata_fields.html` counts dispatched vs. completed Engage aggregation calls. Payload splits (for oversized datasets) increment the total call count so the progress text reflects the additional requests.
- **Deep Dive queueing**: `runDeepDiveScan()` registers every pending metadata request before dispatch and updates `metadata_pending_api_calls` as windows are split, started, and resolved. Progress indicators pull from these pending call summaries, ensuring the UI stays in sync even if retries or splits change the total request volume mid-run.
- **Request pacing**: Deep Dive requests run with a concurrency of two and staggered 3-second delays per concurrency bucket to reduce API pressure. The spacing is calculated from the request index so batches stay predictable regardless of list size.
- **Developer diagnostics**: `window.showPendingApiQueue()` surfaces queued or in-flight API calls in a console table, while `window.metadata_api_calls` lists completion/error records for each request. Use these helpers to correlate UI progress bars with actual network activity when debugging.

## Integration API workflow
1. **index.html**
   - `bootstrapShared()` injects shared modal templates.
   - `initSubIdForm()` builds SubID rows, validates domain and integration key inputs, stores valid entries in `sessionStorage` (`subidLaunchData`), and launches app discovery before redirecting to app selection.
2. **app_selection.html**
   - `bootstrapShared()` prepares shared modals.
   - `initAppSelection()` reads `subidLaunchData`, fetches app lists for each SubID + integration key pair, caches them under `appSelectionResponses`, renders the selectable table, and enables Continue when at least one app is chosen.
3. **metadata_fields.html**
   - `bootstrapShared()` injects export and naming modals.
   - `initDeepDiveNavigation()` binds the Deep Dive button for follow-on scans.
   - `initMetadataFields()` loads `appSelectionResponses`, requests metadata for each selected app across 180/30/7-day windows, tracks API progress, and saves results plus manual app name overrides to `metadataFieldRecords`.
4. **deep_dive.html**
   - `bootstrapShared()` keeps export modals available.
   - `initDeepDive()` reads `appSelectionResponses` and `metadataFieldRecords` from the shared namespace on page load, populates the 7-day metadata columns immediately, lets users refine expected field formats, issues deeper metadata scans for the chosen lookback, and aligns results with manual app naming before enabling exports.
   - JSON exports (`metadata-deep-dive-visitors.json`, `metadata-deep-dive-accounts.json`) nest Sub ID → App ID and summarize each metadata field as value/count pairs. App names persist separately in `sessionStorage` under `manualAppNames`.

## Debug logging
- Logging is centralized through `src/utils/logger.js`, which prefixes console output with the calling scope (for example, `[AppSelection]` or `[WorkbookUI]`).
- Debug statements are suppressed by default; set `window.DEBUG_LOGGING = true` before triggering interactions to surface debug-level messages across the app and request helpers. The debug toggle control also writes `window.DEBUG_DEEP_DIVE` for backward compatibility.
- Deep Dive pages gate all non-error logs unless debug logging is enabled. Use the toggle in the navigation bar or set `window.DEBUG_LOGGING = true` manually when diagnosing exports or metadata alignment issues without flooding the console during normal use.

### Deep Dive diagnostics
- **Enable verbose logging**: Open the console on `deep_dive.html` and set `window.DEBUG_LOGGING = true;` (or `window.DEBUG_DEEP_DIVE = true;` for legacy scripts) before starting a scan. Logs stream to the browser console and inherit the `[DeepDive]` prefix with timestamps when the flag is active.
- **API lifecycle cues**: During a run you should see `Prepared deep dive request queue` (total calls staged), `Starting deep dive scan` (execution begins), `Scheduling deep dive request` / `Queued deep dive requests for execution` (async dispatch), and `Deep dive scan completed` (all calls resolved).
- **Processing progress cues**: Each queued app emits `Processing deep dive entry`, followed by either `Deep dive entry completed` (success) or `Deep dive entry marked as failed` / `Deep dive request failed` when responses error. Splits logged as `Splitting deep dive request into smaller windows` show when oversized date ranges are divided for retries. Use these messages to correlate UI progress bars with background processing when capturing diagnostics.

### Deep Dive scan flow
- **Queue creation**: `buildScanEntries()` prepares one entry per selected app and lookback window, while `stageDeepDiveCallPlan()` and `registerPendingMetadataCall()` record each planned API call so progress bars have an initial total.
- **Watchdog + staging**: `runDeepDiveScan()` logs the start, hydrates totals from `metadata_pending_api_calls`, and arms a stall watchdog so long-running or stuck calls are resolved with an error status.
- **Staggered dispatch**: Requests are enqueued with `scheduleDeepDiveRequest()`; `dispatchNextRequest()` spaces them by the configured delay and enforces the concurrency cap before calling `markPendingMetadataCallStarted()`.
- **API execution**: `runAggregationWithFallbackWindows()` issues the Engage aggregation request. When payloads are too large it triggers `onWindowSplit`, increasing the recorded request count and updating UI status text while making multiple API calls for the split windows.
- **Response handling**: Successful responses flow through `collectDeepDiveMetadataFields()`, which now normalizes metadata field names and persists visitor/account aggregations in a single pass. Completion details are logged before resolving `metadata_pending_api_calls`. Failures capture whether the API call or response processing failed and mark the call plan status accordingly.

## Console helpers
- `window.deepDiveData`
  - Context: Loaded on `deep_dive.html` during bootstrap to expose cached selections and metadata lookups.
  - Expected input: None; populated from `sessionStorage` keys (`appSelectionResponses`, `metadataFieldRecords`, `deepDiveMetaEvents`).
  - Sample invocation: `window.deepDiveData?.metadataFieldRecords?.length`.
  - Output: Object keyed by the storage entries above with their cached record arrays.
- `window.metadata_visitors`
  - Context: Deep Dive scans after `collectDeepDiveMetadataFields()` processes responses.
  - Expected input: None; filled when visitor metadata responses are aggregated.
  - Sample invocation: `window.metadata_visitors[0]?.apps[0]?.metadataFields`.
  - Output: Array of `{ subId, apps: [{ appId, metadataFields: [{ field, values: [{ value, count }] }] }] }` sorted for visitor exports.
- `window.metadata_accounts`
  - Context: Deep Dive scans after `collectDeepDiveMetadataFields()` aggregates account metadata.
  - Expected input: None; values flow from account metadata aggregation.
  - Sample invocation: `window.metadata_accounts.find((row) => row.field === 'industry')`.
  - Output: Array of flat rows `{ subId, appId, field, value, count }` ordered for XLSX/JSON exports.
- `window.metadataQueue`
  - Context: SPA view 3 after metadata tables load. Builds a queue of 7/23/150-day metadata aggregation calls for each SubID + App ID pair on the page and exposes derived 30/180-day buckets (7 + 23, then 30 + 150) alongside the raw window data only after their source windows resolve so the tables can present round-number totals at the correct time.
  - Expected input: Optional limit on `run()`. `print()` logs the current queue to the console, `rebuild()` re-queues the current SubID/App ID pairs, `inspect()` surfaces the queue entries, and `size()` reports how many calls are staged.
  - Sample invocation: `window.metadataQueue.print()` to see the queued SubIDs and apps, or `window.metadataQueue.run(2)` to process the first two queued calls one at a time.
  - Output: `run()` resolves with the executed call summaries while logging each aggregation through `processAggregation()`. Lookback day counters now start at the cumulative 180-day coverage (the full 7/23/150-day plan) and decrement per window so 30-day and 180-day milestones can trigger correctly instead of stalling at the initial 7-day pass.
- `window.metadata_api_calls`
  - Context: Deep Dive request lifecycle while metadata responses stream in.
  - Expected input: None; appended through `updateMetadataApiCalls()` during each request.
  - Sample invocation: `window.metadata_api_calls.slice(-3)`.
  - Output: Array of call records `{ appId, subId, datasetCount, status, error, recordedAt }`.
- `window.metadata_pending_api_calls`
  - Context: Deep Dive queue tracking for in-flight or waiting metadata requests.
  - Expected input: None; maintained by `registerPendingMetadataCall()`, `markPendingMetadataCallStarted()`, and `resolvePendingMetadataCall()`.
  - Sample invocation: `window.metadata_pending_api_calls.filter((call) => call.status !== 'completed')`.
  - Output: Array of pending call entries `{ appId, subId, status, queuedAt, startedAt, completedAt, error }`.
- `window.showPendingApiQueue()`
  - Context: Page-agnostic debugging to review outstanding API traffic before pending calls finish.
  - Expected input: None; invoked directly from the console.
  - Sample invocation: `window.showPendingApiQueue()`.
  - Output: Returns the outstanding pending call objects and prints a `console.table` showing `appId`, `subId`, `status`, and timestamps.
## App selection flow details
- **Launch data hydration**: `initAppSelection()` parses `sessionStorage.subidLaunchData` to rebuild the SubID rows that originated from `index.html`. If no rows exist it surfaces `API information not found` and blocks progression.
- **Request queue + status banner**: Each SubID fetch registers a queue entry via `registerPendingCall()` so the shared status banner can summarize pending vs. completed requests. The banner is refreshed when requests are planned, started, settled, or superseded to keep progress text accurate even if payloads split.
- **Fetching app lists**: `fetchAppsForEntry()` is called per SubID/domain/integration key (and optional lookback window) with callbacks for planned/settled counts. Responses are stored as `{ subId, domain, integrationKey, response, windowDays }` objects. Failed or timed-out SubIDs are recorded separately for user-facing warnings.
- **Merging responses**: `mergeAppResponsesBySubId()` consolidates duplicate SubID entries by normalizing app IDs and combining `selectionState` maps. When multiple responses are merged, a synthetic `{ results: [{ appId }] }` payload is constructed so downstream filtering and Deep Dive hydration can still extract IDs reliably.
- **Selection state + persistence**: `buildSelectionState()` seeds each app entry with `{ appId, appName, selected }`, honoring manual names from `manualAppNames` and any previously chosen rows. Selections, app names, and window lookback are persisted in `sessionStorage.appSelectionResponses` after each fetch or toggle so refreshes keep the state.
- **Table rendering + toggles**: `populateTableFromResponses()` renders one row per SubID/app with manual name buttons, tooltips, and per-row checkboxes. Header toggles update all visible rows, sync the indeterminate state, and disable the Continue button until at least one checkbox is selected. Empty responses render a friendly fallback row instead of leaving the table blank.
- **Manual naming sync**: The shared naming modal is initialized through `setupManualAppNameModal()`, and any saved name updates flow back through `syncCachedAppName()` to rewrite cached selection state for both the current session and any previously stored app IDs.
- **Window selector behavior**: The lookback dropdown (`app-selection-window`) defaults to 7 days and triggers `fetchAndPopulate()` whenever it changes. Active fetches are tokenized so superseded responses resolve their pending-call entries without overwriting newer requests.
- **Proceed handling**: Clicking Continue gathers the checked rows, filters each source response to only the chosen app IDs, reapplies manual names, and writes the narrowed selection back to `appSelectionResponses` before navigating to `metadata_fields.html`. Errors during this phase surface inline alerts instead of redirecting.

## Maintenance notes
- Clear `sessionStorage` between runs to avoid stale SubID or manual naming data.
- Keep secrets out of exports; integration keys are never written to disk.
- XLSX downloads use the open-source ExcelJS build from the CDN so header styling applied in-browser persists in the saved workbook. Keep
  export tooling open-source unless otherwise directed.

