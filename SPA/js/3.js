import { app_names } from '../API/app_names.js';
import {
  DEFAULT_LOOKBACK_WINDOW,
  METADATA_NAMESPACES,
  buildMetadataQueue,
  getMetadataQueue,
  getMetadataFields,
  processAggregation,
  rebuildMetadataQueue,
  runMetadataQueue,
} from '../API/metadata.js';
import { getAppSelections } from './2.js';

const METADATA_TABLE_WINDOWS = [7, 23, 150];

// Read metadata aggregations from the browser when available.
const getMetadataAggregations = () => {
  return typeof window !== 'undefined'
    ? window.metadataAggregations || {}
    : {};
};

// Calculate the metadata value shown in the table for a given SubID, app, namespace, and window.
const getMetadataAggregationValue = ({ subId, appId, namespace, lookbackWindow }) => {
  if (!subId || !appId || !namespace) {
    return '—';
  }

  const aggregations = getMetadataAggregations();
  const appBucket = aggregations?.[subId]?.apps?.[appId];

  if (!appBucket || Number(appBucket.lookbackWindow) !== Number(lookbackWindow)) {
    return '—';
  }

  const namespaceBucket = appBucket?.namespaces?.[namespace];

  if (!namespaceBucket || typeof namespaceBucket !== 'object') {
    return '—';
  }

  const totalValues = Object.values(namespaceBucket).reduce(
    (total, fieldStats) => total + (fieldStats?.total || 0),
    0,
  );

  return Number.isFinite(totalValues) ? `${totalValues}` : '—';
};

// Stamp the 7-day lookback cell for a specific SubID/AppID/namespace row.
export const calculateMetadataTableValue = ({
  subId,
  appId,
  namespace,
  lookbackWindow = 7,
  valueTarget,
}) => {
  // eslint-disable-next-line no-console
  console.log('calculateMetadataTableValue');

  if (typeof document === 'undefined' || !subId || !appId || !namespace) {
    return;
  }

  const targetNamespace = String(namespace);
  const targetSubId = String(subId);
  const targetAppId = String(appId);

  const applyFieldNames = (target) => {
    if (
      target.dataset.namespace === targetNamespace
      && target.dataset.subId === targetSubId
      && target.dataset.appId === targetAppId
    ) {
      const fieldNames = getMetadataFields(targetSubId, targetAppId, targetNamespace);
      const placeholder = 'No metadata fields found';

      target.textContent = fieldNames.length ? fieldNames.join(', ') : placeholder;
    }
  };

  if (valueTarget) {
    applyFieldNames(valueTarget);
    return;
  }

  const targets = document.querySelectorAll(`[data-value-window="${lookbackWindow}"]`);

  targets.forEach((target) => {
    applyFieldNames(target);
  });
};

// Build a metadata row showing SubID and app details for each table.
const createMetadataRow = ({ subId, appId, appName, namespace }) => {
  const row = document.createElement('tr');
  row.dataset.subId = subId || '';
  row.dataset.appId = appId || '';
  row.dataset.namespace = namespace || '';

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
  );

  const buildValueCell = (lookbackWindow) => {
    const valueCell = document.createElement('td');
    valueCell.dataset.window = lookbackWindow;

    const valueTarget = document.createElement('span');
    valueTarget.dataset.valueWindow = lookbackWindow;
    valueTarget.dataset.subId = subId || '';
    valueTarget.dataset.appId = appId || '';
    valueTarget.dataset.namespace = namespace || '';
    valueTarget.textContent = getMetadataAggregationValue({
      subId,
      appId,
      namespace,
      lookbackWindow,
    });

    valueCell.appendChild(valueTarget);

    return valueCell;
  };

  METADATA_TABLE_WINDOWS.forEach((lookbackWindow) => {
    row.appendChild(buildValueCell(lookbackWindow));
  });

  return row;
};

// Build a status row spanning the metadata table columns.
const createMetadataStatusRow = (message, columnCount = 6, subId = '') => {
  // eslint-disable-next-line no-console
  console.log('createMetadataStatusRow');

  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.textContent = subId ? `${message} (${subId})` : message;
  row.appendChild(cell);
  return row;
};

// Render the metadata tables for each credential.
const renderMetadataTables = async (tableConfigs) => {
  // eslint-disable-next-line no-console
  console.log('renderMetadataTables');

  if (!Array.isArray(tableConfigs) || !tableConfigs.length) {
    return;
  }

  tableConfigs.forEach(({ element }) => {
    if (element) {
      element.innerHTML = '';
    }
  });

  const appendToAllTables = (buildRow) => {
    // eslint-disable-next-line no-console
    console.log('appendToAllTables');

    tableConfigs.forEach(({ namespace, element }) => {
      if (element) {
        const row = buildRow(namespace);
        element.appendChild(row);
      }
    });
  };

  // Recalculate table cells using the latest aggregation summaries.
  const refreshTableValues = ({ targetSubId = '', targetAppId = '' } = {}) => {
    // eslint-disable-next-line no-console
    console.log('refreshTableValues');

    tableConfigs.forEach(({ namespace, element }) => {
      element?.querySelectorAll('tr').forEach((row) => {
        const rowSubId = row.dataset.subId;
        const rowAppId = row.dataset.appId;

        if (targetSubId && rowSubId !== targetSubId) {
          return;
        }

        if (targetAppId && rowAppId !== targetAppId) {
          return;
        }

        row.querySelectorAll('[data-value-window]').forEach((target) => {
          const lookbackWindow = Number(target.dataset.valueWindow);

          if (lookbackWindow === 7) {
            calculateMetadataTableValue({
              subId: rowSubId,
              appId: rowAppId,
              namespace,
              lookbackWindow,
              valueTarget: target,
            });
            return;
          }

          target.textContent = getMetadataAggregationValue({
            subId: rowSubId,
            appId: rowAppId,
            namespace,
            lookbackWindow,
          });
        });
      });
    });
  };

  // Refresh aggregation and seven-day columns across all metadata tables.
  const refreshAllTables = (targetAppContext = {}) => {
    const { appId: targetAppId = '', subId: targetSubId = '' } = targetAppContext;

    refreshTableValues({ targetAppId, targetSubId });
  };

  const cachedSelections = getAppSelections();
  const selectedApps = cachedSelections.filter((entry) => entry?.isSelected);
  let appsForMetadata = [];

  // Expose helpers for inspecting and rerunning the metadata queue via the console.
  const registerConsoleHelpers = () => {
    // eslint-disable-next-line no-console
    console.log('registerConsoleHelpers');

    if (typeof window === 'undefined') {
      return;
    }

    // Print the queued metadata calls to the console for quick inspection.
    const inspectQueue = () => {
      // eslint-disable-next-line no-console
      console.log('inspectQueue');

      return getMetadataQueue().map((entry, index) => ({
        index,
        subId: entry?.credential?.subId || entry?.app?.subId,
        appId: entry?.app?.appId,
        appName: entry?.app?.appName,
      }));
    };

    const printQueue = () => {
      // eslint-disable-next-line no-console
      console.log('printQueue');

      const entries = inspectQueue();

      // eslint-disable-next-line no-console
      console.table(entries);

      return entries;
    };

    window.metadataQueue = {
      inspect: () => inspectQueue(),
      print: () => printQueue(),
      rebuild: () => rebuildMetadataQueue(DEFAULT_LOOKBACK_WINDOW),
      run: (limit) => runMetadataQueue((payload) => {
        processAggregation(payload);
        refreshAllTables(payload?.app);
      }, DEFAULT_LOOKBACK_WINDOW, limit),
      size: () => getMetadataQueue().length,
    };
  };

  if (selectedApps.length) {
    selectedApps.forEach((app) => {
      appendToAllTables((namespace) => createMetadataRow({
        subId: app?.subId,
        appId: app?.appId,
        appName: app?.appName,
        namespace,
      }));
    });
    appsForMetadata = selectedApps;
    await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
    registerConsoleHelpers();
    await runMetadataQueue((payload) => {
      processAggregation(payload);
      refreshAllTables(payload?.app);
    }, DEFAULT_LOOKBACK_WINDOW);
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
      appendToAllTables((namespace) => createMetadataRow({
        subId,
        appId: app?.appId,
        appName: app?.appName,
        namespace,
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
    await runMetadataQueue((payload) => {
      processAggregation(payload);
      refreshAllTables(payload?.app);
    }, DEFAULT_LOOKBACK_WINDOW);
  }
};

// Populate metadata tables with discovered apps.
export async function initSection(sectionRoot) {
  // eslint-disable-next-line no-console
  console.log('initSection');

  if (!sectionRoot) {
    return;
  }

  const tableConfigs = METADATA_NAMESPACES
    .map((namespace) => ({
      namespace,
      element: sectionRoot?.querySelector(`#${namespace}-metadata-table-body`),
    }))
    .filter(({ element }) => Boolean(element));

  if (!tableConfigs.length) {
    return;
  }

  await renderMetadataTables(tableConfigs);
}
