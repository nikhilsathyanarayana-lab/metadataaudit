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
