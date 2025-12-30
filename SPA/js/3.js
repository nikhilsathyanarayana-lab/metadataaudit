import { app_names } from '../API/app_names.js';
import {
  DEFAULT_LOOKBACK_WINDOW,
  METADATA_NAMESPACES,
  buildMetadataQueue,
  processAggregation,
  runMetadataQueue,
} from '../API/metadata.js';
import { getAppSelections } from './2.js';

const METADATA_TABLE_WINDOWS = [7, 30, 180];
const TABLE_VALUE_KEYS = {
  7: 'window7',
  30: 'window30',
  180: 'window180',
};
export const tableData = [];
let tableStatusRows = [];
let activeTableConfigs = [];

// Return the window bucket for a specific lookback.
const getWindowBucket = (appBucket, lookbackWindow) => {
  return appBucket?.windows?.[String(lookbackWindow)] || appBucket?.windows?.[lookbackWindow];
};

// Collect unique namespace field names from one or more window buckets.
const buildNamespaceFieldSummary = (windowBuckets = []) => {
  return METADATA_NAMESPACES.reduce((summary, namespace) => {
    const combinedFields = windowBuckets.reduce((fieldNames, bucket) => {
      const namespaceBucket = bucket?.namespaces?.[namespace];

      if (namespaceBucket && typeof namespaceBucket === 'object') {
        Object.keys(namespaceBucket).forEach((fieldName) => {
          if (!fieldNames.includes(fieldName)) {
            fieldNames.push(fieldName);
          }
        });
      }

      return fieldNames;
    }, []);

    const uniqueFields = combinedFields.length
      ? [...new Set(combinedFields)].sort((first, second) => first.localeCompare(second))
      : [];

    summary[namespace] = uniqueFields.length ? uniqueFields : null;
    return summary;
  }, {});
};

// Hydrate cached table data with namespace field names as metadata calls finish.
const processAPI = () => {
  const aggregations = getMetadataAggregations();

  if (!aggregations || typeof aggregations !== 'object') {
    return;
  }

  Object.entries(aggregations).forEach(([subId, subBucket]) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return;
    }

    Object.entries(apps).forEach(([appId, appBucket]) => {
      const window7Bucket = getWindowBucket(appBucket, 7);
      const window23Bucket = getWindowBucket(appBucket, 23);
      const window150Bucket = getWindowBucket(appBucket, 150);
      const hasWindow7Data = Boolean(window7Bucket?.isProcessed);
      const hasWindow23Data = Boolean(window23Bucket?.isProcessed);
      const hasWindow150Data = Boolean(window150Bucket?.isProcessed);

      if (!hasWindow7Data && !hasWindow23Data && !hasWindow150Data) {
        return;
      }

      const window7Fields = hasWindow7Data ? buildNamespaceFieldSummary([window7Bucket]) : null;
      const window30Fields = (hasWindow7Data && hasWindow23Data)
        ? buildNamespaceFieldSummary([window7Bucket, window23Bucket])
        : null;
      const window180Fields = (hasWindow7Data && hasWindow23Data && hasWindow150Data)
        ? buildNamespaceFieldSummary([window7Bucket, window23Bucket, window150Bucket])
        : null;

      const normalizedSubId = String(subId || '');
      const normalizedAppId = String(appId || '');

      tableData.forEach((entry) => {
        const matchesSubId = String(entry?.subId || '') === normalizedSubId;
        const matchesAppId = String(entry?.appId || '') === normalizedAppId;
        const namespaceKey = entry?.namespace;

        if (!matchesSubId || !matchesAppId || !namespaceKey) {
          return;
        }

        if (window7Fields && Object.prototype.hasOwnProperty.call(window7Fields, namespaceKey)) {
          entry.window7 = window7Fields[namespaceKey];
        }

        if (window30Fields && Object.prototype.hasOwnProperty.call(window30Fields, namespaceKey)) {
          entry.window30 = window30Fields[namespaceKey];
        }

        if (window180Fields && Object.prototype.hasOwnProperty.call(window180Fields, namespaceKey)) {
          entry.window180 = window180Fields[namespaceKey];
        }
      });
    });
  });

  renderTablesFromData();
};

// Populate an early tableData snapshot and log selected apps for debugging.
const populateTables = () => {
  tableData.length = 0;

  const cachedSelections = getAppSelections();
  const selectedApps = cachedSelections.filter((entry) => entry?.isSelected);

  if (selectedApps.length) {
    selectedApps.forEach((app) => {
      METADATA_NAMESPACES.forEach((namespace) => {
        tableData.push({
          subId: app?.subId || 'Unknown SubID',
          appName: app?.appName || app?.appId || 'Unknown app',
          appId: app?.appId || '',
          namespace,
          window7: 'Pending...',
          window30: 'Pending...',
          window180: 'Pending...',
        });
      });
    });
  }

  // eslint-disable-next-line no-console
  console.log(selectedApps.length ? selectedApps : 'no selected apps');
};

populateTables();

// Expose metadata table cache for console debugging.
const registerTableDataGlobal = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.tableData = tableData;
};

registerTableDataGlobal();

// Convert table cell values from cached table data into readable text.
const formatTableDataValue = (value) => {
  const pendingText = 'Pending...';
  const noDataText = 'No Data';

  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : noDataText;
  }

  if (value === null) {
    return noDataText;
  }

  return value || pendingText;
};

// Return the table data record matching a specific SubID/AppID/namespace.
const findTableDataEntry = ({ subId, appId, namespace }) => {
  const normalizedSubId = String(subId || '');
  const normalizedAppId = String(appId || '');
  const normalizedNamespace = String(namespace || '');

  return tableData.find((entry) => (
    String(entry?.subId || '') === normalizedSubId
    && String(entry?.appId || '') === normalizedAppId
    && String(entry?.namespace || '') === normalizedNamespace
  ));
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
  const valueKey = TABLE_VALUE_KEYS[lookbackWindow];
  const tableEntry = valueKey ? findTableDataEntry({ subId: targetSubId, appId: targetAppId, namespace }) : null;

  if (!valueKey || !tableEntry) {
    return;
  }

  const tableValue = formatTableDataValue(tableEntry[valueKey]);

  const applyFieldNames = (target) => {
    if (
      target.dataset.namespace === targetNamespace
      && target.dataset.subId === targetSubId
      && target.dataset.appId === targetAppId
    ) {
      target.textContent = tableValue;
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
    const valueKey = TABLE_VALUE_KEYS[lookbackWindow];
    const tableEntry = valueKey
      ? findTableDataEntry({ subId, appId, namespace })
      : null;
    valueTarget.textContent = formatTableDataValue(tableEntry?.[valueKey]);

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

// Append shared status rows across all metadata tables.
const addStatusRowForAllTables = (message, columnCount = 6, subId = '') => {
  tableStatusRows.push({ message, columnCount, subId });
};

// Render every metadata table with the latest cached table data.
const renderTablesFromData = () => {
  if (!activeTableConfigs.length) {
    return;
  }

  activeTableConfigs.forEach(({ namespace, element }) => {
    if (!element) {
      return;
    }

    element.innerHTML = '';
    const rowsForNamespace = tableData.filter((entry) => entry?.namespace === namespace);

    if (!rowsForNamespace.length && !tableStatusRows.length) {
      element.appendChild(createMetadataStatusRow('No metadata rows available.'));
      return;
    }

    rowsForNamespace.forEach((rowData) => {
      element.appendChild(createMetadataRow(rowData));
    });

    tableStatusRows.forEach(({ message, columnCount, subId }) => {
      element.appendChild(createMetadataStatusRow(message, columnCount, subId));
    });
  });
};

// Render the metadata tables for each credential.
const renderMetadataTables = async (tableConfigs) => {
  // eslint-disable-next-line no-console
  console.log('renderMetadataTables');

  if (!Array.isArray(tableConfigs) || !tableConfigs.length) {
    return;
  }

  tableData.length = 0;
  tableStatusRows = [];
  activeTableConfigs = tableConfigs;

  const recordTableDataRow = ({ subId, appId, appName, namespace }) => {
    tableData.push({
      subId: subId || 'Unknown SubID',
      appName: appName || appId || 'Unknown app',
      appId: appId || '',
      namespace: namespace || '',
      window7: 'Pending...',
      window30: 'Pending...',
      window180: 'Pending...',
    });
  };

  try {
    const cachedSelections = getAppSelections();
    const selectedApps = cachedSelections.filter((entry) => entry?.isSelected);
    let appsForMetadata = [];

    if (selectedApps.length) {
      selectedApps.forEach((app) => {
        METADATA_NAMESPACES.forEach((namespace) => {
          recordTableDataRow({
            subId: app?.subId,
            appId: app?.appId,
            appName: app?.appName,
            namespace,
          });
        });
      });
      renderTablesFromData();
      appsForMetadata = selectedApps;
      await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
      await runMetadataQueue((payload) => {
        processAggregation(payload);
        processAPI();
      }, DEFAULT_LOOKBACK_WINDOW);
      return;
    }

    if (cachedSelections.length) {
      addStatusRowForAllTables('No apps selected for metadata tables.');
      renderTablesFromData();
      return;
    }

    const credentialResults = await app_names();

    if (!credentialResults.length) {
      addStatusRowForAllTables('No credentials available for app discovery.');
      renderTablesFromData();
      return;
    }

    credentialResults.forEach((result) => {
      const subId = result?.credential?.subId;

      if (result?.errorType || !Array.isArray(result?.results)) {
        const errorHint = result?.errorHint ? `: ${result.errorHint}` : '';
        addStatusRowForAllTables(`Unable to load apps for ${subId || 'unknown SubID'}${errorHint}`);
        return;
      }

      if (!result.results.length) {
        addStatusRowForAllTables('No apps returned for SubID.', 6, subId);
        return;
      }

      result.results.forEach((app) => {
        METADATA_NAMESPACES.forEach((namespace) => {
          recordTableDataRow({
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

    renderTablesFromData();

    if (appsForMetadata.length) {
      await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
      await runMetadataQueue((payload) => {
        processAggregation(payload);
        processAPI();
      }, DEFAULT_LOOKBACK_WINDOW);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[renderMetadataTables] Unable to load metadata tables.', error);
    addStatusRowForAllTables('Unable to load metadata tables. Please try again.');
    renderTablesFromData();
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
