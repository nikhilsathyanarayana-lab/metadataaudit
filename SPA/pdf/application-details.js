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

// Format a visible SubID label using either the configured label or raw SubID.
const formatSubscriptionDisplay = (subId) => {
  const rawSubId = String(subId || 'Unknown SubID');
  return resolveSubscriptionDisplay(rawSubId);
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

// Build a summary object for a single app bucket.
const buildApplicationSummary = (subId, appId, appBucket) => {
  const window7Bucket = getWindowBucket(appBucket, 7);
  const window23Bucket = getWindowBucket(appBucket, 23);
  const window150Bucket = getWindowBucket(appBucket, 150);
  const hasWindow7Data = Boolean(window7Bucket?.isProcessed);
  const hasWindow23Data = Boolean(window23Bucket?.isProcessed);
  const hasWindow150Data = Boolean(window150Bucket?.isProcessed);

  if (!hasWindow7Data && !hasWindow23Data && !hasWindow150Data) {
    return null;
  }

  const window7Fields = hasWindow7Data ? buildNamespaceFieldSummary([window7Bucket]) : {};
  const window30Fields = (hasWindow7Data && hasWindow23Data)
    ? buildNamespaceFieldSummary([window7Bucket, window23Bucket])
    : {};
  const window180Fields = (hasWindow7Data && hasWindow23Data && hasWindow150Data)
    ? buildNamespaceFieldSummary([window7Bucket, window23Bucket, window150Bucket])
    : {};

  const namespaceTotals = METADATA_NAMESPACES.reduce((totals, namespace) => {
    const namespaceWindow7 = window7Fields?.[namespace] || [];
    const namespaceWindow30 = window30Fields?.[namespace] || [];
    const namespaceWindow180 = window180Fields?.[namespace] || [];
    const uniqueFields = new Set([
      ...namespaceWindow7,
      ...namespaceWindow30,
      ...namespaceWindow180,
    ]);

    totals[namespace] = {
      window7: namespaceWindow7,
      window30: namespaceWindow30,
      window180: namespaceWindow180,
      uniqueTotal: uniqueFields.size,
    };
    return totals;
  }, {});

  const uniqueFieldCount = Object.values(namespaceTotals).reduce((count, namespaceBucket) => (
    count + (Number(namespaceBucket.uniqueTotal) || 0)
  ), 0);

  const windowCounts = {
    window7: METADATA_NAMESPACES.reduce((count, namespace) => (
      count + (namespaceTotals[namespace]?.window7?.length || 0)
    ), 0),
    window30: METADATA_NAMESPACES.reduce((count, namespace) => (
      count + (namespaceTotals[namespace]?.window30?.length || 0)
    ), 0),
    window180: METADATA_NAMESPACES.reduce((count, namespace) => (
      count + (namespaceTotals[namespace]?.window180?.length || 0)
    ), 0),
  };

  return {
    subId: subId || 'Unknown SubID',
    subDisplay: formatSubscriptionDisplay(subId || 'Unknown SubID'),
    appId: appId || '',
    appName: appBucket?.appName || appId || 'Unknown app',
    namespaceTotals,
    uniqueFieldCount,
    windowCounts,
  };
};

// Aggregate application summaries grouped by subscription.
const buildApplicationGroups = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const groups = [];

  if (!aggregations || typeof aggregations !== 'object') {
    return groups;
  }

  const sortedSubscriptions = Object.entries(aggregations)
    .sort((first, second) => formatSubscriptionDisplay(first[0] || '').localeCompare(formatSubscriptionDisplay(second[0] || ''))
      || (first[0] || '').localeCompare(second[0] || ''));

  sortedSubscriptions.forEach(([subId, subBucket]) => {
    const apps = subBucket?.apps || {};
    const summaries = Object.entries(apps).reduce((list, [appId, appBucket]) => {
      const summary = buildApplicationSummary(subId, appId, appBucket);

      if (summary) {
        list.push(summary);
      }

      return list;
    }, []);

    summaries.sort((first, second) => first.appName.localeCompare(second.appName)
      || first.appId.localeCompare(second.appId));

    if (summaries.length) {
      groups.push({
        subId: subId || 'Unknown SubID',
        apps: summaries,
      });
    }
  });

  return groups;
};

// Format a list of fields into a printable string.
const formatFieldList = (fields) => {
  if (!fields || !fields.length) {
    return '—';
  }

  return fields.join(', ');
};

// Ensure cloned template elements have unique IDs for accessibility.
const applyTemplateIds = (cardElement, subId, appId) => {
  const safeSubId = encodeURIComponent(String(subId || 'Unknown SubID'));
  const safeAppId = appId ? appId.replace(/\s+/g, '-').toLowerCase() : 'unknown-app';
  const suffix = `${safeSubId}-${safeAppId}`;
  const assignId = (selector, baseId) => {
    const element = cardElement.querySelector(selector);

    if (element) {
      element.id = `${baseId}-${suffix}`;
    }
  };

  assignId('[data-app-card]', 'application-card');
  assignId('#application-template-header', 'application-card-header');
  assignId('#application-template-eyebrow', 'application-card-eyebrow');
  assignId('[data-slot="title"]', 'application-title');
  assignId('[data-slot="summary"]', 'application-summary');
  assignId('#application-template-stats', 'application-card-stats');
  assignId('#application-template-stat-subscription', 'application-card-stat-subscription');
  assignId('#application-template-stat-subscription-label', 'application-card-stat-subscription-label');
  assignId('[data-slot="sub-id"]', 'application-subscription-id');
  assignId('#application-template-stat-appid', 'application-card-stat-appid');
  assignId('#application-template-stat-appid-label', 'application-card-stat-appid-label');
  assignId('[data-slot="app-id"]', 'application-app-id');
  assignId('#application-template-stat-fields7', 'application-card-stat-fields7');
  assignId('#application-template-stat-fields7-label', 'application-card-stat-fields7-label');
  assignId('[data-slot="field-count-7"]', 'application-field-count-7');
  assignId('#application-template-stat-fields30', 'application-card-stat-fields30');
  assignId('#application-template-stat-fields30-label', 'application-card-stat-fields30-label');
  assignId('[data-slot="field-count-30"]', 'application-field-count-30');
  assignId('#application-template-stat-fields180', 'application-card-stat-fields180');
  assignId('#application-template-stat-fields180-label', 'application-card-stat-fields180-label');
  assignId('[data-slot="field-count-180"]', 'application-field-count-180');
  assignId('#application-template-stat-fields-unique', 'application-card-stat-fields-unique');
  assignId('#application-template-stat-fields-unique-label', 'application-card-stat-fields-unique-label');
  assignId('[data-slot="field-count-unique"]', 'application-field-count-unique');
  assignId('#application-template-namespace', 'application-card-namespace');
  assignId('#application-template-namespace-title', 'application-card-namespace-title');
  assignId('#application-template-namespace-table', 'application-card-namespace-table');
  assignId('#application-template-namespace-head', 'application-card-namespace-head');
  assignId('#application-template-namespace-row', 'application-card-namespace-row');
  assignId('#application-template-namespace-header-namespace', 'application-card-namespace-header-namespace');
  assignId('#application-template-namespace-header-window7', 'application-card-namespace-header-window7');
  assignId('#application-template-namespace-header-window30', 'application-card-namespace-header-window30');
  assignId('#application-template-namespace-header-window180', 'application-card-namespace-header-window180');
  assignId('[data-slot="namespace-body"]', 'application-namespace-body');
};

// Build a namespace table row for the application card.
const buildNamespaceRow = (namespaceKey, namespaceBucket, rowIndex, subId, appId) => {
  const rowNumber = String(rowIndex + 1).padStart(2, '0');
  const safeNamespace = namespaceKey.replace(/\s+/g, '-').toLowerCase();
  const safeSubId = encodeURIComponent(String(subId || 'Unknown SubID'));
  const safeAppId = appId ? appId.replace(/\s+/g, '-').toLowerCase() : 'unknown-app';
  const tableRow = document.createElement('tr');
  tableRow.id = `application-namespace-row-${safeNamespace}-${safeSubId}-${safeAppId}-${rowNumber}`;
  tableRow.className = 'subscription-namespace__row application-namespace-row';

  const namespaceCell = document.createElement('td');
  namespaceCell.id = `application-namespace-${safeNamespace}-label-${safeSubId}-${safeAppId}-${rowNumber}`;
  namespaceCell.className = 'subscription-namespace__cell subscription-namespace__cell--label application-namespace-label';
  namespaceCell.textContent = namespaceKey;

  const window7Cell = document.createElement('td');
  window7Cell.id = `application-namespace-${safeNamespace}-window7-${safeSubId}-${safeAppId}-${rowNumber}`;
  window7Cell.className = 'subscription-namespace__cell subscription-namespace__cell--window application-namespace-window';
  window7Cell.textContent = formatFieldList(namespaceBucket?.window7 || []);

  const window30Cell = document.createElement('td');
  window30Cell.id = `application-namespace-${safeNamespace}-window30-${safeSubId}-${safeAppId}-${rowNumber}`;
  window30Cell.className = 'subscription-namespace__cell subscription-namespace__cell--window application-namespace-window';
  window30Cell.textContent = formatFieldList(namespaceBucket?.window30 || []);

  const window180Cell = document.createElement('td');
  window180Cell.id = `application-namespace-${safeNamespace}-window180-${safeSubId}-${safeAppId}-${rowNumber}`;
  window180Cell.className = 'subscription-namespace__cell subscription-namespace__cell--window application-namespace-window';
  window180Cell.textContent = formatFieldList(namespaceBucket?.window180 || []);

  tableRow.append(namespaceCell, window7Cell, window30Cell, window180Cell);
  return tableRow;
};

// Build an application page from the template and provided summary data.
const buildApplicationCard = (template, summary) => {
  if (!template || !summary) {
    return null;
  }

  const clone = template.content.firstElementChild.cloneNode(true);

  applyTemplateIds(clone, summary.subId, summary.appId);

  const title = clone.querySelector('[data-slot="title"]');
  const summaryText = clone.querySelector('[data-slot="summary"]');
  const subIdValue = clone.querySelector('[data-slot="sub-id"]');
  const appIdValue = clone.querySelector('[data-slot="app-id"]');
  const fieldCount7 = clone.querySelector('[data-slot="field-count-7"]');
  const fieldCount30 = clone.querySelector('[data-slot="field-count-30"]');
  const fieldCount180 = clone.querySelector('[data-slot="field-count-180"]');
  const uniqueCount = clone.querySelector('[data-slot="field-count-unique"]');
  const namespaceBody = clone.querySelector('[data-slot="namespace-body"]');

  if (title) {
    title.textContent = summary.appName || summary.appId || 'Unknown app';
  }

  if (summaryText) {
    summaryText.textContent = `Sub ID ${summary.subDisplay} coverage with ${summary.uniqueFieldCount} unique fields across namespaces.`;
  }

  if (subIdValue) {
    subIdValue.textContent = summary.subDisplay;
  }

  if (appIdValue) {
    appIdValue.textContent = summary.appId || 'ID pending';
  }

  if (fieldCount7) {
    fieldCount7.textContent = summary.windowCounts.window7.toString();
  }

  if (fieldCount30) {
    fieldCount30.textContent = summary.windowCounts.window30.toString();
  }

  if (fieldCount180) {
    fieldCount180.textContent = summary.windowCounts.window180.toString();
  }

  if (uniqueCount) {
    uniqueCount.textContent = summary.uniqueFieldCount.toString();
  }

  if (namespaceBody) {
    const namespaceEntries = Object.entries(summary.namespaceTotals || {});
    namespaceEntries.forEach(([namespaceKey, namespaceBucket], index) => {
      const tableRow = buildNamespaceRow(namespaceKey, namespaceBucket, index, summary.subId, summary.appId);
      namespaceBody.appendChild(tableRow);
    });
  }

  return clone;
};

// Build a subscription heading element for grouping app cards.
const buildSubscriptionHeading = (template, subId, index) => {
  if (!template) {
    return null;
  }

  const clone = template.content.firstElementChild.cloneNode(true);
  const normalizedSubId = subId || 'Unknown SubID';
  const safeSubId = encodeURIComponent(normalizedSubId);
  clone.id = `application-subscription-heading-${safeSubId}-${String(index).padStart(2, '0')}`;
  clone.textContent = `Sub ID ${formatSubscriptionDisplay(normalizedSubId)}`;
  return clone;
};

// Render application cards from cached metadata aggregations.
const renderApplicationPages = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const container = document.getElementById('application-details-container');
  const emptyState = document.getElementById('application-details-empty');
  const template = document.getElementById('application-details-template');
  const subHeadingTemplate = document.getElementById('application-subscription-heading-template');

  if (!container || !template) {
    return;
  }

  container.innerHTML = '';

  const groups = buildApplicationGroups(aggregations);

  if (!groups.length) {
    if (emptyState) {
      container.appendChild(emptyState);
    }
    return;
  }

  groups.forEach((group, groupIndex) => {
    const subHeading = buildSubscriptionHeading(subHeadingTemplate, group.subId, groupIndex);

    if (subHeading) {
      container.appendChild(subHeading);
    }

    group.apps.forEach((summary, appIndex) => {
      const card = buildApplicationCard(template, summary);

      if (card) {
        card.setAttribute('data-subscription-id', group.subId);
        card.setAttribute('data-application-index', `${groupIndex}-${appIndex}`);
        container.appendChild(card);
      }
    });
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
  renderApplicationPages(window.metadataAggregations);
};

// Initialize the application detail view when the document is ready.
const initApplicationDetails = () => {
  if (hasMetadataAggregations()) {
    renderApplicationPages(window.metadataAggregations);
  } else {
    renderApplicationPages({});
  }
};

window.addEventListener('message', handleMetadataMessage);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApplicationDetails);
} else {
  initApplicationDetails();
}
