const METADATA_NAMESPACES = ['visitor', 'account', 'custom', 'salesforce'];
const OPTIONAL_NAMESPACE_CARDS = ['custom', 'salesforce'];
const FIELD_COMPARISON_DISPLAY_OPTIONS = [
  'Matrix view: rows as fields, columns as tables, with cell badges indicating match or mismatch and tooltips for differences.',
  'Aggregated diff view: group fields by status (all match, partial mismatch, missing) with expandable details.',
  'Timeline or stacked view: per-field cards showing each table value with highlights for deviations and source-of-truth markers.',
];

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
  const window23Bucket = getWindowBucket(appBucket, 23); // 23-day buckets only feed 30/180 rollups and are not rendered directly
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

// Compare aligned metadata rows by field across tables.
const buildFieldSummaryComparison = (rowsByTable = {}) => {
  const tableEntries = Object.entries(rowsByTable || {});
  const fieldNames = new Set();

  tableEntries.forEach(([, tableRows]) => {
    if (tableRows && typeof tableRows === 'object') {
      Object.keys(tableRows).forEach((fieldName) => fieldNames.add(fieldName));
    }
  });

  return [...fieldNames].sort((first, second) => first.localeCompare(second)).map((fieldName) => {
    const valuesByTable = {};
    const presentValues = new Set();
    let hasMissingValue = false;

    tableEntries.forEach(([tableName, tableRows]) => {
      const value = tableRows?.[fieldName] ?? null;
      valuesByTable[tableName] = value;

      if (value === null || value === undefined) {
        hasMissingValue = true;
        return;
      }

      presentValues.add(String(value));
    });

    let status = 'match';

    if (presentValues.size > 1) {
      status = 'delta';
    } else if (hasMissingValue) {
      status = 'missing';
    }

    return {
      field: fieldName,
      valuesByTable,
      status,
    };
  });
};

// Map field arrays into keyed comparison rows per window.
const buildRowsByTableForEntry = (entry) => ({
  '7 days': (entry.window7Fields
    ? Object.fromEntries([...entry.window7Fields].map((fieldName) => [fieldName, 'present']))
    : {}),
  '30 days': (entry.window30Fields
    ? Object.fromEntries([...entry.window30Fields].map((fieldName) => [fieldName, 'present']))
    : {}),
  '180 days': (entry.window180Fields
    ? Object.fromEntries([...entry.window180Fields].map((fieldName) => [fieldName, 'present']))
    : {}),
});

// Build comparison entries for every app and namespace combination.
const buildFieldComparisonEntries = (rowsByNamespace = {}) => {
  const fieldSets = buildFieldSetsByApp(rowsByNamespace);

  return fieldSets.map((entry) => {
    const rowsByTable = buildRowsByTableForEntry(entry);
    const comparisons = buildFieldSummaryComparison(rowsByTable);

    return {
      ...entry,
      rowsByTable,
      comparisons,
    };
  }).filter((entry) => entry.comparisons.length);
};

const WINDOW_LABELS = [
  { key: 'window7', label: '7 days' },
  { key: 'window30', label: '30 days' },
  { key: 'window180', label: '180 days' },
];

// Convert a namespace key into a display label.
const formatNamespaceTitle = (namespace) => (namespace
  ? `${namespace.charAt(0).toUpperCase()}${namespace.slice(1)}`
  : '');

// Build a readable list for window labels.
const formatWindowLabelList = (windows = []) => {
  if (!windows.length) {
    return '';
  }

  if (windows.length === 1) {
    return windows[0];
  }

  if (windows.length === 2) {
    return `${windows[0]} and ${windows[1]}`;
  }

  return `${windows.slice(0, -1).join(', ')}, and ${windows[windows.length - 1]}`;
};

// Parse a field list stored in the DOM dataset.
const parseFieldsFromDataset = (rawValue) => {
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue : null;
  } catch (error) {
    console.error('Unable to parse field dataset value', error);
    return null;
  }
};

// Normalize a field array for comparison purposes.
const normalizeFieldArray = (fields) => (Array.isArray(fields)
  ? [...new Set(fields)].sort((first, second) => first.localeCompare(second))
  : []);

// Read namespace table rows after rendering to drive comparisons.
const readNamespaceTableRows = (namespace) => {
  const tableBody = document.getElementById(`${namespace}-metadata-body`);

  if (!tableBody) {
    return [];
  }

  const tableRows = [...tableBody.querySelectorAll('.metadata-row')]
    .filter((row) => !row.classList.contains('metadata-row--empty'));

  return tableRows.map((row) => ({
    namespace,
    subId: row.dataset.subId || '',
    appName: row.dataset.appName || '',
    appId: row.dataset.appId || '',
    window7: normalizeFieldArray(parseFieldsFromDataset(row.dataset.window7)),
    window30: normalizeFieldArray(parseFieldsFromDataset(row.dataset.window30)),
    window180: normalizeFieldArray(parseFieldsFromDataset(row.dataset.window180)),
  }));
};

// Confirm that a row has identical fields across all windows.
const rowHasMatchingWindows = (row) => {
  const serializedWindows = WINDOW_LABELS.map(({ key }) => JSON.stringify(row[key] || []));
  return new Set(serializedWindows).size === 1;
};

// Build per-field findings for a single row.
const buildRowFieldFindings = (row) => {
  const allFields = new Set([...row.window7, ...row.window30, ...row.window180]);
  const findings = [];

  allFields.forEach((fieldName) => {
    const presentWindows = WINDOW_LABELS.filter(({ key }) => row[key].includes(fieldName)).map(({ label }) => label);

    if (presentWindows.length === WINDOW_LABELS.length) {
      return;
    }

    const missingWindows = WINDOW_LABELS.filter(({ key }) => !row[key].includes(fieldName)).map(({ label }) => label);
    const presentText = formatWindowLabelList(presentWindows);
    const missingText = formatWindowLabelList(missingWindows);
    const namespaceLabel = formatNamespaceTitle(row.namespace);
    const appLabel = row.appName || 'Unknown app';
    const subLabel = row.subId || 'Unknown SubID';

    findings.push(`${fieldName} is present in ${presentText} but not ${missingText} in ${appLabel} (${subLabel}) for ${namespaceLabel}.`);
  });

  return findings;
};

// Build all field change findings from rendered tables.
const buildFieldChangeFindings = () => {
  const namespaceRows = METADATA_NAMESPACES.map((namespace) => ({
    namespace,
    rows: readNamespaceTableRows(namespace),
  }));

  const findings = [];

  namespaceRows.forEach((entry) => {
    if (!entry.rows.length) {
      findings.push(`No ${formatNamespaceTitle(entry.namespace)} data received by any scanned applications in the last 180 days.`);
    }
  });

  namespaceRows.filter((entry) => entry.rows.length).forEach((entry) => {
    const hasStableRows = entry.rows.every((row) => rowHasMatchingWindows(row));

    if (hasStableRows) {
      findings.push(`${formatNamespaceTitle(entry.namespace)} has had no change to fields received in the last 180 days.`);
      return;
    }

    entry.rows.forEach((row) => {
      findings.push(...buildRowFieldFindings(row));
    });
  });

  return findings;
};

// Render field change findings after the tables finish rendering.
const renderFieldChangeSummary = (displayOptions = []) => {
  const renderFindings = () => {
    const summaryContainer = document.getElementById('field-change-summary');

    if (!summaryContainer) {
      return;
    }

    const findings = buildFieldChangeFindings();
    summaryContainer.innerHTML = '';

    if (!findings.length) {
      const emptyMessage = document.createElement('p');
      emptyMessage.id = 'field-change-empty-message';
      emptyMessage.className = 'field-change-text field-change-text--empty';
      emptyMessage.textContent = 'No field comparisons available yet.';
      summaryContainer.appendChild(emptyMessage);
    } else {
      const sentenceList = document.createElement('ul');
      sentenceList.id = 'field-change-list';
      sentenceList.className = 'field-change-list';

      findings.forEach((sentence, index) => {
        const listItem = document.createElement('li');
        listItem.id = `field-change-item-${String(index + 1).padStart(2, '0')}`;
        listItem.className = 'field-change-text';
        listItem.textContent = sentence;
        sentenceList.appendChild(listItem);
      });

      summaryContainer.appendChild(sentenceList);
    }

    if (displayOptions.length) {
      const optionsTitle = document.createElement('h3');
      optionsTitle.id = 'field-comparison-options-title';
      optionsTitle.className = 'field-comparison-options-title';
      optionsTitle.textContent = 'Display Options to Explore';

      const optionsList = document.createElement('ol');
      optionsList.id = 'field-comparison-options';
      optionsList.className = 'field-comparison-options';

      displayOptions.forEach((optionText, index) => {
        const optionItem = document.createElement('li');
        optionItem.id = `field-comparison-option-${String(index + 1).padStart(2, '0')}`;
        optionItem.className = 'field-comparison-option';
        optionItem.textContent = optionText;
        optionsList.appendChild(optionItem);
      });

      summaryContainer.append(optionsTitle, optionsList);
    }
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(renderFindings);
    return;
  }

  renderFindings();
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
    tableRow.dataset.subId = row.subId || '';
    tableRow.dataset.appName = row.appName || '';
    tableRow.dataset.appId = row.appId || '';
    tableRow.dataset.window7 = JSON.stringify(row.window7 ?? null);
    tableRow.dataset.window30 = JSON.stringify(row.window30 ?? null);
    tableRow.dataset.window180 = JSON.stringify(row.window180 ?? null);

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

// Hide optional namespace cards when there is no data to show.
const toggleNamespaceCardVisibility = (namespace, rows = []) => {
  const namespaceCard = document.getElementById(`${namespace}-metadata-card`);
  const hasRows = Array.isArray(rows) && rows.length > 0;

  if (!namespaceCard) {
    return false;
  }

  namespaceCard.style.display = hasRows ? '' : 'none';

  if (!hasRows) {
    const tableBody = document.getElementById(`${namespace}-metadata-body`);

    if (tableBody) {
      tableBody.innerHTML = '';
    }
  }

  return hasRows;
};

// Render all namespace tables from cached metadata aggregations.
const renderMetadataSummary = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const rowsByNamespace = mapAggregationsToRows(aggregations);
  METADATA_NAMESPACES.forEach((namespace) => {
    const namespaceRows = rowsByNamespace[namespace];
    const shouldRenderCard = OPTIONAL_NAMESPACE_CARDS.includes(namespace)
      ? toggleNamespaceCardVisibility(namespace, namespaceRows)
      : true;

    if (shouldRenderCard) {
      renderTableRows(namespace, namespaceRows);
    }
  });
  renderFieldChangeSummary(FIELD_COMPARISON_DISPLAY_OPTIONS);
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
  window.fieldTypeSelections = message.fieldTypeSelections || {};
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

if (typeof window !== 'undefined') {
  window.addEventListener('message', handleMetadataMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMetadataSummary);
  } else {
    initMetadataSummary();
  }
}

export {
  buildFieldSummaryComparison,
  buildFieldComparisonEntries,
};
