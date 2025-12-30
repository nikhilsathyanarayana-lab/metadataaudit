# Metadata Audit

## Table of contents
- [Overview](#overview)
- [Quick start](#quick-start)
- [Experiences](#experiences)
  - [Integration API flow (legacy multi-page)](#integration-api-flow-legacy-multi-page)
  - [SPA rebuild (single-page)](#spa-rebuild-single-page)
- [SPA documentation](#spa-documentation)
- [Local storage and cached state](#local-storage-and-cached-state)
- [API queues and diagnostics](#api-queues-and-diagnostics)
- [Console helpers](#console-helpers)
- [Maintenance notes](#maintenance-notes)

## Overview
Metadata Audit is a static web application that helps Pendo teams validate subscription metadata pulled directly from the Engage API. The project offers a legacy multi-page flow and a newer SPA rebuild.

## Quick start
- **Hosted use**: The Integration API flow can run from any static host (for example, GitHub Pages) because all requests go straight to the Engage API.
- **Local development**:
  1. Serve the project from the repo root:
     ```bash
     php -S localhost:8000
     ```
  2. Open `http://localhost:8000/index.html` for Integration API testing or `http://localhost:8000/SPA/html/SPA.html` for the SPA.
- **Auth inputs**: Provide an integration key with read access. Use any modern browser that supports the Fetch API.

## Experiences
### Integration API flow (legacy multi-page)
Uses the root-level HTML files (for example, `index.html`) with vanilla JS controllers and `sessionStorage` to carry SubID, domain, and integration key inputs across pages. Metadata field analysis runs before the Deep Dive, with XLSX as the export format. Deep Dive queue and diagnostic details live in `SPA/docs/deep-dive.md`.

### SPA rebuild (single-page)
Lives under `SPA/`, with `SPA/html/SPA.html` and `SPA/js/spa.js` delivering the consolidated workflow and navigation. The SPA combines field analysis and Deep Dive in one path and exports to PDF or XLSX while avoiding `sessionStorage`/`localStorage` between views. Navigation, call flows, and queue behavior are documented in `SPA/docs/spa.md`.

## SPA documentation
- **Architecture and navigation**: `SPA/docs/spa.md` covers the SPA shell, page switching, caching rules, and how to add a new view.
- **Deep dives and queues**: `SPA/docs/deep-dive.md` captures detailed call sequencing, queue pacing, and diagnostics for Deep Dive and metadata fetches.

## Local storage and cached state
- **SubID launch data (`subidLaunchData`)**: Saves SubID + domain + integration key rows for the legacy flow.
- **App selection responses (`appSelectionResponses`)**: Persists app lists, selections, and lookback windows for reuse across refreshes.
- **Manual app names (`manualAppNames`)**: Stores user-provided labels so exports and tables reflect overrides.
- **Metadata field records (`metadataFieldRecords`, version 1)**: Normalizes visitor/account metadata snapshots per lookback window for reuse in exports.
- **Deep Dive aggregates (`deepDiveMetaEvents`)**: Caches Deep Dive results to avoid redundant scans.
- **SPA metadata aggregation summaries (`metadataAggregations`)**: Saves SubID → App ID lookups with windowed namespace buckets for console review without rebuilding tables.

## API queues and diagnostics
- Metadata fields and Deep Dive queues track pending and completed Engage aggregation calls so progress text stays aligned with the actual request plan.
- Deep Dive requests run with capped concurrency and staggered delays to reduce API pressure while updating pending-call summaries as windows split or retry.
- Successful metadata API responses trigger a `processAPI` summary in `SPA/js/3.js` that logs seven-day namespaces and field names per SubID/AppID pair for quick inspection.
- Detailed queue mechanics, call pacing, and progress banner behavior are described in `SPA/docs/deep-dive.md`.

## Console helpers
- **SPA**: `window.tableData` mirrors SPA view 3 rows, and `window.metadataQueue` inspects or replays SPA metadata queues.
- **Deep Dive and legacy pages**: Helpers such as `window.deepDiveData`, `window.metadata_visitors`, and `window.showPendingApiQueue()` expose cached results and pending call states. See `SPA/docs/deep-dive.md` for the full list and sample invocations.

## Maintenance notes
- Clear `sessionStorage` between runs to avoid stale SubID or manual naming data.
- Keep secrets out of exports; integration keys are never written to disk.
- XLSX downloads rely on ExcelJS from the CDN so browser styling persists in saved workbooks.
