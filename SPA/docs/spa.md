# SPA architecture and navigation

## Shell and navigation
- `SPA/js/spa.js` initializes navigation by rendering the shared nav bar from `SPA/html/nav.html` and wiring up the page switcher buttons. Navigation state is reflected through `aria-pressed` toggles so screen readers understand which view is active.
- Page switcher buttons load in a locked state and only enable after either SubID shortcut (Select Apps or Audit All) is clicked, preventing navigation before any auth inputs exist. The SPA defaults to the first view on load and short-circuits re-renders when the active tab is selected again, preventing duplicate initializer calls.
- Each numbered tab (1–5) represents a view backed by its own HTML partial (`SPA/html/1.html`–`SPA/html/5.html`). When a tab is selected, the SPA fetches that partial with `cache: 'no-cache'`, injects it into the main container, and invokes a matching initializer module (`SPA/js/1.js`–`SPA/js/5.js`) if one exists.
- Each partial uses a shared `page-view` wrapper with a unique ID so cached DOM for one view cannot collide with another when sections are swapped back into the container. Loaded sections are memoized in a `Map` so revisiting a tab reuses existing DOM and skips redundant network fetches or initializers. Views can optionally export an `onShow` handler to refresh data each time they are opened.
- `SPA/js/nav.js` handles fetching and rendering the top-level navigation chrome and marks the active SPA entry via `aria-current`. This keeps the SPA host page aligned with the rest of the site navigation while keeping markup separate from logic.
- To add a new SPA view, create `SPA/html/<id>.html` and `SPA/js/<id>.js`, then register the `<id>` button in `SPA/html/SPA.html` and extend the loader map in `SPA/js/spa.js`. Keep assets under `SPA/` so the rebuild can stay deployable alongside (or independent of) the legacy flow.

## Step 1: Credentials and SubID intake
- View 1 initializes the SubID credential form via `SPA/js/1.js`, wiring dynamic rows that collect Sub ID, domain, and integration key entries while keeping labels and inputs renumbered after adds or removals.
- Shortcut buttons on this view (Select Apps and Audit All) both persist the currently entered credentials through `setAppCredentials()` and unlock the rest of the navigation so no other steps can load without valid auth inputs.
- Section fetch failures (for example, missing HTML partials or network issues) surface both console errors and user-facing status text without breaking the rest of the shell, keeping the intake step safe to iterate on.

## Step 2: App selection preview
- View 2 (`SPA/js/2.js`) discovers available apps for each SubID by calling `app_names()` and renders them into a selectable preview table. Checkbox states are disabled until credentials exist to avoid stale selections.
- When the app selection preview re-renders, it reapplies any saved checkbox choices before enabling controls so returning to the tab preserves selections while reflecting updated credential fetches. The view also uses an `onShow` hook so refreshed credentials immediately trigger a new preview without forcing a full reload.
- Selection controls keep header toggles, row checkboxes, and a live selection count in sync while enabling the Continue button only after at least one app has been marked for audit.
- The Continue control (`#app-selection-continue-btn`) triggers the page switcher button for view 3 (`#page-switcher-btn-3`), letting users jump straight to the metadata tables after confirming at least one app selection. App selection snapshots (Sub ID, app name, app ID, and selection state) are cached in `SPA/js/2.js` when Continue is clicked so later SPA steps can reuse the chosen state without re-querying the table DOM.

## Step 3: Metadata tables and queues
- View 3 (`SPA/js/3.js`) hydrates four metadata tables (Visitor, Account, Custom, and Salesforce) using the SubID, app name, and app ID rows selected on view 2, falling back to a fresh app name lookup only when no cached selections are available. Metadata table rendering logs unexpected failures and drops a single status row across all four tables so the view never stays blank when upstream lookups fail.
- After the tables render, `SPA/API/metadata.js` builds the next metadata call plan with the same credentials used for app discovery, queues the 7/23/150-day requests for every SubID + App ID row on the page, and runs the full queue in window order while exposing queue controls in the console. Queue executions respect window order so all 7-day calls finish before 23- or 150-day calls start.
- The SubID → App ID `metadataAggregations` cache stores per-window namespace buckets, timeseries starts, and value/count tallies for visitor/account/custom/Salesforce fields so recent metadata distributions can be reviewed from the console without separate app-level rollups. These entries power the SPA metadata tables and exports.
- The same SubID/app/namespace rows are captured in a `tableData` array with "Pending..." lookback placeholders; `populateTables()` seeds it with the current selected apps across every namespace and logs them early in the SPA lifecycle so you can verify the population hook fired before other metadata work begins. `processAPI()` overwrites each row's 7/30/180 buckets with sorted namespace field names merged from the latest 7/23/150-day aggregations (with duplicates removed) only after all buckets required for that window have finished processing so cached table data mirrors the rendered columns without early partials.
- Metadata table refreshes now flow through a single `renderTablesFromData()` helper that maps `tableData` into row templates and appends shared status rows, avoiding per-cell DOM queries or dataset wiring. Lookback columns update whenever `tableData` is modified so the DOM stays aligned with cached state after `processAPI()` finishes updating the cache.
- Console helpers are available while on this view: **`window.tableData`** mirrors SPA view 3 rows with `{ subId, appName, appId, namespace, window7, window30, window180 }` objects for inspection, and **`window.metadataQueue`** queues 7/23/150-day metadata aggregation calls with helper methods (`print()`, `rebuild()`, `inspect()`, `size()`, and `run(limit)`).
- SPA logging favors concise `console.log` statements that echo the executing function name for SPA helpers so you can quickly trace which lifecycle call is running during metadata table loads.

## Step 4: Subscription coverage visualization
- View 4 ships with a Pendo-styled "Subscriptions" card and canvas placeholder to host the first Chart.js visualization when the charting logic is added.
- The subscription progress list reports processed metadata coverage per SubID (`X out of Y`) using `metadataAggregations` app buckets for the numerator and the latest totals cached from `SPA/API/app_names.js` for the denominator so repeated app lookups after adding credentials keep the available-app count in sync.

## Step 5: Follow-up actions
- View 5 (`SPA/html/5.html`) currently serves as a placeholder card for future follow-up actions or exports so the navigation remains consistent while downstream workflows are finalized.

## PDF exports
- Static PDF-ready assets live under `SPA/pdf/`. Use `overview-dashboard.html` with `pdf/pdf.css` for a simple export shell that centers a 72pt "Overview" title at the top of the page.
