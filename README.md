# Metadata Audit

## Overview
Metadata Audit is a static web application that helps Pendo teams validate subscription metadata. It streamlines two paths:

- **Integration API flow** for most audits. Users supply a SubID, domain, and integration key to pull metadata directly from the Engage API.
- **Cookie-based workbook flow** for superuser cookie audits. Requests are routed through a PHP proxy to avoid CORS issues and staged for workbook exports.

Both flows share page-level controllers written in vanilla JavaScript and store in-progress state in `localStorage` between screens.

## Quick start
- **Hosted use**: The Integration API flow can run from any static host (e.g., GitHub Pages) because all requests go straight to the Engage API.
- **Local development**:
  1. Ensure PHP with cURL is available so the cookie workbook can call `proxy.php`.
  2. Serve the project from the repo root:
     ```bash
     php -S localhost:8000
     ```
  3. Open `http://localhost:8000/index.html` for Integration API testing or `http://localhost:8000/cookie_method.html` for the cookie workbook.
- **Auth inputs**: Provide an integration key with read access for the Integration API flow or a `pendo.sess.jwt2` cookie when using the cookie workbook. Use any modern browser that supports the Fetch API.

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
- Aggregations requests are assembled with helpers in `src/services/requests.js` and posted through `proxy.php` using a `cookie` header built by `buildCookieHeaderValue()`.
- Responses are parsed into CSV-ready rows with `parseExamples()` before triggering downloads for downstream Excel processing.

### Aggregations API request examples by stage
- **App discovery (index → app selection)**: `buildAppListingPayload()` POSTs to `{domain}/api/v1/aggregation` with an `X-Pendo-Integration-Key` header. The request asks the pipeline to expand app IDs seen in the past week and return the distinct list.

  ```json
  {
    "response": { "location": "request", "mimeType": "application/json" },
    "request": {
      "requestId": "apps-list",
      "pipeline": [
        {
          "source": {
            "singleEvents": { "appId": "expandAppIds(\"*\")" },
            "timeSeries": { "first": "now()", "count": -7, "period": "dayRange" }
          }
        },
        { "group": { "group": ["appId"] } },
        { "select": { "appId": "appId" } }
      ]
    }
  }
  ```

- **Metadata window scan (metadata_fields.html)**: `buildMetadataFieldsPayload(windowDays)` posts a single request covering all apps for a selected Sub ID. The pipeline targets the requested lookback window, pulling visitor and account keys for each app.

  ```json
  {
    "response": { "location": "request", "mimeType": "application/json" },
    "request": {
      "requestId": "metadata-fields-180",
      "pipeline": [
        {
          "source": {
            "singleEvents": { "appId": "expandAppIds(\"*\")" },
            "metadata": { "account": true, "visitor": true },
            "timeSeries": { "first": "now()", "count": -180, "period": "dayRange" }
          }
        },
        {
          "select": {
            "appId": "appId",
            "visitorFields": "keys(metadata.visitor)",
            "accountFields": "keys(metadata.account)"
          }
        }
      ]
    }
  }
  ```

- **Deep dive metadata fields (deep_dive.html)**: `buildMetadataFieldsForAppPayload(appId, windowDays)` uses two `spawn` branches to return visitor and account field lists for the selected app and window. The UI retries chunked variants when large windows fail.

  ```json
  {
    "response": { "mimeType": "application/json" },
    "request": {
      "name": "metadata-fields-for-app",
      "pipeline": [
        {
          "spawn": [
            [
              { "source": { "singleEvents": { "appId": "<APP_ID>" }, "timeSeries": { "first": "now()", "count": -30, "period": "dayRange" } } },
              { "filter": "contains(type,`meta`)" },
              { "unmarshal": { "metadata": "title" } },
              { "filter": "!isNil(metadata.visitor)" },
              { "eval": { "visitorMetadata": "keys(metadata.visitor)" } },
              { "unwind": { "field": "visitorMetadata" } },
              { "group": { "group": ["appId", "visitorMetadata"] } },
              { "group": { "group": ["appId"], "fields": { "visitorMetadata": { "list": "visitorMetadata" } } } }
            ],
            [
              { "source": { "singleEvents": { "appId": "<APP_ID>" }, "timeSeries": { "first": "now()", "count": -30, "period": "dayRange" } } },
              { "filter": "contains(type,`meta`)" },
              { "unmarshal": { "metadata": "title" } },
              { "filter": "!isNil(metadata.account)" },
              { "eval": { "accountMetadata": "keys(metadata.account)" } },
              { "unwind": { "field": "accountMetadata" } },
              { "group": { "group": ["appId", "accountMetadata"] } },
              { "group": { "group": ["appId"], "fields": { "accountMetadata": { "list": "accountMetadata" } } } }
            ]
          ]
        },
        { "join": { "fields": ["appId"] } }
      ]
    }
  }
  ```

- **Metadata examples export (deep_dive.html)**: `buildMetaEventsPayload(appId, windowDays)` requests a smaller window (defaults to 7 days) of meta events for visitors and accounts. The deep dive export stitches these results into JSON files.

  ```json
  {
    "response": { "location": "request", "mimeType": "application/json" },
    "request": {
      "name": "account-visitor-only",
      "pipeline": [
        {
          "source": {
            "singleEvents": { "appId": "<APP_ID>" },
            "timeSeries": { "first": "now()", "count": -7, "period": "dayRange" }
          }
        },
        { "filter": "contains(type,`meta`)" },
        { "unmarshal": { "metadata": "title" } },
        { "select": { "visitor": "metadata.visitor", "account": "metadata.account", "visitorId": "visitorId", "accountId": "accountId", "appId": "appId" } }
      ]
    }
  }
  ```

## Maintenance notes
- Clear `localStorage` between runs to avoid stale SubID or manual naming data.
- Keep secrets out of exports; integration keys are never written to disk.
- `npm test` is available for future Node-based checks but no automated suites are currently defined.
- XLSX downloads use the open-source ExcelJS build from the CDN so header styling applied in-browser persists in the saved workbook. Keep
  export tooling open-source unless otherwise directed.

## What’s still missing
- **Authentication guidance**: Document how integration keys are validated in the UI, when to choose the cookie workbook, and expected 401/403 behaviors for direct and proxied Aggregations requests.
- **Cookie workbook status**: Capture the current limitations and add proxied request samples once the workflow is stable.
- **Testing strategy**: Outline a lightweight plan that covers service helpers, page orchestrators, and a manual workbook runbook with stubbed fetch examples.
