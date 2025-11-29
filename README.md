# Metadata Audit

## Overview
This project is a web-based tool designed to automate the metadata audit process for Pendo
implementations. It allows internal users to input subscription identifiers and quickly
retrieve and consolidate metadata across multiple apps. The goal is to ensure that metadata
is consistent and to identify any discrepancies in how data is reported.

The tool supports two methods for pulling metadata: one using an integration key with the Engage API, and another using a cookie-based approach.

## Prerequisites
- **Hosting**: GitHub Pages cannot run this project because it requires PHP support. Use a server or local environment capable of running PHP with cURL enabled.
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
- `metadata_fields.html`: Displays key metadata fields for the selected apps and provides an export action.
- `deep_dive.html`: Additional drill-down view reached from the metadata fields screen.
- `workbook_ui.html`: A front-end companion for the cookie-only Aggregations → Metadata Excel script, helping users stage inputs and simulate the workflow with a browser-only run.
- `Aggregations/`: Standalone scripts and tests that exercise the Aggregation API and workbook generation paths.
- `Modals/`: Shared dialog templates injected into pages, including `app-name-modal.html` for app discovery naming, `export-modal.html` for downloads, and `xlsx-naming-modal.html` for workbook filename guidance.
- `src/entries/`: Page-level bootstraps that import only the controllers and services each HTML view needs, plus a shared startup that injects the export modal template when required.
- `src/controllers/`: Controllers for discrete UI behaviors, such as SubID form wiring and modal template injection.
- `src/pages/`: Page orchestration scripts that wire together controllers and services for each HTML view.
- `src/services/`: API helpers and utility functions used by controllers and pages.
- `src/ui/`: UI-specific utilities and helpers shared across views.
- `styles.css`: Global styling, layout, and Pendo-inspired theme tokens.

## HTML page overview
- **index.html**: Hosts the SubID capture form with dynamic rows for domain selection, SubID entry, and per-row integration keys collected via a modal. The Launch action saves the entries to local storage and moves the workflow to app selection.
- **app_selection.html**: Renders a selectable table of apps per SubID using stored launch data. A Continue button is enabled once any checkbox is checked, advancing users to the metadata fields view.
- **metadata_fields.html**: Presents visitor and account metadata tables with retention counts for 180-, 30-, and 7-day windows. Header actions include Deep Dive navigation and opening the export modal for downloads.
- **deep_dive.html**: Extends the metadata tables with an additional “Expected format” selector for each row, focusing on deeper inspection and export-only actions.
- **workbook_ui.html**: Walks through the Python workbook script in a safe mock run. Users choose a Pendo environment (US/EU), enter a Sub ID, optional workbook filename, and paste a `pendo.sess.jwt2` cookie. The page surfaces a live endpoint preview, workbook naming pill, and cookie status, and then visualizes each script phase (environment resolution, app discovery, field capture, meta example analysis, workbook write-out). A request preview card repeats the resolved URL, filename, and tips for avoiding 401 errors.
- **Modals/export-modal.html**: Provides the export dialog markup (with XLSX and PDF options) that is injected on demand into pages needing download actions.

## JavaScript overview (entries + controllers)
- **loadTemplate(path)**: Exported from `src/controllers/modalLoader.js`, fetches and injects the export modal HTML when needed, attaching the markup to the document body.
- **initSubIdForm()**: Exported from `src/controllers/subidForm.js`, drives the landing form experience—building SubID rows with domain selectors, handling integration key modal interactions, persisting launch data to local storage, and dispatching aggregation requests before redirecting to app selection.
  - Internal helpers now cover modal open/close handlers, integration key persistence per row, dynamic add-row controls, and launch button state management tied to completeness of inputs.
- **initAppSelection()**: Exported from `src/pages/appSelection.js`, reads stored launch data, populates the app selection table, and gates the Continue button behind at least one checked app before redirecting to the metadata fields page.
- **initWorkbookUi()**: Exported from `src/pages/workbookUi.js`, orchestrates the cookie-based workbook flow (endpoint resolution, Aggregations calls, XLSX assembly) when the workbook form is present.
- **initDeepDiveNavigation()**: Exported from `src/pages/navigation.js`, navigates from the metadata fields page to the deep dive page when the Deep Dive button is clicked.
- **bootstrapShared()**: Exported from `src/entries/shared.js`, injects the shared export modal template when needed and binds the modal controls for pages that surface an export button.

## What’s still missing
- Runbook details such as how to serve the static pages locally, expected API responses from Pendo, and example payloads aren’t described yet.
- There are no instructions for managing authentication secrets beyond manual integration key entry or for handling failed aggregation requests surfaced in the console.
- The README does not yet cover styling tokens in `styles.css` or any plans for unit or integration testing of the client logic.

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

## How data moves between pages
The static pages share data via `localStorage` so that user inputs entered on the landing page can be reused after navigation:
- When users click **Launch** on `index.html`, `initSubIdForm()` serializes each row into an object of `{ subId, domain, integrationKey }` and stores the array under the `subidLaunchData` key in `localStorage`. Empty rows or rows missing an integration key are excluded.
- `app_selection.html` calls `initAppSelection()`, which reads `subidLaunchData`, masks integration keys for display, and builds the selectable table. If nothing is stored, the table remains empty and the Continue button stays disabled.
- Continuing from app selection simply navigates to `metadata_fields.html` (and optionally `deep_dive.html`), but no additional payload is passed; the initial launch data remains available in `localStorage` for reuse or inspection if needed.
