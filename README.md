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

## Maintenance notes
- Clear `localStorage` between runs to avoid stale SubID or manual naming data.
- Keep secrets out of exports; integration keys and cookies are never written to disk.
- XLSX downloads use the open-source ExcelJS build from the CDN so header styling applied in-browser persists in the saved workbook. Keep
  export tooling open-source unless otherwise directed.

