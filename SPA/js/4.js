import { tableData } from './3.js';
import { getAppCountForSub } from '../API/app_names.js';

// Read metadata aggregations from the browser when available.
const getMetadataAggregations = () => {
  return typeof window !== 'undefined' ? window.metadataAggregations || {} : {};
};

// Collect all unique SubIDs from cached tables and aggregations.
const getSubIds = () => {
  const subIds = new Set();

  tableData.forEach((entry) => {
    if (entry?.subId) {
      subIds.add(String(entry.subId));
    }
  });

  Object.keys(getMetadataAggregations()).forEach((subId) => {
    if (subId) {
      subIds.add(String(subId));
    }
  });

  return [...subIds].sort((first, second) => first.localeCompare(second));
};

// Check whether an app bucket has processed window results.
const hasProcessedWindow = (appBucket) => {
  return Object.values(appBucket?.windows || {}).some((bucket) => bucket?.isProcessed);
};

// Count processed app aggregations for a SubID using metadata buckets.
const getProcessedAppsForSub = (subId) => {
  const appBuckets = getMetadataAggregations()?.[subId]?.apps;

  if (!appBuckets || typeof appBuckets !== 'object') {
    return 0;
  }

  const processedIds = Object.values(appBuckets)
    .filter((bucket) => hasProcessedWindow(bucket))
    .map((bucket) => bucket?.appId)
    .filter(Boolean)
    .map((appId) => String(appId));

  return new Set(processedIds).size;
};

// Render the subscription summary list in the provided container.
const renderSubscriptionSummary = (container) => {
  if (!container) {
    return;
  }

  container.textContent = '';
  const pageTitle = document.createElement('h3');
  pageTitle.className = 'pdf-page-title';
  pageTitle.textContent = 'Overview';
  container.appendChild(pageTitle);
  const subIds = getSubIds();

  if (!subIds.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No subscription data yet.';
    container.appendChild(emptyState);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'subscription-progress-list';

  subIds.forEach((subId) => {
    const availableApps = getAppCountForSub(subId);
    const processedApps = getProcessedAppsForSub(subId);
    const targetTotal = Math.max(availableApps, processedApps);

    const item = document.createElement('li');
    item.className = 'subscription-progress-item';

    const label = document.createElement('span');
    label.className = 'subscription-progress-label';
    label.textContent = subId || 'Unknown SubID';

    const status = document.createElement('span');
    status.className = 'subscription-progress-status';
    status.textContent = `${processedApps} out of ${targetTotal || processedApps}`;

    item.append(label, status);
    list.appendChild(item);
  });

  container.appendChild(list);
};

// Initialize the subscriptions view with scan progress rows.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  const summaryContainer = sectionRoot.querySelector('#pdf-export-summary');
  renderSubscriptionSummary(summaryContainer);
}

// Refresh the summary when the view becomes visible again.
export async function onShow(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  const summaryContainer = sectionRoot.querySelector('#pdf-export-summary');
  renderSubscriptionSummary(summaryContainer);
}
