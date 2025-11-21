# Metadata Audit

## Purpose
Metadata Audit is a lightweight web experience that automates the metadata audit process for Pendo implementations. It guides users through providing SubIDs and integration keys, fetches app metadata via the Pendo Aggregation API, and consolidates results across audit steps.

## Project structure
- `index.html`: Landing view where auditors enter SubIDs, choose a Pendo domain, and link integration keys before triggering aggregation requests.
- `app_selection.html`: Selection step that lists discovered apps so users can choose the ones to audit further.
- `metadata_fields.html`: Displays key metadata fields for the selected apps and provides an export action.
- `deep_dive.html`: Additional drill-down view reached from the metadata fields screen.
- `Modals/export-modal.html`: Template injected when users choose to export results.
- `main.js`: Client-side logic for form handling, modal interactions, navigation between steps, and sending Aggregation API requests with the provided integration keys.
- `styles.css`: Global styling, layout, and Pendo-inspired theme tokens.

## HTML page overview
- **index.html**: Hosts the SubID capture form with dynamic rows for domain selection, SubID entry, and per-row integration keys collected via a modal. The Launch action saves the entries to local storage and moves the workflow to app selection.
- **app_selection.html**: Renders a selectable table of apps per SubID using stored launch data. A Continue button is enabled once any checkbox is checked, advancing users to the metadata fields view.
- **metadata_fields.html**: Presents visitor and account metadata tables with retention counts for 180-, 30-, and 7-day windows. Header actions include Deep Dive navigation and opening the export modal for downloads.
- **deep_dive.html**: Extends the metadata tables with an additional “Expected format” selector for each row, focusing on deeper inspection and export-only actions.
- **Modals/export-modal.html**: Provides the export dialog markup (with XLSX and PDF options) that is injected on demand into pages needing download actions.

## JavaScript overview (main.js)
- **loadModalTemplate(templatePath)**: Fetches and injects the export modal HTML when needed, attaching the markup to the document body.
- **initSubIdForm()**: Drives the landing form experience—building SubID rows with domain selectors, handling integration key modal interactions, persisting launch data to local storage, and dispatching aggregation requests before redirecting to app selection.
  - Internal helpers include modal open/close handlers, integration key persistence per row, dynamic add-row controls, Aggregation API request construction (`buildAggregationRequestBody()`), and launch button state management tied to completeness of inputs.
- **initAppSelection()**: Reads stored launch data, populates the app selection table, and gates the Continue button behind at least one checked app before redirecting to the metadata fields page.
- **initExportModal()**: Wires up the export dialog (when present) to open/close controls, Escape key handling, backdrop clicks, and logging of the chosen export format.
- **initDeepDiveNavigation()**: Navigates from the metadata fields page to the deep dive page when the Deep Dive button is clicked.
- **initExportModalWithTemplate()**: Ensures the export modal template is loaded (injecting it if necessary) and then initializes the modal bindings for pages that present export actions.

## What’s still missing
- Runbook details such as how to serve the static pages locally, expected API responses from Pendo, and example payloads aren’t described yet.
- There are no instructions for managing authentication secrets beyond manual integration key entry or for handling failed aggregation requests surfaced in the console.
- The README does not yet cover styling tokens in `styles.css` or any plans for unit or integration testing of the client logic.

## Pendo integration
- **Pendo Aggregation API**: `main.js` posts to each environment's `/api/v1/aggregation` endpoint with the user-supplied integration key to retrieve app metadata across domains.
- **Domains**: The SubID form allows choosing from multiple Pendo environments (pendo.io, eu, us1, jpn, au, HSBC) before dispatching API calls.

## Colour scheme
The UI uses Pendo's core palette defined in CSS variables:
- Pink: `#e0006c`
- Charcoal: `#3d3d3d`
- Light background: `#f9f6f8`

## Languages and packages
- **Languages**: HTML, CSS, and vanilla JavaScript.
- **Packages/Dependencies**: No external packages are required; the app relies on browser-native Fetch APIs.
