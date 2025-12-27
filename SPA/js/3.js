import { app_names } from '../API/app_names.js';
import { buildMetadataCallPlan, executeMetadataCallPlan } from '../API/metadata.js';
import { getAppSelections } from './2.js';

const DEFAULT_LOOKBACK_WINDOW = 7;
let metadataCallQueue = [];
let lastDiscoveredApps = [];
const METADATA_NAMESPACES = ['visitor', 'account', 'custom', 'salesforce'];
const metadataAggregations = {};

// Ensure a namespace bucket exists for a SubID + App ID combination.
const getAppAggregationBucket = (subId, appId, appName) => {
  if (!metadataAggregations[subId]) {
    metadataAggregations[subId] = { apps: {} };
  }

  const appBuckets = metadataAggregations[subId].apps;

  if (!appBuckets[appId]) {
    appBuckets[appId] = {
      appId,
      appName,
      timeseriesStart: null,
      lookbackWindow: DEFAULT_LOOKBACK_WINDOW,
      namespaces: METADATA_NAMESPACES.reduce((accumulator, key) => ({ ...accumulator, [key]: {} }), {}),
    };
  }

  return appBuckets[appId];
};

// Normalize a metadata value to an array of string tokens for counting.
const normalizeFieldValues = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFieldValues(entry)).flat();
  }

  if (value && typeof value === 'object') {
    return [JSON.stringify(value)];
  }

  if (value === null) {
    return ['null'];
  }

  if (typeof value === 'undefined') {
    return ['undefined'];
  }

  return [`${value}`];
};

// Increment counts for each value within a field bucket.
const trackFieldValues = (namespaceBucket, fieldName, rawValue) => {
  const values = normalizeFieldValues(rawValue);

  if (!namespaceBucket[fieldName]) {
    namespaceBucket[fieldName] = { values: {}, total: 0 };
  }

  values.forEach((value) => {
    namespaceBucket[fieldName].values[value] = (namespaceBucket[fieldName].values[value] || 0) + 1;
    namespaceBucket[fieldName].total += 1;
  });
};

// Tally visitor/account/custom/Salesforce fields for a single aggregation result.
const tallyAggregationResult = (result, appBucket) => {
  METADATA_NAMESPACES.forEach((namespaceKey) => {
    const namespaceData = result?.[namespaceKey];

    if (!namespaceData || typeof namespaceData !== 'object') {
      return;
    }

    Object.entries(namespaceData).forEach(([fieldName, value]) => {
      trackFieldValues(appBucket.namespaces[namespaceKey], fieldName, value);
    });
  });
};

// Log and summarize each aggregated metadata response while the queue runs.
const processAggregation = ({ app, lookbackWindow, response }) => {
  const subId = app?.subId || 'unknown-subid';
  const appId = app?.appId || 'unknown-appid';
  const appName = app?.appName || appId || 'unknown-app';
  const aggregationResults = Array.isArray(response?.results) ? response.results : [];
  const appBucket = getAppAggregationBucket(subId, appId, appName);

  appBucket.appName = appName;
  appBucket.lookbackWindow = lookbackWindow;
  appBucket.timeseriesStart = response?.startTime || appBucket.timeseriesStart;

  aggregationResults.forEach((result) => {
    tallyAggregationResult(result, appBucket);
  });

  if (typeof window !== 'undefined') {
    window.metadataAggregations = metadataAggregations;
  }

  // eslint-disable-next-line no-console
  console.log('[Metadata Aggregation]', {
    appId,
    appName,
    lookbackWindow,
    subId,
    timeseriesStart: appBucket.timeseriesStart,
    totalResults: aggregationResults.length,
  });
};

// Build a visitor metadata row showing SubID and app details.
const createVisitorMetadataRow = ({ subId, appId, appName }) => {
  const row = document.createElement('tr');

  // Build a single table cell with supplied text.
  const buildCell = (text = '') => {
    const cell = document.createElement('td');
    cell.textContent = text;
    return cell;
  };

  row.append(
    buildCell(subId || 'Unknown SubID'),
    buildCell(appName || appId || 'Unknown app'),
    buildCell(appId || ''),
    buildCell('—'),
    buildCell('—'),
    buildCell('—'),
  );

  return row;
};

// Build a status row spanning the visitor metadata columns.
const createStatusRow = (message, columnCount = 6, subId = '') => {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.textContent = subId ? `${message} (${subId})` : message;
  row.appendChild(cell);
  return row;
};

// Render the metadata tables for each credential.
const renderMetadataTables = async (tableBodies) => {
  if (!Array.isArray(tableBodies) || !tableBodies.length) {
    return;
  }

  tableBodies.forEach((tableBody) => {
    if (tableBody) {
      tableBody.innerHTML = '';
    }
  });

  const appendToAllTables = (buildRow) => {
    tableBodies.forEach((tableBody) => {
      if (tableBody) {
        const row = buildRow();
        tableBody.appendChild(row);
      }
    });
  };

  const cachedSelections = getAppSelections();
  const selectedApps = cachedSelections.filter((entry) => entry?.isSelected);
  let appsForMetadata = [];

  // Build the metadata call queue with the latest discoveries and track them for reuse.
  const buildMetadataQueue = async (entries) => {
    metadataCallQueue = await buildMetadataCallPlan(entries, DEFAULT_LOOKBACK_WINDOW);
    lastDiscoveredApps = entries;

    // eslint-disable-next-line no-console
    console.log('[Metadata Queue] Ready', {
      count: metadataCallQueue.length,
      lookbackWindow: DEFAULT_LOOKBACK_WINDOW,
    });
  };

  // Execute queued metadata calls with an optional limit to throttle requests.
  const runMetadataQueue = async (limit = metadataCallQueue.length) => {
    if (!metadataCallQueue.length) {
      // eslint-disable-next-line no-console
      console.warn('[Metadata Queue] No queued metadata calls to run.');
      return [];
    }

    const plannedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
      ? Number(limit)
      : metadataCallQueue.length;

    return executeMetadataCallPlan(
      metadataCallQueue,
      DEFAULT_LOOKBACK_WINDOW,
      processAggregation,
      plannedLimit,
    );
  };

  // Expose helpers for inspecting and rerunning the metadata queue via the console.
  const registerConsoleHelpers = () => {
    if (typeof window === 'undefined') {
      return;
    }

    // Print the queued metadata calls to the console for quick inspection.
    const printQueue = () => {
      const entries = metadataCallQueue.map((entry, index) => ({
        index,
        subId: entry?.credential?.subId || entry?.app?.subId,
        appId: entry?.app?.appId,
        appName: entry?.app?.appName,
      }));

      // eslint-disable-next-line no-console
      console.table(entries);

      return entries;
    };

    window.metadataQueue = {
      inspect: () => metadataCallQueue.map((entry, index) => ({
        index,
        subId: entry?.credential?.subId || entry?.app?.subId,
        appId: entry?.app?.appId,
        appName: entry?.app?.appName,
      })),
      print: () => printQueue(),
      rebuild: () => buildMetadataQueue(lastDiscoveredApps),
      run: (limit) => runMetadataQueue(limit),
      size: () => metadataCallQueue.length,
    };
  };

  if (selectedApps.length) {
    selectedApps.forEach((app) => {
      appendToAllTables(() => createVisitorMetadataRow({
        subId: app?.subId,
        appId: app?.appId,
        appName: app?.appName,
      }));
    });
    appsForMetadata = selectedApps;
    await buildMetadataQueue(appsForMetadata);
    registerConsoleHelpers();
    await runMetadataQueue();
    return;
  }

  if (cachedSelections.length) {
    appendToAllTables(() => createStatusRow('No apps selected for metadata tables.'));
    return;
  }

  const credentialResults = await app_names();

  if (!credentialResults.length) {
    appendToAllTables(() => createStatusRow('No credentials available for app discovery.'));
    return;
  }

  credentialResults.forEach((result) => {
    const subId = result?.credential?.subId;

    if (result?.errorType || !Array.isArray(result?.results)) {
      const errorHint = result?.errorHint ? `: ${result.errorHint}` : '';
      appendToAllTables(() => createStatusRow(
        `Unable to load apps for ${subId || 'unknown SubID'}${errorHint}`,
      ));
      return;
    }

    if (!result.results.length) {
      appendToAllTables(() => createStatusRow('No apps returned for SubID.', 6, subId));
      return;
    }

    result.results.forEach((app) => {
      appendToAllTables(() => createVisitorMetadataRow({
        subId,
        appId: app?.appId,
        appName: app?.appName,
      }));
      appsForMetadata.push({
        subId,
        appId: app?.appId,
        appName: app?.appName,
      });
    });
  });

  if (appsForMetadata.length) {
    await buildMetadataQueue(appsForMetadata);
    registerConsoleHelpers();
    await runMetadataQueue();
  }
};

// Populate metadata tables with discovered apps.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  const tableBodies = [
    '#visitor-metadata-table-body',
    '#account-metadata-table-body',
    '#custom-metadata-table-body',
    '#salesforce-metadata-table-body',
  ]
    .map((selector) => sectionRoot?.querySelector(selector))
    .filter(Boolean);

  if (!tableBodies.length) {
    return;
  }

  await renderMetadataTables(tableBodies);
}
