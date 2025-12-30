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
- **Purpose**: Provides the original multi-page metadata audit with vanilla JS controllers.
- **Entry point**: Root-level HTML such as `index.html`, linked workflows, and `sessionStorage` to carry SubID, domain, and integration key inputs across pages.
- **How to run**: Serve the repo root (for example, `php -S localhost:8000`) and open `http://localhost:8000/index.html`.
- **Inputs**: Integration key with read access plus SubID and domain captured in the launch form.
- **Outputs**: Metadata field analysis first, followed by Deep Dive exports in XLSX format.
- **Troubleshooting**: Queue pacing, diagnostics, and Deep Dive behaviors are outlined in `SPA/docs/deep-dive.md` for reference when requests stall.

### SPA rebuild (single-page)
- **Purpose**: Combines metadata field analysis and Deep Dive into one single-page workflow with simplified navigation.
- **Entry point**: `SPA/html/SPA.html` rendered by `SPA/js/spa.js` with view toggles documented in `SPA/docs/spa.md`.
- **How to run**: Serve the repo root (for example, `php -S localhost:8000`) and open `http://localhost:8000/SPA/html/SPA.html`.
- **Inputs**: Integration key with read access plus SubID and domain, entered once and reused without `sessionStorage`/`localStorage` handoffs between views.
- **Outputs**: Unified exports to PDF or XLSX, along with in-browser tables aligned to SPA view definitions.
- **Troubleshooting**: See `SPA/docs/spa.md` for navigation, caching rules, and common queue or progress-banner edge cases.

### Deep Dive (shared diagnostics)
- **Purpose**: Runs targeted Engage aggregation calls for queue-driven Deep Dive exports used by both experiences.
- **Entry point**: Triggered from the Integration API flow or SPA Deep Dive view; detailed call flows live in `SPA/docs/deep-dive.md`.
- **How to run**: Start from either experience, then launch Deep Dive from its respective UI section to populate queues.
- **Inputs**: SubID, domain, integration key, and selected apps/lookback windows configured in the originating experience.
- **Outputs**: Aggregated metadata event summaries and XLSX downloads; SPA also surfaces PDF exports alongside queue status text.
- **Troubleshooting**: Review `SPA/docs/deep-dive.md` for queue pacing, retries, and diagnostics, and use console helpers in the relevant experience to inspect pending calls.

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
