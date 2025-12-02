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

## Project structure
- `index.html`: Landing view where auditors enter SubIDs, choose a Pendo domain, and link integration keys before dispatching aggregation discovery.
- `app_selection.html`: Lists discovered apps for the chosen SubIDs so users can decide which to audit.
- `metadata_fields.html`: Retrieves metadata for the selected apps, tracks progress, and exposes export actions.
- `deep_dive.html`: Drill-down view for refining expected field formats and requesting deeper scans.
- `cookie_method.html`: Cookie-only staging UI that assembles Aggregations requests and downloads workbook-friendly CSVs.
- `Aggregations/`: Standalone scripts and sample payloads for Aggregations and workbook generation.
- `Modals/`: Shared dialog templates (app naming, export options, XLSX naming guidance) injected at runtime.
- `src/entries/`: Page bootstraps that import only the controllers and services each HTML view needs; `shared.js` wires common modal and export behaviors.
- `src/controllers/`: Discrete UI behaviors such as SubID form wiring and modal/template injection.
- `src/pages/`: Orchestrators that combine controllers and services for each page.
- `src/services/`: API helpers and payload builders used by both flows.
- `src/ui/`: UI utilities shared across multiple views.
- `styles.css` / `exports.css`: Global styling plus export-specific tweaks.
- `proxy.php`: PHP proxy for cookie-based Aggregations calls.
- `package.json`: Node metadata and a minimal `npm test` script (no runtime dependencies).

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
   - Metadata fields now render as selectable chips per app/window so you can flag which visitor/account fields should flow into the Deep Dive tables.
4. **deep_dive.html**
   - `bootstrapShared()` keeps export modals available.
   - `initDeepDive()` reuses `appSelectionResponses` and `metadataFieldRecords`, lets users refine expected field formats, issues deeper metadata scans for the chosen lookback, and aligns results with manual app naming before enabling exports.
   - Only the fields flagged on `metadata_fields.html` are rendered in the tables for each lookback window.
   - JSON exports (`metadata-deep-dive-visitors.json`, `metadata-deep-dive-accounts.json`) nest Sub ID → App ID and summarize each metadata field as value/count pairs. App names persist separately in `localStorage` under `manualAppNames`.

## Cookie workbook workflow
- `cookie_method.html` uses `initWorkbookUi()` to collect SubID, environment, cookie, and optional examples settings.
- Aggregations requests are assembled with helpers in `src/services/requests.js` and posted through `proxy.php` using a `cookie` header built by `buildCookieHeaderValue()`.
- Responses are parsed into CSV-ready rows with `parseExamples()` before triggering downloads for downstream Excel processing.

## Maintenance notes
- Clear `localStorage` between runs to avoid stale SubID or manual naming data.
- Keep secrets out of exports; integration keys and cookies are never written to disk.
- `npm test` is available for future Node-based checks but no automated suites are currently defined.

## What’s still missing
- **API request/response examples**: Add JSON samples for payload builders in `src/services/requests.js` (e.g., app listing, metadata field lookups, examples) and the typical success/failure responses returned via `proxy.php`.
- **Authentication guidance**: Document when to choose integration keys versus `pendo.sess.jwt2` cookies, how cookie masking/validation works in the UI, and expected 401/403 behaviors for direct and proxied requests.
- **Testing strategy**: Outline a lightweight plan that covers service helpers, page orchestrators, and a manual workbook runbook with stubbed fetch examples.
