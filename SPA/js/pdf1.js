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

// Count processed app aggregations for a SubID using metadata buckets.
const getProcessedAppsForSub = (subId) => {
  const appBuckets = getMetadataAggregations()?.[subId]?.apps;

  if (!appBuckets || typeof appBuckets !== 'object') {
    return 0;
  }

  const processedIds = Object.values(appBuckets)
    .filter((bucket) => Object.values(bucket?.windows || {}).some((windowBucket) => windowBucket?.isProcessed))
    .map((bucket) => bucket?.appId)
    .filter(Boolean)
    .map((appId) => String(appId));

  return new Set(processedIds).size;
};

// Render the subscription summary list in the provided container.
const renderSubscriptionSummary = (container, subIds) => {
  if (!container) {
    return;
  }

  container.textContent = '';
  const pageTitle = document.createElement('h3');
  pageTitle.className = 'pdf-page-title';
  pageTitle.textContent = 'Overview';
  container.appendChild(pageTitle);

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

// Render the overview summary inside the PDF page.
const renderPdfOverview = async (sectionRoot) => {
  const summaryContainer = sectionRoot?.querySelector('#pdf-export-summary');
  const subIds = getSubIds();

  if (!summaryContainer) {
    return;
  }

  renderSubscriptionSummary(summaryContainer, subIds);
};

// Initialize PDF page one with overview data.
export async function initPdfPage(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  await renderPdfOverview(sectionRoot);
}

// Refresh the overview when the PDF page becomes visible again.
export async function onShowPdfPage(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  await renderPdfOverview(sectionRoot);
}
