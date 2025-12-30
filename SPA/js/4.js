import { tableData } from './3.js';

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

// Count the number of apps planned for metadata scans per SubID.
const getTotalAppsForSub = (subId) => {
  const apps = new Set();

  tableData.forEach((entry) => {
    const matchesSubId = String(entry?.subId || '') === String(subId);

    if (matchesSubId && entry?.appId) {
      apps.add(String(entry.appId));
    }
  });

  return apps.size;
};

// Check whether an app bucket has processed window results.
const hasProcessedWindow = (appBucket) => {
  return Object.values(appBucket?.windows || {}).some((bucket) => bucket?.isProcessed);
};

// Count the apps with processed metadata per SubID.
const getScannedAppsForSub = (subId) => {
  const aggregations = getMetadataAggregations();
  const appBuckets = aggregations?.[subId]?.apps;

  if (!appBuckets || typeof appBuckets !== 'object') {
    return 0;
  }

  return Object.values(appBuckets).filter((bucket) => hasProcessedWindow(bucket)).length;
};

// Render the subscription summary list in the provided container.
const renderSubscriptionSummary = (container) => {
  if (!container) {
    return;
  }

  container.textContent = '';
  const subIds = getSubIds();

  if (!subIds.length) {
    container.textContent = 'No subscription data yet.';
    return;
  }

  const list = document.createElement('ul');
  list.className = 'subscription-progress-list';

  subIds.forEach((subId) => {
    const totalApps = getTotalAppsForSub(subId);
    const scannedApps = getScannedAppsForSub(subId);
    const targetTotal = Math.max(totalApps, scannedApps);

    const item = document.createElement('li');
    item.className = 'subscription-progress-item';

    const label = document.createElement('span');
    label.className = 'subscription-progress-label';
    label.textContent = subId || 'Unknown SubID';

    const status = document.createElement('span');
    status.className = 'subscription-progress-status';
    status.textContent = `Apps Scanned ${scannedApps} out of ${targetTotal}`;

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
