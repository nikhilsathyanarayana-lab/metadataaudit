const defaultBarBackgrounds = [
  'rgba(255, 99, 132, 0.2)',
  'rgba(255, 159, 64, 0.2)',
  'rgba(255, 205, 86, 0.2)',
  'rgba(75, 192, 192, 0.2)',
  'rgba(54, 162, 235, 0.2)',
  'rgba(153, 102, 255, 0.2)',
  'rgba(201, 203, 207, 0.2)'
];

const defaultBarBorders = [
  'rgb(255, 99, 132)',
  'rgb(255, 159, 64)',
  'rgb(255, 205, 86)',
  'rgb(75, 192, 192)',
  'rgb(54, 162, 235)',
  'rgb(153, 102, 255)',
  'rgb(201, 203, 207)'
];

const defaultSubBarData = {
  labels: ['January', 'February', 'March', 'April', 'May', 'June', 'July'],
  datasets: [{
    label: 'Apps scanned',
    data: [65, 59, 80, 81, 56, 55, 40],
    backgroundColor: defaultBarBackgrounds,
    borderColor: defaultBarBorders,
    borderWidth: 1
  }]
};

let subBarData = defaultSubBarData;
let fieldSubBarChart;

// Check whether the window already includes metadata aggregations we can use.
const hasMetadataAggregations = () => (
  typeof window !== 'undefined'
    && window.metadataAggregations
    && typeof window.metadataAggregations === 'object'
);

// Count distinct and total app IDs for each SubID in the metadata cache.
const countAppsBySubscription = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return {};
  }

  return Object.entries(aggregations).reduce((counts, [subId, details]) => {
    if (!subId || !details || typeof details !== 'object') {
      return counts;
    }

    const apps = details.apps;

    if (!apps || typeof apps !== 'object') {
      return counts;
    }

    const appIds = Array.isArray(apps)
      ? apps.map((app) => app?.appId).filter(Boolean)
      : Object.keys(apps);

    const uniqueIds = new Set(appIds);

    counts[subId] = {
      distinct: uniqueIds.size,
      total: Array.isArray(apps) ? apps.length : appIds.length,
    };

    return counts;
  }, {});
};

// Collect SubIDs from the cached metadata aggregations.
const getSubscriptionIds = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return [];
  }

  return Object.keys(aggregations).filter((subId) => subId);
};

// Populate the Field Analysis subscription table.
const renderSubscriptionTable = () => {
  const tableBody = document.getElementById('field-subscription-table-body');
  const subscriptionIds = getSubscriptionIds();
  const appCounts = countAppsBySubscription();

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  if (subscriptionIds.length === 0) {
    return;
  }

  subscriptionIds.forEach((subId, index) => {
    const rowNumber = String(index + 1).padStart(2, '0');
    const row = document.createElement('tr');
    row.id = `field-subscription-row-${rowNumber}`;
    row.className = 'subscription-row';

    const labelCell = document.createElement('td');
    labelCell.id = `field-subscription-label-${rowNumber}`;
    labelCell.className = 'subscription-label-cell';
    labelCell.textContent = subId;

    const countCell = document.createElement('td');
    countCell.id = `field-subscription-count-${rowNumber}`;
    countCell.className = 'subscription-count-cell';
    const { distinct = 0, total = 0 } = appCounts[subId] || {};
    countCell.textContent = `${distinct} of ${total}`;

    row.append(labelCell, countCell);
    tableBody.appendChild(row);
  });
};

// Build a bar dataset that lists app totals per SubID.
const buildSubBarData = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const appCounts = countAppsBySubscription(aggregations);
  const subscriptionIds = Object.keys(appCounts || {});

  if (!subscriptionIds.length) {
    return defaultSubBarData;
  }

  const backgrounds = subscriptionIds.map((_, index) => defaultBarBackgrounds[index % defaultBarBackgrounds.length]);
  const borders = subscriptionIds.map((_, index) => defaultBarBorders[index % defaultBarBorders.length]);

  return {
    labels: subscriptionIds,
    datasets: [{
      label: 'Apps scanned',
      data: subscriptionIds.map((subId) => appCounts[subId]?.total || 0),
      backgroundColor: backgrounds,
      borderColor: borders,
      borderWidth: 1
    }]
  };
};

// Create a Chart.js bar config that keeps the Y-axis anchored at zero.
const createSubBarConfig = (data) => ({
  type: 'bar',
  data,
  options: {
    scales: {
      y: {
        beginAtZero: true
      }
    }
  }
});

// Render the Field Analysis table and bar chart.
const renderFieldAnalysis = () => {
  if (typeof Chart === 'undefined') {
    return;
  }

  const barCanvas = document.getElementById('fieldSubBar');

  if (!barCanvas) {
    return;
  }

  fieldSubBarChart?.destroy();
  fieldSubBarChart = new Chart(barCanvas, createSubBarConfig(subBarData));
};

if (typeof document !== 'undefined') {
  // Refresh the Field Analysis view when metadata updates arrive from the parent window.
  const handleMetadataMessage = (event) => {
    const message = event?.data;

    if (!message || message.type !== 'metadataAggregations') {
      return;
    }

    window.metadataAggregations = message.payload || {};
    subBarData = buildSubBarData(window.metadataAggregations);

    renderSubscriptionTable();
    renderFieldAnalysis();
  };

  const renderPdfPreview = () => {
    if (hasMetadataAggregations()) {
      subBarData = buildSubBarData(window.metadataAggregations);
      renderSubscriptionTable();
    }

    renderFieldAnalysis();
  };

  window.addEventListener('message', handleMetadataMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPdfPreview);
  } else {
    renderPdfPreview();
  }
}
