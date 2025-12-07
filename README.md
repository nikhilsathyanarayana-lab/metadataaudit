# Metadata Audit

## Overview
Metadata Audit is a static web application that helps Pendo teams validate subscription metadata. It streamlines two paths:

- **Integration API flow** for most audits. Users supply a SubID, domain, and integration key to pull metadata directly from the Engage API.
- **Cookie-based workbook flow** for superuser cookie audits. Requests are routed through a PHP proxy to avoid CORS issues and staged for workbook exports.

Both flows share page-level controllers written in vanilla JavaScript and store in-progress state in `localStorage` between screens.

## Quick start
- **Hosted use**: The Integration API flow can run from any static host (e.g., GitHub Pages) because all requests go straight to the Engage API.
- **Local development**:
  1. Ensure PHP with cURL is available so the cookie workflow can call `proxy.php`.
  2. Serve the project from the repo root:
     ```bash
     php -S localhost:8000
     ```
  3. Open `http://localhost:8000/index.html` for Integration API testing or `http://localhost:8000/cookie_method.html` for the cookie workbook.
- **Auth inputs**: Provide either an integration key with read access or a `pendo.sess.jwt2` cookie (only needed for the cookie flow). Use any modern browser that supports the Fetch API.

## Local storage and cached state
- **SubID launch data (`subidLaunchData`)**: `initSubIdForm()` serializes each SubID + domain + integration key row before redirecting to app selection so users can refresh or navigate without losing entries. Empty rows are pruned on save to keep the cache small.
- **App selection responses (`appSelectionResponses`)**: `initAppSelection()` hydrates previously cached SubIDs, populates app lists, and persists the full integration responses so downstream pages can render without refetching. Seven-day metadata previews are merged into this cache when available to keep Deep Dive defaults aligned.
- **Manual app names (`manualAppNames`)**: The app name modal on `metadata_fields.html` writes overrides through `appNames.js`, updating both in-memory caches and previously saved metadata rows so exports reflect the chosen labels even after refreshes.
- **Metadata field records (`metadataFieldRecords`, version 1)**: `metadata_fields.html` stores normalized visitor/account metadata for each app and lookback window. The snapshot is versioned and includes the integration key and domain used so stale entries can be discarded safely.
- **Deep Dive aggregates (`deepDiveMetaEvents`)**: `deep_dive.html` reuses the metadata selections and cached Deep Dive results exposed via `window.deepDiveData` to avoid redundant scans. Use the console helper `window.deepDiveData` to confirm what is currently cached before clearing `localStorage`.

## API call queues and progress bars
- **Metadata fields progress text**: `setupProgressTracker()` on `metadata_fields.html` counts dispatched vs. completed Engage aggregation calls. Payload splits (for oversized datasets) increment the total call count so the progress text reflects the additional requests.
- **Deep Dive queueing**: `runDeepDiveScan()` registers every pending metadata request before dispatch and updates `metadata_pending_api_calls` as windows are split, started, and resolved. Progress indicators pull from these pending call summaries, ensuring the UI stays in sync even if retries or splits change the total request volume mid-run.
- **Request pacing**: Deep Dive requests run with a concurrency of two and staggered 3-second delays per concurrency bucket to reduce API pressure. The spacing is calculated from the request index so batches stay predictable regardless of list size.
- **Developer diagnostics**: `window.showPendingDeepDiveRequests()` surfaces queued or in-flight Deep Dive calls in a console table, while `window.metadata_api_calls` lists completion/error records for each request. Use these helpers to correlate UI progress bars with actual network activity when debugging.

## Integration API workflow
1. **index.html**
   - `bootstrapShared()` injects shared modal templates.
   - `initSubIdForm()` builds SubID rows, validates domain and integration key inputs, stores valid entries in `localStorage` (`subidLaunchData`), and launches app discovery before redirecting to app selection.
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
   - JSON exports (`metadata-deep-dive-visitors.json`, `metadata-deep-dive-accounts.json`) nest Sub ID → App ID and summarize each metadata field as value/count pairs. App names persist separately in `localStorage` under `manualAppNames`.

## Cookie workbook workflow
- `cookie_method.html` uses `initWorkbookUi()` to collect SubID, environment, cookie, and optional examples settings.
- Aggregation requests are assembled with helpers in `src/services/requests.js` and posted through `proxy.php` using a `cookie` header built by `buildCookieHeaderValue()`.
- Responses are parsed into CSV-ready rows with `parseExamples()` before triggering downloads for downstream Excel processing.

## Debug logging
- Logging is centralized through `src/utils/logger.js`, which prefixes console output with the calling scope (for example, `[AppSelection]` or `[WorkbookUI]`).
- Debug statements are suppressed by default; set `window.DEBUG_LOGGING = true` before triggering interactions to surface debug-level messages across the app and request helpers.
- Deep Dive pages gate all non-error logs unless `window.DEBUG_DEEP_DIVE` is enabled. Toggle that flag in the console when diagnosing exports or metadata alignment issues without flooding the console during normal use.

### Deep Dive diagnostics
- **Enable verbose logging**: Open the console on `deep_dive.html` and set `window.DEBUG_DEEP_DIVE = true;` before starting a scan. Logs stream to the browser console and inherit the `[DeepDive]` prefix with timestamps when the flag is active.
- **API lifecycle cues**: During a run you should see `Prepared deep dive request queue` (total calls staged), `Starting deep dive scan` (execution begins), `Scheduling deep dive request` / `Queued deep dive requests for execution` (async dispatch), and `Deep dive scan completed` (all calls resolved). Warnings such as `Detected stalled deep dive request` and `Outstanding deep dive requests detected after scan resolution` indicate items that exceeded the watchdog threshold or never finished.
- **Processing progress cues**: Each queued app emits `Processing deep dive entry`, followed by either `Deep dive entry completed` (success) or `Deep dive entry marked as failed` / `Deep dive request failed` when responses error. Splits logged as `Splitting deep dive request into smaller windows` show when oversized date ranges are divided for retries. Use these messages to correlate UI progress bars with background processing when capturing diagnostics.

## Console helpers
- `window.deepDiveData`
  - Context: Loaded on `deep_dive.html` during bootstrap to expose cached selections and metadata lookups.
  - Expected input: None; populated from `localStorage` keys (`appSelectionResponses`, `metadataFieldRecords`, `deepDiveMetaEvents`).
  - Sample invocation: `window.deepDiveData?.metadataFieldRecords?.length`.
  - Output: Object keyed by the storage entries above with their cached record arrays.
- `window.metadata_visitors`
  - Context: Deep Dive scans after `updateMetadataCollections()` runs.
  - Expected input: None; filled when visitor metadata responses are aggregated.
  - Sample invocation: `window.metadata_visitors[0]?.apps[0]?.metadataFields`.
  - Output: Array of `{ subId, apps: [{ appId, metadataFields: [{ field, values: [{ value, count }] }] }] }` sorted for visitor exports.
- `window.metadata_accounts`
  - Context: Deep Dive scans after `updateMetadataCollections()` processes account metadata.
  - Expected input: None; values flow from account metadata aggregation.
  - Sample invocation: `window.metadata_accounts.find((row) => row.field === 'industry')`.
  - Output: Array of flat rows `{ subId, appId, field, value, count }` ordered for XLSX/JSON exports.
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
- `window.showPendingDeepDiveRequests()`
  - Context: Deep Dive page debugging to review outstanding API traffic before scans finish.
  - Expected input: None; invoked directly from the console.
  - Sample invocation: `window.showPendingDeepDiveRequests()`.
  - Output: Returns the outstanding pending call objects and prints a `console.table` showing `appId`, `subId`, `status`, and timestamps.
- `window.describeJsonFileStructure()`
  - Context: Quickly inspect the shape of exported Deep Dive JSON files without loading them into the UI.
  - Expected input: Invoked from the console; triggers a JSON file picker and parses the selected file.
  - Sample invocation: `window.describeJsonFileStructure()`.
  - Output: Logs a nested summary of the JSON structure (including array lengths and object keys) via `console.dir` and returns the summarized shape object.

## Maintenance notes
- Clear `localStorage` between runs to avoid stale SubID or manual naming data.
- Keep secrets out of exports; integration keys and cookies are never written to disk.
- XLSX downloads use the open-source ExcelJS build from the CDN so header styling applied in-browser persists in the saved workbook. Keep
  export tooling open-source unless otherwise directed.

