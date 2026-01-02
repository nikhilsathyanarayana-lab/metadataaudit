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

// Build per-app, per-namespace field sets from mapped rows.
const buildFieldSetsByApp = (rowsByNamespace = {}) => {
  const fieldSets = [];

  METADATA_NAMESPACES.forEach((namespace) => {
    const namespaceRows = rowsByNamespace[namespace] || [];

    namespaceRows.forEach((row) => {
      const window7Fields = Array.isArray(row.window7) ? new Set(row.window7) : null;
      const window30Fields = Array.isArray(row.window30) ? new Set(row.window30) : null;
      const window180Fields = Array.isArray(row.window180) ? new Set(row.window180) : null;

      if (!window7Fields && !window30Fields && !window180Fields) {
        return;
      }

      fieldSets.push({
        subId: row.subId || '',
        appName: row.appName || '',
        appId: row.appId || '',
        namespace,
        window7Fields,
        window30Fields,
        window180Fields,
      });
    });
  });

  fieldSets.sort((first, second) => first.subId.localeCompare(second.subId)
    || first.appName.localeCompare(second.appName)
    || first.appId.localeCompare(second.appId)
    || first.namespace.localeCompare(second.namespace));

  return fieldSets;
};

// Identify new or missing fields across retention windows.
const buildFieldChangeSentences = (rowsByNamespace = {}) => {
  const fieldSets = buildFieldSetsByApp(rowsByNamespace);
  const messages = [];

  fieldSets.forEach((entry) => {
    const hasAllWindows = entry.window7Fields && entry.window30Fields && entry.window180Fields;

    if (!hasAllWindows) {
      return;
    }

    const newFields = [...entry.window7Fields].filter((field) => !entry.window30Fields.has(field)
      && !entry.window180Fields.has(field));
    const missingFields = [...entry.window180Fields].filter((field) => !entry.window7Fields.has(field)
      && !entry.window30Fields.has(field));

    newFields.forEach((fieldName) => {
      messages.push({
        subId: entry.subId,
        appName: entry.appName,
        namespace: entry.namespace,
        text: `New Field: "${fieldName}" detected for ${entry.appName} (Sub ID ${entry.subId}) in the ${entry.namespace} namespace.`,
      });
    });

    missingFields.forEach((fieldName) => {
      messages.push({
        subId: entry.subId,
        appName: entry.appName,
        namespace: entry.namespace,
        text: `No Longer Present: "${fieldName}" previously found for ${entry.appName} (Sub ID ${entry.subId}) is absent from the past 7 and 30 days in the ${entry.namespace} namespace.`,
      });
    });
  });

  messages.sort((first, second) => first.subId.localeCompare(second.subId)
    || first.appName.localeCompare(second.appName)
    || first.namespace.localeCompare(second.namespace)
    || first.text.localeCompare(second.text));

  return messages.map((entry) => entry.text);
};

// Render field change sentences into the PDF view.
const renderFieldChangeSummary = (sentences = []) => {
  const summaryContainer = document.getElementById('field-change-summary');

  if (!summaryContainer) {
    return;
  }

  summaryContainer.innerHTML = '';

  if (!sentences.length) {
    const emptyMessage = document.createElement('p');
    emptyMessage.id = 'field-change-empty-message';
    emptyMessage.className = 'field-change-text field-change-text--empty';
    emptyMessage.textContent = 'No field changes detected yet.';
    summaryContainer.appendChild(emptyMessage);
    return;
  }

  const sentenceList = document.createElement('ul');
  sentenceList.id = 'field-change-list';
  sentenceList.className = 'field-change-list';

  sentences.forEach((sentence, index) => {
    const listItem = document.createElement('li');
    listItem.id = `field-change-item-${String(index + 1).padStart(2, '0')}`;
    listItem.className = 'field-change-text';
    listItem.textContent = sentence;
    sentenceList.appendChild(listItem);
  });

  summaryContainer.appendChild(sentenceList);
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
    emptyCell.colSpan = 5;
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

    tableRow.append(subCell, appNameCell, window7Cell, window30Cell, window180Cell);
    tableBody.appendChild(tableRow);
  });
};

// Render all namespace tables from cached metadata aggregations.
const renderMetadataSummary = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const rowsByNamespace = mapAggregationsToRows(aggregations);
  METADATA_NAMESPACES.forEach((namespace) => {
    renderTableRows(namespace, rowsByNamespace[namespace]);
  });
  renderFieldChangeSummary(buildFieldChangeSentences(rowsByNamespace));
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
