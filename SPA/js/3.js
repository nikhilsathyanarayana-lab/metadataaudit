import { app_names } from '../API/app_names.js';
import { buildMetadataCallPlan, executeMetadataCallPlan } from '../API/metadata.js';
import { getAppSelections } from './2.js';

const DEFAULT_LOOKBACK_WINDOW = 7;
const DEFAULT_METADATA_QUEUE_LIMIT = 3;
let metadataCallQueue = [];
let lastDiscoveredApps = [];

const processAggregation = ({ app, lookbackWindow }) => {
  const appId = app?.appId || 'unknown';
  const appName = app?.appName || appId || 'unknown';

  // eslint-disable-next-line no-console
  console.log('[Metadata Aggregation]', { appId, appName, lookbackWindow });
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

  const buildMetadataQueue = async (entries) => {
    metadataCallQueue = await buildMetadataCallPlan(entries, DEFAULT_LOOKBACK_WINDOW);
    lastDiscoveredApps = entries;

    // eslint-disable-next-line no-console
    console.log('[Metadata Queue] Ready', {
      count: metadataCallQueue.length,
      lookbackWindow: DEFAULT_LOOKBACK_WINDOW,
    });
  };

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

  const registerConsoleHelpers = () => {
    if (typeof window === 'undefined') {
      return;
    }

    window.metadataQueue = {
      inspect: () => metadataCallQueue.map((entry, index) => ({
        index,
        subId: entry?.credential?.subId || entry?.app?.subId,
        appId: entry?.app?.appId,
        appName: entry?.app?.appName,
      })),
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
    await runMetadataQueue(DEFAULT_METADATA_QUEUE_LIMIT);
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
    await runMetadataQueue(DEFAULT_METADATA_QUEUE_LIMIT);
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
