import { app_names } from '../API/app_names.js';
import {
  DEFAULT_LOOKBACK_WINDOW,
  buildMetadataQueue,
  getMetadataQueue,
  rebuildMetadataQueue,
  runMetadataQueue,
  tallyAggregationResult,
} from '../API/metadata.js';
import { getAppSelections } from './2.js';

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
    tallyAggregationResult(appBucket.namespaces, result, METADATA_NAMESPACES);
  });

  if (typeof window !== 'undefined') {
    window.metadataAggregations = metadataAggregations;
  }

  // eslint-disable-next-line no-console
  console.log('[processAggregation]', {
    appId,
    appName,
    lookbackWindow,
    subId,
    timeseriesStart: appBucket.timeseriesStart,
    totalResults: aggregationResults.length,
  });
};

// Build a metadata row showing SubID and app details for each table.
const createMetadataRow = ({ subId, appId, appName }) => {
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

// Build a status row spanning the metadata table columns.
const createMetadataStatusRow = (message, columnCount = 6, subId = '') => {
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

  // Expose helpers for inspecting and rerunning the metadata queue via the console.
  const registerConsoleHelpers = () => {
    if (typeof window === 'undefined') {
      return;
    }

    // Print the queued metadata calls to the console for quick inspection.
    const inspectQueue = () => getMetadataQueue().map((entry, index) => ({
        index,
        subId: entry?.credential?.subId || entry?.app?.subId,
        appId: entry?.app?.appId,
        appName: entry?.app?.appName,
      }));

    const printQueue = () => {
      const entries = inspectQueue();

      // eslint-disable-next-line no-console
      console.table(entries);

      return entries;
    };

    window.metadataQueue = {
      inspect: () => inspectQueue(),
      print: () => printQueue(),
      rebuild: () => rebuildMetadataQueue(DEFAULT_LOOKBACK_WINDOW),
      run: (limit) => runMetadataQueue(processAggregation, DEFAULT_LOOKBACK_WINDOW, limit),
      size: () => getMetadataQueue().length,
    };
  };

  if (selectedApps.length) {
    selectedApps.forEach((app) => {
      appendToAllTables(() => createMetadataRow({
        subId: app?.subId,
        appId: app?.appId,
        appName: app?.appName,
      }));
    });
    appsForMetadata = selectedApps;
    await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
    registerConsoleHelpers();
    await runMetadataQueue(processAggregation, DEFAULT_LOOKBACK_WINDOW);
    return;
  }

  if (cachedSelections.length) {
    appendToAllTables(() => createMetadataStatusRow('No apps selected for metadata tables.'));
    return;
  }

  const credentialResults = await app_names();

  if (!credentialResults.length) {
    appendToAllTables(() => createMetadataStatusRow('No credentials available for app discovery.'));
    return;
  }

  credentialResults.forEach((result) => {
    const subId = result?.credential?.subId;

    if (result?.errorType || !Array.isArray(result?.results)) {
      const errorHint = result?.errorHint ? `: ${result.errorHint}` : '';
      appendToAllTables(() => createMetadataStatusRow(
        `Unable to load apps for ${subId || 'unknown SubID'}${errorHint}`,
      ));
      return;
    }

    if (!result.results.length) {
      appendToAllTables(() => createMetadataStatusRow('No apps returned for SubID.', 6, subId));
      return;
    }

    result.results.forEach((app) => {
      appendToAllTables(() => createMetadataRow({
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
    await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
    registerConsoleHelpers();
    await runMetadataQueue(processAggregation, DEFAULT_LOOKBACK_WINDOW);
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
