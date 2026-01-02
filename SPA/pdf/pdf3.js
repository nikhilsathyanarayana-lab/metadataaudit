const METADATA_NAMESPACES = ['visitor', 'account', 'custom', 'salesforce'];

// Confirm that cached metadata aggregations are available on the window.
const hasMetadataAggregations = () => (
  typeof window !== 'undefined'
    && window.metadataAggregations
    && typeof window.metadataAggregations === 'object'
);

// Return the requested window bucket from an app aggregation bucket.
const getWindowBucket = (appBucket, lookbackWindow) => (
  appBucket?.windows?.[lookbackWindow] || appBucket?.windows?.[String(lookbackWindow)]
);

// Build namespace-to-field arrays from the provided window buckets.
const buildNamespaceFieldSummary = (windowBuckets = []) => METADATA_NAMESPACES.reduce((summary, namespace) => {
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

  summary[namespace] = combinedFields.length
    ? [...new Set(combinedFields)].sort((first, second) => first.localeCompare(second))
    : null;
  return summary;
}, {});

// Collect 7/30/180-day field lists for a single app bucket.
const buildWindowSummaries = (appBucket) => {
  const window7Bucket = getWindowBucket(appBucket, 7);
  const window23Bucket = getWindowBucket(appBucket, 23);
  const window150Bucket = getWindowBucket(appBucket, 150);
  const hasWindow7Data = Boolean(window7Bucket?.isProcessed);
  const hasWindow23Data = Boolean(window23Bucket?.isProcessed);
  const hasWindow150Data = Boolean(window150Bucket?.isProcessed);

  const window7Fields = hasWindow7Data ? buildNamespaceFieldSummary([window7Bucket]) : null;
  const window30Fields = (hasWindow7Data && hasWindow23Data)
    ? buildNamespaceFieldSummary([window7Bucket, window23Bucket])
    : null;
  const window180Fields = (hasWindow7Data && hasWindow23Data && hasWindow150Data)
    ? buildNamespaceFieldSummary([window7Bucket, window23Bucket, window150Bucket])
    : null;

  return {
    window7: window7Fields,
    window30: window30Fields,
    window180: window180Fields,
  };
};

// Convert metadata aggregations into namespace-specific row collections.
const mapAggregationsToRows = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const rowsByNamespace = METADATA_NAMESPACES.reduce((rows, namespace) => ({
    ...rows,
    [namespace]: [],
  }), {});

  if (!aggregations || typeof aggregations !== 'object') {
    return rowsByNamespace;
  }

  Object.entries(aggregations).forEach(([subId, subBucket]) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return;
    }

    Object.entries(apps).forEach(([appId, appBucket]) => {
      const windowSummaries = buildWindowSummaries(appBucket);
      const subLabel = subId || 'Unknown SubID';
      const appLabel = appBucket?.appName || appId || 'Unknown app';

      METADATA_NAMESPACES.forEach((namespace) => {
        rowsByNamespace[namespace].push({
          subId: subLabel,
          appName: appLabel,
          appId: appId || '',
          window7: windowSummaries.window7?.[namespace] || null,
          window30: windowSummaries.window30?.[namespace] || null,
          window180: windowSummaries.window180?.[namespace] || null,
        });
      });
    });
  });

  METADATA_NAMESPACES.forEach((namespace) => {
    rowsByNamespace[namespace].sort((first, second) => first.subId.localeCompare(second.subId)
      || first.appName.localeCompare(second.appName)
      || first.appId.localeCompare(second.appId));
  });

  return rowsByNamespace;
};

// Convert a field list into a printable string.
const formatFieldList = (fields) => {
  if (!fields) {
    return '—';
  }

  if (Array.isArray(fields) && fields.length === 0) {
    return 'None';
  }

  if (Array.isArray(fields)) {
    return fields.join(', ');
  }

  return String(fields);
};

// Render a namespace table body with the provided row data.
const renderTableRows = (namespace, rows = []) => {
  const tableBody = document.getElementById(`${namespace}-metadata-body`);

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (!rows.length) {
    const emptyRow = document.createElement('tr');
    emptyRow.id = `${namespace}-metadata-empty-row`;
    emptyRow.className = 'metadata-row metadata-row--empty';
    const emptyCell = document.createElement('td');
    emptyCell.id = `${namespace}-metadata-empty-cell`;
    emptyCell.className = 'metadata-cell metadata-cell--empty';
    emptyCell.colSpan = 6;
    emptyCell.textContent = 'No metadata available yet. Keep the scan running to populate this table.';
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    return;
  }

  rows.forEach((row, index) => {
    const rowNumber = String(index + 1).padStart(2, '0');
    const tableRow = document.createElement('tr');
    tableRow.id = `${namespace}-metadata-row-${rowNumber}`;
    tableRow.className = 'metadata-row';

    const subCell = document.createElement('td');
    subCell.id = `${namespace}-cell-sub-${rowNumber}`;
    subCell.className = 'metadata-cell metadata-cell--subid';
    subCell.textContent = row.subId || '';

    const appNameCell = document.createElement('td');
    appNameCell.id = `${namespace}-cell-app-name-${rowNumber}`;
    appNameCell.className = 'metadata-cell metadata-cell--app-name';
    appNameCell.textContent = row.appName || '';

    const appIdCell = document.createElement('td');
    appIdCell.id = `${namespace}-cell-app-id-${rowNumber}`;
    appIdCell.className = 'metadata-cell metadata-cell--app-id';
    appIdCell.textContent = row.appId || '';

    const window7Cell = document.createElement('td');
    window7Cell.id = `${namespace}-cell-window7-${rowNumber}`;
    window7Cell.className = 'metadata-cell metadata-cell--window';
    window7Cell.textContent = formatFieldList(row.window7);

    const window30Cell = document.createElement('td');
    window30Cell.id = `${namespace}-cell-window30-${rowNumber}`;
    window30Cell.className = 'metadata-cell metadata-cell--window';
    window30Cell.textContent = formatFieldList(row.window30);

    const window180Cell = document.createElement('td');
    window180Cell.id = `${namespace}-cell-window180-${rowNumber}`;
    window180Cell.className = 'metadata-cell metadata-cell--window';
    window180Cell.textContent = formatFieldList(row.window180);

    tableRow.append(subCell, appNameCell, appIdCell, window7Cell, window30Cell, window180Cell);
    tableBody.appendChild(tableRow);
  });
};

// Render all namespace tables from cached metadata aggregations.
const renderMetadataSummary = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const rowsByNamespace = mapAggregationsToRows(aggregations);
  METADATA_NAMESPACES.forEach((namespace) => {
    renderTableRows(namespace, rowsByNamespace[namespace]);
  });
};

// Process incoming metadata messages from the parent window.
const handleMetadataMessage = (event) => {
  const message = event?.data;

  if (!message || message.type !== 'metadataAggregations') {
    return;
  }

  const payload = message.payload || {};
  const nextAggregations = payload.metadataAggregations || (payload.appCountsBySubId ? {} : payload) || {};
  window.metadataAggregations = nextAggregations;
  renderMetadataSummary(window.metadataAggregations);
};

// Initialize the metadata summary view when the document is ready.
const initMetadataSummary = () => {
  if (hasMetadataAggregations()) {
    renderMetadataSummary(window.metadataAggregations);
  } else {
    renderMetadataSummary({});
  }
};

window.addEventListener('message', handleMetadataMessage);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMetadataSummary);
} else {
  initMetadataSummary();
}
