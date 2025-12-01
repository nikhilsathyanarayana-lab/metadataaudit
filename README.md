# Metadata Audit

## Overview
This project is a web-based tool designed to automate the metadata audit process for Pendo
implementations. It allows internal users to input subscription identifiers and quickly
retrieve and consolidate metadata across multiple apps. The goal is to ensure that metadata
is consistent and to identify any discrepancies in how data is reported.

The tool supports two methods for pulling metadata: one using an integration key with the Engage API, and another using a cookie-based approach.

## Prerequisites
- **Hosting**: GitHub Pages can host the Integration API workflow, but the cookie workflow still requires a PHP proxy (`proxy.php`) to avoid CORS errors. Use a server or local environment with PHP and cURL enabled when exercising cookie-based requests.
- **Authentication**: Provide either an integration key with read access or a superuser session cookie.
- **Browser**: Any modern browser that supports the Fetch API and `localStorage` (e.g., Chrome, Firefox, or Edge).

## Launching the app locally
Follow these steps to serve the project on your Mac:

1. If you do not have PHP installed, open **Pendo Self Service** and choose the option to install **Homebrew**. This is the fastest way to get the package manager without running scripts manually.
2. Still inside Pendo Self Service, request admin approval to run a Homebrew command. Ask your admin to run `brew install php` through the installer so PHP is installed system-wide. Skip this step if PHP is already available on your machine.
3. Clone the repository and move into the project directory:
   ```bash
   git clone https://github.com/your-org/metadataaudit.git
   cd metadataaudit
   php -S localhost:8000
   ```
4. Visit `http://localhost:8000` in your browser and open `index.html` to begin the workflow. You can navigate directly to `app_selection.html`, `metadata_fields.html`, `deep_dive.html`, or `workbook_ui.html` if you need to test a specific page.

## Project structure
- `index.html`: Landing view where auditors enter SubIDs, choose a Pendo domain, and link integration keys before triggering aggregation requests.
- `app_selection.html`: Selection step that lists discovered apps so users can choose the ones to audit further.
- `metadata_fields.html`: Displays key metadata fields for the selected apps and provides export actions.
- `deep_dive.html`: Additional drill-down view reached from the metadata fields screen.
- `workbook_ui.html`: Companion UI for the cookie-only Aggregations → Metadata Excel script, helping users stage inputs and preview workbook runs.
- `Aggregations/`: Standalone scripts and tests that exercise the Aggregation API and workbook generation paths.
- `Modals/`: Shared dialog templates injected into pages, including `app-name-modal.html` for app discovery naming, `export-modal.html` for downloads, and `xlsx-naming-modal.html` for workbook filename guidance.
- `src/entries/`: Page-level bootstraps that import only the controllers and services each HTML view needs, plus a shared startup that injects the export modal template when required.
- `src/controllers/`: Controllers for discrete UI behaviors, such as SubID form wiring and modal template injection.
- `src/pages/`: Page orchestration scripts that wire together controllers and services for each HTML view.
- `src/services/`: API helpers and utility functions used by controllers and pages, including Aggregations payload builders.
- `src/ui/`: UI-specific utilities and helpers shared across views.
- `styles.css` / `exports.css`: Global styling, layout, and export-specific tweaks.
- `proxy.php`: PHP proxy used for cookie-based Aggregations calls and to avoid browser CORS errors.
- `package.json`: Project metadata and npm scripts for dependency management.

## Integration workflow overview
The Integration API workflow progresses through the HTML pages below. Each step lists the functions that run (in order) and how data persists between screens:

1. **index.html**
   - `bootstrapShared()` loads the export modal templates before page logic runs.
   - `initSubIdForm()` builds the SubID rows, captures domains and integration keys, and stores valid entries in `localStorage` under `subidLaunchData`. Launching dispatches aggregation discovery requests and redirects to app selection.
2. **app_selection.html**
   - `bootstrapShared()` prepares shared modals.
   - `initAppSelection()` reads `subidLaunchData`, fetches app lists for each SubID + integration key pair, saves results as `appSelectionResponses` in `localStorage`, renders the selectable table, and enables Continue when at least one app is chosen.
3. **metadata_fields.html**
   - `bootstrapShared()` injects export and naming modals.
   - `initDeepDiveNavigation()` binds the Deep Dive button so users can pivot to the drill-down view.
   - `initMetadataFields()` loads `appSelectionResponses`, requests metadata for each selected app across 180/30/7-day windows, tracks API progress, and caches retrieved records in `localStorage` (`metadataFieldRecords`) alongside manual app name overrides.
4. **deep_dive.html**
   - `bootstrapShared()` makes export modals available.
   - `initDeepDive()` gathers prior selections and metadata from `appSelectionResponses` and `metadataFieldRecords`, lets users refine expected field formats, issues deeper metadata scans for the chosen lookback, and syncs results with manual app naming before enabling exports.
  - JSON export downloads visitor, account, and request/response payload history files: `metadata-deep-dive-visitors.json`, `metadata-deep-dive-accounts.json`, and `metadata-deep-dive-api-calls.json`. The visitor export nests Sub ID → App ID and summarizes each metadata field (including `visitorId`) as an array of value/count pairs; the account export groups Sub ID → App ID with the same value/count structure. Both exports intentionally omit `appName` because names are persisted separately in `localStorage` under the `manualAppNames` key and reapplied wherever the UI needs to label a record.

Workbook and cookie-only flows (`workbook_ui.html` and `proxy.php`) run outside this Integration API sequence.

## What’s still missing
- **API request/response examples**: Document sample Aggregations payloads (e.g., `buildAppListingPayload`, `buildMetadataFieldsForAppPayload`, chunked requests) and expected responses for common success and failure cases.
  - *Next step*: Add example JSON bodies and response snippets to a dedicated section that mirrors the payload builders in `src/services/requests.js`, including how errors propagate through the proxy.
- **Authentication handling guidance**: Clarify when to use integration keys versus `pendo.sess.jwt2` cookies, how to format the cookie header, and what to expect from authentication failures.
  - *Next step*: Write a short auth guide that covers secret handling, masking/validation behavior in the UI, and troubleshooting for 401/403 responses from both direct and proxied requests.
- **Testing strategy**: Outline how to validate the workbook flow and controllers (e.g., stubbed fetch for Aggregations, DOM-driven smoke checks for page scripts).
  - *Next step*: Propose a lightweight test plan (unit tests around `src/services/requests.js`, fixture-driven DOM tests for `src/pages/*.js`, and a manual workbook runbook) and identify preferred tools or runners.

## Pendo integration
- **Pendo Aggregation API**: `src/pages/workbookUi.js` posts to each environment's `/api/v1/aggregation` endpoint with the user-supplied integration key to retrieve app metadata across domains.
- **Domains**: The SubID form allows choosing from multiple Pendo environments (pendo.io, eu, us1, jpn, au, HSBC) before dispatching API calls.

## Colour scheme
The UI uses Pendo's core palette defined in CSS variables:
- Pink: `#e0006c`
- Charcoal: `#3d3d3d`
- Light background: `#f9f6f8`

## Languages and packages
- **Languages**: HTML, CSS, and vanilla JavaScript.
- **Packages/Dependencies**: No external packages are required; the app relies on browser-native Fetch APIs, plus CDN-loaded `xlsx` and `file-saver` libraries fetched at runtime for `src/pages/workbookUi.js` rather than installed via npm.
