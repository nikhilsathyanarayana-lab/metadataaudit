const METADATA_NAMESPACES = ['visitor', 'account', 'custom', 'salesforce'];

// Confirm that cached metadata aggregations are available on the window.
const hasMetadataAggregations = () => (
  typeof window !== 'undefined'
    && window.metadataAggregations
    && typeof window.metadataAggregations === 'object'
);


let subscriptionLabels = (typeof window !== 'undefined' && window.subscriptionLabels
  && typeof window.subscriptionLabels === 'object')
  ? window.subscriptionLabels
  : {};

// Resolve SubID display text from the label map with a raw SubID fallback.
const resolveSubscriptionDisplay = (subId) => {
  const key = String(subId || '');
  return subscriptionLabels[key] || key || 'Unknown SubID';
};

// Format a visible SubID label while retaining the raw identifier for structure.
const formatSubscriptionDisplay = (subId) => {
  const rawSubId = String(subId || 'Unknown SubID');
  const label = resolveSubscriptionDisplay(rawSubId);

  if (label !== rawSubId) {
    return `${label} (${rawSubId})`;
  }

  return label;
};



// Return the requested window bucket from an app aggregation bucket.
const getWindowBucket = (appBucket, lookbackWindow) => (
  appBucket?.windows?.[lookbackWindow] || appBucket?.windows?.[String(lookbackWindow)]
);

// Combine field names for each namespace across provided window buckets.
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
    : [];
  return summary;
}, {});

// Aggregate app coverage into per-subscription summaries.
const buildSubscriptionSummaries = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const summaries = [];

  if (!aggregations || typeof aggregations !== 'object') {
    return summaries;
  }

  Object.entries(aggregations).forEach(([subId, subBucket]) => {
    const apps = subBucket?.apps || {};
    const namespaceCoverage = METADATA_NAMESPACES.reduce((coverage, namespace) => ({
      ...coverage,
      [namespace]: {
        window7: new Set(),
        window30: new Set(),
        window180: new Set(),
      },
    }), {});
    const appList = [];

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

      METADATA_NAMESPACES.forEach((namespace) => {
        window7Fields?.[namespace]?.forEach((fieldName) => namespaceCoverage[namespace].window7.add(fieldName));
        window30Fields?.[namespace]?.forEach((fieldName) => namespaceCoverage[namespace].window30.add(fieldName));
        window180Fields?.[namespace]?.forEach((fieldName) => namespaceCoverage[namespace].window180.add(fieldName));
      });

      appList.push({
        appId: appId || '',
        appName: appBucket?.appName || appId || 'Unknown app',
      });
    });

    const normalizedSubId = subId || 'Unknown SubID';
    const subDisplay = formatSubscriptionDisplay(normalizedSubId);
    const namespaceTotals = METADATA_NAMESPACES.reduce((totals, namespace) => {
      const namespaceBuckets = namespaceCoverage[namespace];
      const windowFields = new Set([
        ...namespaceBuckets.window7,
        ...namespaceBuckets.window30,
        ...namespaceBuckets.window180,
      ]);

      totals[namespace] = {
        window7: [...namespaceBuckets.window7].sort((first, second) => first.localeCompare(second)),
        window30: [...namespaceBuckets.window30].sort((first, second) => first.localeCompare(second)),
        window180: [...namespaceBuckets.window180].sort((first, second) => first.localeCompare(second)),
        uniqueTotal: windowFields.size,
      };
      return totals;
    }, {});

    const uniqueFieldCount = Object.values(namespaceTotals).reduce((count, namespaceBucket) => (
      count + (Number(namespaceBucket.uniqueTotal) || 0)
    ), 0);

    summaries.push({
      subId: normalizedSubId,
      subDisplay,
      appCount: appList.length,
      apps: appList.sort((first, second) => first.appName.localeCompare(second.appName)
        || first.appId.localeCompare(second.appId)),
      namespaceTotals,
      uniqueFieldCount,
    });
  });

  summaries.sort((first, second) => first.subDisplay.localeCompare(second.subDisplay)
    || first.subId.localeCompare(second.subId));
  return summaries;
};

// Format a list of fields into a printable string.
const formatFieldList = (fields) => {
  if (!fields || !fields.length) {
    return '—';
  }

  return fields.join(', ');
};

// Ensure cloned template elements have unique IDs for accessibility.
const applyTemplateIds = (cardElement, subId) => {
  const rawSubId = String(subId || 'Unknown SubID');
  const suffix = encodeURIComponent(rawSubId);
  const assignId = (selector, baseId) => {
    const element = cardElement.querySelector(selector);

    if (element) {
      element.id = `${baseId}-${suffix}`;
    }
  };

  assignId('[data-subscription-card]', 'subscription-card');
  assignId('#subscription-template-header', 'subscription-card-header');
  assignId('#subscription-template-eyebrow', 'subscription-card-eyebrow');
  assignId('[data-slot="title"]', 'subscription-title');
  assignId('[data-slot="summary"]', 'subscription-summary');
  assignId('#subscription-template-stats', 'subscription-card-stats');
  assignId('#subscription-template-stat-apps', 'subscription-card-stat-apps');
  assignId('#subscription-template-stat-apps-label', 'subscription-card-stat-apps-label');
  assignId('[data-slot="app-count"]', 'subscription-app-count');
  assignId('#subscription-template-stat-fields', 'subscription-card-stat-fields');
  assignId('#subscription-template-stat-fields-label', 'subscription-card-stat-fields-label');
  assignId('[data-slot="field-count"]', 'subscription-field-count');
  assignId('#subscription-template-apps', 'subscription-card-apps');
  assignId('#subscription-template-apps-title', 'subscription-card-apps-title');
  assignId('[data-slot="app-list"]', 'subscription-app-list');
  assignId('#subscription-template-namespace', 'subscription-card-namespace');
  assignId('#subscription-template-namespace-title', 'subscription-card-namespace-title');
  assignId('#subscription-template-namespace-table', 'subscription-card-namespace-table');
  assignId('#subscription-template-namespace-head', 'subscription-card-namespace-head');
  assignId('#subscription-template-namespace-row', 'subscription-card-namespace-row');
  assignId('#subscription-template-namespace-header-namespace', 'subscription-card-namespace-header-namespace');
  assignId('#subscription-template-namespace-header-window7', 'subscription-card-namespace-header-window7');
  assignId('#subscription-template-namespace-header-window30', 'subscription-card-namespace-header-window30');
  assignId('#subscription-template-namespace-header-window180', 'subscription-card-namespace-header-window180');
  assignId('[data-slot="namespace-body"]', 'subscription-namespace-body');
};

// Build a namespace table row for the subscription card.
const buildNamespaceRow = (namespaceKey, namespaceBucket, rowIndex) => {
  const rowNumber = String(rowIndex + 1).padStart(2, '0');
  const tableRow = document.createElement('tr');
  tableRow.id = `subscription-namespace-row-${namespaceKey}-${rowNumber}`;
  tableRow.className = 'subscription-namespace__row';

  const namespaceCell = document.createElement('td');
  namespaceCell.id = `subscription-namespace-${namespaceKey}-label-${rowNumber}`;
  namespaceCell.className = 'subscription-namespace__cell subscription-namespace__cell--label';
  namespaceCell.textContent = namespaceKey;

  const window7Cell = document.createElement('td');
  window7Cell.id = `subscription-namespace-${namespaceKey}-window7-${rowNumber}`;
  window7Cell.className = 'subscription-namespace__cell subscription-namespace__cell--window';
  window7Cell.textContent = formatFieldList(namespaceBucket?.window7 || []);

  const window30Cell = document.createElement('td');
  window30Cell.id = `subscription-namespace-${namespaceKey}-window30-${rowNumber}`;
  window30Cell.className = 'subscription-namespace__cell subscription-namespace__cell--window';
  window30Cell.textContent = formatFieldList(namespaceBucket?.window30 || []);

  const window180Cell = document.createElement('td');
  window180Cell.id = `subscription-namespace-${namespaceKey}-window180-${rowNumber}`;
  window180Cell.className = 'subscription-namespace__cell subscription-namespace__cell--window';
  window180Cell.textContent = formatFieldList(namespaceBucket?.window180 || []);

  tableRow.append(namespaceCell, window7Cell, window30Cell, window180Cell);
  return tableRow;
};

// Build a subscription page from the template and provided summary data.
const buildSubscriptionCard = (template, summary) => {
  if (!template || !summary) {
    return null;
  }

  const clone = template.content.firstElementChild.cloneNode(true);

  applyTemplateIds(clone, summary.subId);

  const subDisplay = summary.subDisplay || formatSubscriptionDisplay(summary.subId);
  const title = clone.querySelector('[data-slot="title"]');
  const summaryText = clone.querySelector('[data-slot="summary"]');
  const appCount = clone.querySelector('[data-slot="app-count"]');
  const fieldCount = clone.querySelector('[data-slot="field-count"]');
  const appList = clone.querySelector('[data-slot="app-list"]');
  const namespaceBody = clone.querySelector('[data-slot="namespace-body"]');

  if (title) {
    title.textContent = `Sub ID ${subDisplay}`;
  }

  if (summaryText) {
    summaryText.textContent = `Coverage for ${summary.appCount || 0} apps with ${summary.uniqueFieldCount} unique fields across namespaces in ${subDisplay}.`;
  }

  if (appCount) {
    appCount.textContent = summary.appCount.toString();
  }

  if (fieldCount) {
    fieldCount.textContent = summary.uniqueFieldCount.toString();
  }

  if (appList) {
    summary.apps.forEach((app, index) => {
      const itemNumber = String(index + 1).padStart(2, '0');
      const listItem = document.createElement('li');
      listItem.id = `subscription-app-${summary.subId}-${itemNumber}`;
      listItem.className = 'subscription-apps__item';
      listItem.textContent = app.appName ? `${app.appName} (${app.appId || 'ID pending'})` : app.appId || 'Unknown app';
      appList.appendChild(listItem);
    });
  }

  if (namespaceBody) {
    const namespaceEntries = Object.entries(summary.namespaceTotals || {});
    namespaceEntries.forEach(([namespaceKey, namespaceBucket], index) => {
      const tableRow = buildNamespaceRow(namespaceKey, namespaceBucket, index);
      namespaceBody.appendChild(tableRow);
    });
  }

  return clone;
};

// Render subscription cards from cached metadata aggregations.
const renderSubscriptionPages = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const container = document.getElementById('subscription-details-container');
  const emptyState = document.getElementById('subscription-details-empty');
  const template = document.getElementById('subscription-details-template');

  if (!container || !template) {
    return;
  }

  container.innerHTML = '';

  const summaries = buildSubscriptionSummaries(aggregations);

  if (!summaries.length) {
    if (emptyState) {
      container.appendChild(emptyState);
    }
    return;
  }

  summaries.forEach((summary, index) => {
    const card = buildSubscriptionCard(template, summary);

    if (card) {
      card.setAttribute('data-subscription-index', String(index));
      card.setAttribute('data-subscription-id', summary.subId);
      container.appendChild(card);
    }
  });
};

// Process incoming metadata messages from the parent window.
const handleMetadataMessage = (event) => {
  const message = event?.data;

  if (!message || message.type !== 'metadataAggregations') {
    return;
  }

  const payload = message.payload || {};
  const nextAggregations = payload.metadataAggregations || payload;
  window.metadataAggregations = nextAggregations;
  window.fieldTypeSelections = message.fieldTypeSelections || {};
  subscriptionLabels = message.subscriptionLabels && typeof message.subscriptionLabels === 'object'
    ? message.subscriptionLabels
    : {};
  window.subscriptionLabels = subscriptionLabels;
  renderSubscriptionPages(window.metadataAggregations);
};

// Initialize the subscription detail view when the document is ready.
const initSubscriptionDetails = () => {
  if (hasMetadataAggregations()) {
    renderSubscriptionPages(window.metadataAggregations);
  } else {
    renderSubscriptionPages({});
  }
};

window.addEventListener('message', handleMetadataMessage);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSubscriptionDetails);
} else {
  initSubscriptionDetails();
}
