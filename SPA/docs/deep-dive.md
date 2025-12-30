# Deep Dive queues and diagnostics

## Progress tracking and pacing
- `setupProgressTracker()` on `metadata_fields.html` counts dispatched vs. completed Engage aggregation calls. Payload splits (for oversized datasets) increment the total call count so the progress text reflects the additional requests.
- `runDeepDiveScan()` registers every pending metadata request before dispatch and updates `metadata_pending_api_calls` as windows are split, started, and resolved. Progress indicators pull from these pending call summaries, ensuring the UI stays in sync even if retries or splits change the total request volume mid-run.
- Deep Dive requests run with a concurrency of two and staggered 3-second delays per concurrency bucket to reduce API pressure. The spacing is calculated from the request index so batches stay predictable regardless of list size.

## Debug logging and diagnostics
- Logging is centralized through `src/utils/logger.js`, which prefixes console output with the calling scope (for example, `[App Selection]` or `[WorkbookUI]`).
- Debug statements are suppressed by default; set `window.DEBUG_LOGGING = true` before triggering interactions to surface debug-level messages across the app and request helpers. The debug toggle control also writes `window.DEBUG_DEEP_DIVE` for backward compatibility.
- Deep Dive pages gate all non-error logs unless debug logging is enabled. Use the toggle in the navigation bar or set `window.DEBUG_LOGGING = true` manually when diagnosing exports or metadata alignment issues without flooding the console during normal use.

### Deep Dive diagnostics
- **Enable verbose logging**: Open the console on `deep_dive.html` and set `window.DEBUG_LOGGING = true;` (or `window.DEBUG_DEEP_DIVE = true;` for legacy scripts) before starting a scan. Logs stream to the browser console and inherit the `[DeepDive]` prefix with timestamps when the flag is active.
- **API lifecycle cues**: During a run you should see `Prepared deep dive request queue` (total calls staged), `Starting deep dive scan` (execution begins), `Scheduling deep dive request` / `Queued deep dive requests for execution` (async dispatch), and `Deep dive scan completed` (all calls resolved).
- **Processing progress cues**: Each queued app emits `Processing deep dive entry`, followed by either `Deep dive entry completed` (success) or `Deep dive entry marked as failed` / `Deep dive request failed` when responses error. Splits logged as `Splitting deep dive request into smaller windows` show when oversized date ranges are divided for retries. Use these messages to correlate UI progress bars with background processing when capturing diagnostics.

## Deep Dive scan flow
- **Queue creation**: `buildScanEntries()` prepares one entry per selected app and lookback window, while `stageDeepDiveCallPlan()` and `registerPendingMetadataCall()` record each planned API call so progress bars have an initial total.
- **Watchdog + staging**: `runDeepDiveScan()` logs the start, hydrates totals from `metadata_pending_api_calls`, and arms a stall watchdog so long-running or stuck calls are resolved with an error status.
- **Staggered dispatch**: Requests are enqueued with `scheduleDeepDiveRequest()`; `dispatchNextRequest()` spaces them by the configured delay and enforces the concurrency cap before calling `markPendingMetadataCallStarted()`.
- **API execution**: `runAggregationWithFallbackWindows()` issues the Engage aggregation request. When payloads are too large it triggers `onWindowSplit`, increasing the recorded request count and updating UI status text while making multiple API calls for the split windows.
- **Response handling**: Successful responses flow through `collectDeepDiveMetadataFields()`, which normalizes metadata field names and persists visitor/account aggregations in a single pass. Completion details are logged before resolving `metadata_pending_api_calls`. Failures capture whether the API call or response processing failed and mark the call plan status accordingly.

## Console helpers
- **`window.deepDiveData`**: Loaded on `deep_dive.html` during bootstrap to expose cached selections and metadata lookups from `sessionStorage` keys (`appSelectionResponses`, `metadataFieldRecords`, `deepDiveMetaEvents`).
- **`window.metadata_visitors`**: Filled after `collectDeepDiveMetadataFields()` processes visitor metadata responses. Returns arrays such as `{ subId, apps: [{ appId, metadataFields: [{ field, values: [{ value, count }] }] }] }`.
- **`window.metadata_accounts`**: Filled after account metadata aggregations, returning rows `{ subId, appId, field, value, count }` for XLSX/JSON exports.
- **`window.tableData`** (legacy): Mirrors metadata table rows with `{ subId, appName, appId, namespace, window7, window30, window180 }` entries.
- **`window.metadataQueue`** (legacy): Builds 7/23/150-day metadata aggregation queues for each SubID + App ID pair on the page. `print()`, `rebuild()`, `inspect()`, `size()`, and `run(limit)` mirror the SPA queue helpers.
- **`window.metadata_api_calls`**: Tracks Deep Dive request lifecycle while metadata responses stream in.
- **`window.metadata_pending_api_calls`**: Captures pending call entries `{ appId, subId, status, queuedAt, startedAt, completedAt, error }` for queue monitoring.
- **`window.showPendingApiQueue()`**: Page-agnostic helper that prints outstanding API calls via `console.table` and returns the pending call objects.

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
