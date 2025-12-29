import { app_names } from '../API/app_names.js';
import {
  DEFAULT_LOOKBACK_WINDOW,
  METADATA_NAMESPACES,
  buildMetadataQueue,
  resolvePreferredWindowBucket,
  processAggregation,
  runMetadataQueue,
} from '../API/metadata.js';
import { getAppSelections } from './2.js';

const METADATA_TABLE_WINDOWS = [7, 30, 180];
export const tableData = [];

// Format field names or fallback text for metadata table cells.
const formatFieldNames = ({ fieldNames = [], isProcessed = false } = {}) => {
  const placeholder = 'Pending...';
  const noDataText = 'No Data';

  return Array.isArray(fieldNames) && fieldNames.length
    ? fieldNames.join(', ')
    : (isProcessed ? noDataText : placeholder);
};

// Return sorted field names and processing status for a specific lookback bucket.
const getWindowMetadataState = ({ subId, appId, namespace, lookbackWindow }) => {
  const defaultState = { fieldNames: [], isProcessed: false };

  if (!subId || !appId || !namespace) {
    return defaultState;
  }

  const aggregations = getMetadataAggregations();
  const appBucket = aggregations?.[subId]?.apps?.[appId];

  if (!appBucket) {
    return defaultState;
  }

  const preferredWindowBucket = resolvePreferredWindowBucket(appBucket, lookbackWindow);
  const namespaceBucket = preferredWindowBucket?.namespaces?.[namespace];
  const fieldNames = namespaceBucket && typeof namespaceBucket === 'object'
    ? Object.keys(namespaceBucket).sort((first, second) => first.localeCompare(second))
    : [];

  return {
    fieldNames,
    isProcessed: Boolean(preferredWindowBucket?.isProcessed),
  };
};

// Read metadata aggregations from the browser when available.
const getMetadataAggregations = () => {
  return typeof window !== 'undefined'
    ? window.metadataAggregations || {}
    : {};
};

// Stamp the lookback cell for a specific SubID/AppID/namespace row.
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
      const { fieldNames, isProcessed } = getWindowMetadataState({
        subId: targetSubId,
        appId: targetAppId,
        namespace: targetNamespace,
        lookbackWindow,
      });
      target.textContent = formatFieldNames({ fieldNames, isProcessed });
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
    const { fieldNames, isProcessed } = getWindowMetadataState({
      subId,
      appId,
      namespace,
      lookbackWindow,
    });
    valueTarget.textContent = formatFieldNames({ fieldNames, isProcessed });

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

  tableData.length = 0;

  const recordTableDataRow = ({ subId, appId, appName, namespace }) => {
    tableData.push({
      subId: subId || 'Unknown SubID',
      appName: appName || appId || 'Unknown app',
      appId: appId || '',
      namespace: namespace || '',
      sevenDay: 'Pending...',
      thirtyDay: 'Pending...',
      oneEightyDay: 'Pending...',
    });
  };

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

  // Add a shared status row to every metadata table when an error occurs.
  const appendErrorRow = (message) => {
    appendToAllTables(() => createMetadataStatusRow(message));
  };

  try {
    tableConfigs.forEach(({ element }) => {
      if (element) {
        element.innerHTML = '';
      }
    });

    // Recalculate table cells using the latest aggregation summaries.
    const refreshTableValues = ({ targetSubId = '', targetAppId = '' } = {}) => {
      // eslint-disable-next-line no-console
      console.log('refreshTableValues');

      const normalizedTargetSubId = String(targetSubId || '');
      const normalizedTargetAppId = String(targetAppId || '');

      tableConfigs.forEach(({ namespace, element }) => {
        element?.querySelectorAll('tr').forEach((row) => {
          const rowSubId = String(row.dataset.subId || '');
          const rowAppId = String(row.dataset.appId || '');

          if (normalizedTargetSubId && rowSubId !== normalizedTargetSubId) {
            return;
          }

          if (normalizedTargetAppId && rowAppId !== normalizedTargetAppId) {
            return;
          }

          row.querySelectorAll('[data-value-window]').forEach((target) => {
            const lookbackWindow = Number(target.dataset.valueWindow);

            calculateMetadataTableValue({
              subId: rowSubId,
              appId: rowAppId,
              namespace,
              lookbackWindow,
              valueTarget: target,
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

    if (selectedApps.length) {
      selectedApps.forEach((app) => {
        appendToAllTables((namespace) => {
          recordTableDataRow({
            subId: app?.subId,
            appId: app?.appId,
            appName: app?.appName,
            namespace,
          });

          return createMetadataRow({
            subId: app?.subId,
            appId: app?.appId,
            appName: app?.appName,
            namespace,
          });
        });
      });
      appsForMetadata = selectedApps;
      await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
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
        appendToAllTables((namespace) => {
          recordTableDataRow({
            subId,
            appId: app?.appId,
            appName: app?.appName,
            namespace,
          });

          return createMetadataRow({
            subId,
            appId: app?.appId,
            appName: app?.appName,
            namespace,
          });
        });
        appsForMetadata.push({
          subId,
          appId: app?.appId,
          appName: app?.appName,
        });
      });
    });

    if (appsForMetadata.length) {
      await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
      await runMetadataQueue((payload) => {
        processAggregation(payload);
        refreshAllTables(payload?.app);
      }, DEFAULT_LOOKBACK_WINDOW);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[renderMetadataTables] Unable to load metadata tables.', error);
    appendErrorRow('Unable to load metadata tables. Please try again.');
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
