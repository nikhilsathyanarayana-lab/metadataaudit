// Use provided donut data when available, otherwise fall back to sample values.
const defaultSubDonutData = {
  datasets: [{
    label: 'SubID coverage',
    data: [300, 50, 100],
    backgroundColor: [
      'rgb(255, 99, 132)',
      'rgb(54, 162, 235)',
      'rgb(255, 205, 86)'
    ],
    hoverOffset: 4
  }]
};

let subDonutData = (typeof window !== 'undefined' && window.subDonutData)
  ? window.subDonutData
  : defaultSubDonutData;

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

const defaultSubscriptionIds = Array.from({ length: 10 }, (_, index) => `Sub ${String(index + 1).padStart(2, '0')}`);

const defaultSubBarData = {
  labels: defaultSubscriptionIds,
  datasets: [{
    data: defaultSubscriptionIds.map(() => 0),
    backgroundColor: defaultSubscriptionIds.map((_, index) => defaultBarBackgrounds[index % defaultBarBackgrounds.length]),
    borderColor: defaultSubscriptionIds.map((_, index) => defaultBarBorders[index % defaultBarBorders.length]),
    borderWidth: 1
  }]
};

let subBarData = defaultSubBarData;
const namespaceKeys = ['visitor', 'account', 'custom', 'salesforce'];
const namespaceSummaryTargets = {
  visitor: 'namespace-visitor-count',
  account: 'namespace-account-count',
  custom: 'namespace-custom-count',
  salesforce: 'namespace-salesforce-count'
};

// Confirm whether cached metadata aggregations are available on the window.
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



// Count distinct app IDs for each SubID directly from the metadata cache.
const countDistinctAppsBySubscription = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
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
    };

    return counts;
  }, {});
};

// Read total app counts from the provided totals map or fall back to metadata totals.
const getTotalAppsBySubscription = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (typeof window !== 'undefined' && window.appCountsBySubId && typeof window.appCountsBySubId === 'object') {
    return window.appCountsBySubId;
  }

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

    counts[subId] = {
      total: Array.isArray(apps) ? apps.length : appIds.length,
    };

    return counts;
  }, {});
};

// Summarize total records scanned per SubID.
const countRecordsBySubscription = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return {};
  }

  return Object.entries(aggregations).reduce((counts, [subId, details]) => {
    if (!subId || !details || typeof details !== 'object') {
      return counts;
    }

    counts[subId] = Number(details.recordsScanned) || 0;

    return counts;
  }, {});
};

// Build a bar dataset that lists record totals per SubID.
const buildSubBarData = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const recordCounts = countRecordsBySubscription(aggregations);
  const subscriptionIds = Object.keys(recordCounts || {});

  if (!subscriptionIds.length) {
    return defaultSubBarData;
  }

  const backgrounds = subscriptionIds.map((_, index) => defaultBarBackgrounds[index % defaultBarBackgrounds.length]);
  const borders = subscriptionIds.map((_, index) => defaultBarBorders[index % defaultBarBorders.length]);

  return {
    labels: subscriptionIds.map((subId) => formatSubscriptionDisplay(subId)),
    datasets: [{
      data: subscriptionIds.map((subId) => recordCounts[subId] || 0),
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
    plugins: {
      title: { display: false },
      legend: { display: false }
    },
    scales: {
      y: {
        beginAtZero: true
      }
    }
  }
});

// Return zeroed namespace totals for the summary view.
const createNamespaceTotals = () => namespaceKeys.reduce((totals, namespaceKey) => ({
  ...totals,
  [namespaceKey]: 0
}), {});

// Sum non-null metadata value volume by namespace from each aggregation bucket.
const collectNamespaceValueTotals = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return createNamespaceTotals();
  }

  return Object.values(aggregations).reduce((totals, subBucket) => {
    const nonNullByNamespace = subBucket?.nonNullRecordsByNamespace;

    if (!nonNullByNamespace || typeof nonNullByNamespace !== 'object') {
      return totals;
    }

    namespaceKeys.forEach((namespaceKey) => {
      totals[namespaceKey] += Number(nonNullByNamespace[namespaceKey]) || 0;
    });

    return totals;
  }, createNamespaceTotals());
};

// Collect SubIDs from the cached metadata aggregations.
const getSubscriptionIds = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return [];
  }

  console.log('getSubscriptionIds: collecting SubIDs');
  return Object.keys(aggregations)
    .filter((subId) => subId)
    .sort((first, second) => formatSubscriptionDisplay(first).localeCompare(formatSubscriptionDisplay(second))
      || first.localeCompare(second));
};

// Populate the subscription summary table with discovered SubIDs.
const renderSubscriptionTable = () => {
  const tableBody = document.getElementById('subscription-table-body');
  const subscriptionIds = getSubscriptionIds();
  const distinctCounts = countDistinctAppsBySubscription();
  const totalCounts = getTotalAppsBySubscription();

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
    row.id = `subscription-row-${rowNumber}`;
    row.className = 'subscription-row';

    const labelCell = document.createElement('td');
    labelCell.id = `subscription-label-${rowNumber}`;
    labelCell.className = 'subscription-label-cell';
    labelCell.textContent = formatSubscriptionDisplay(subId);

    const countCell = document.createElement('td');
    countCell.id = `subscription-count-${rowNumber}`;
    countCell.className = 'subscription-count-cell';
    const { distinct = 0 } = distinctCounts[subId] || {};
    const { total = 0 } = totalCounts[subId] || {};
    countCell.textContent = `${distinct} of ${total}`;

    row.append(labelCell, countCell);
    tableBody.appendChild(row);
  });
};

// Populate the namespace summary counts using non-null namespace value totals.
const renderNamespaceSummaryCounts = () => {
  const totals = collectNamespaceValueTotals();

  Object.entries(namespaceSummaryTargets).forEach(([namespaceKey, elementId]) => {
    const countElement = document.getElementById(elementId);

    if (!countElement) {
      return;
    }

    countElement.textContent = totals[namespaceKey] ?? 0;
  });
};

// Count how many SubID slices are represented in the donut dataset.
const getSubScanCount = (dataset = subDonutData?.datasets?.[0]?.data) => {
  const count = Array.isArray(dataset) ? dataset.length : 0;
  return count;
};

// Draw the individual sub counts on top of each donut slice.
const subDonutSliceLabels = {
  id: 'subDonutSliceLabels',
  afterDatasetDraw(chart, args) {
    const meta = chart?.getDatasetMeta(args.index);
    const dataset = chart?.data?.datasets?.[args.index];

    if (!meta || !dataset || !Array.isArray(dataset.data)) {
      return;
    }

    const { ctx } = chart;
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    meta.data.forEach((arc, index) => {
      const value = dataset.data[index];

      if (value === undefined || value === null) {
        return;
      }

      const angle = (arc.startAngle + arc.endAngle) / 2;
      const radius = arc.innerRadius + ((arc.outerRadius - arc.innerRadius) / 2);
      const x = arc.x + (radius * Math.cos(angle));
      const y = arc.y + (radius * Math.sin(angle));

      ctx.fillText(String(value), x, y);
    });

    ctx.restore();
  }
};

// Draw the SubID scan total in the center of the doughnut chart after rendering.
const subDonutCenterText = {
  id: 'subDonutCenterText',
  afterDraw(chart) {
    const { ctx, chartArea: { left, top, width, height } } = chart;
    const count = getSubScanCount(chart?.data?.datasets?.[0]?.data);

    const centerX = left + (width / 2);
    const centerY = top + (height / 2);

    ctx.save();
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), centerX, centerY - 8);
    ctx.font = '12px sans-serif';
    ctx.fillText('Subscriptions', centerX, centerY + 12);
    ctx.restore();
  }
};

// Render the chart preview when the PDF iframe is ready.
let subDonutChart;
let subBarChart;

// Build a donut dataset using the discovered SubIDs in the metadata cache.
const buildSubDonutData = (aggregations = window.metadataAggregations) => {
  const subscriptionIds = getSubscriptionIds(aggregations);

  if (!subscriptionIds.length) {
    return defaultSubDonutData;
  }

  const palette = defaultSubDonutData?.datasets?.[0]?.backgroundColor || [];

  return {
    labels: subscriptionIds.map((subId) => formatSubscriptionDisplay(subId)),
    datasets: [{
      label: 'SubID coverage',
      data: subscriptionIds.map(() => 1),
      backgroundColor: palette,
      hoverOffset: 4
    }]
  };
};

// Render the chart preview when the PDF iframe is ready.
const renderPdfCharts = () => {
  if (typeof Chart === 'undefined') {
    return;
  }

  const subDonutCanvas = document.getElementById('subDonut');
  const subBarCanvas = document.getElementById('subBar');

  if (!subDonutCanvas || !subBarCanvas) {
    return;
  }

  subDonutChart?.destroy();
  subBarChart?.destroy();

  subDonutChart = new Chart(subDonutCanvas, {
    type: 'doughnut',
    data: subDonutData,
    options: {
      plugins: {
        title: { display: false },
        legend: { display: false }
      }
    },
    plugins: [subDonutCenterText, subDonutSliceLabels]
  });

  const subBarConfig = createSubBarConfig(subBarData);
  subBarChart = new Chart(subBarCanvas, subBarConfig);
};

if (typeof document !== 'undefined') {
  // Refresh the PDF view when metadata updates arrive from the parent window.
  const handleMetadataMessage = (event) => {
    const message = event?.data;

    if (!message || message.type !== 'metadataAggregations') {
      return;
    }

    const payload = message.payload || {};
    window.fieldTypeSelections = message.fieldTypeSelections || {};
    const aggregations = payload.metadataAggregations || (payload.appCountsBySubId ? {} : payload) || {};
    const incomingAppCounts = payload.appCountsBySubId || message.appCountsBySubId;

    window.metadataAggregations = aggregations || {};

    subscriptionLabels = message.subscriptionLabels && typeof message.subscriptionLabels === 'object'
      ? message.subscriptionLabels
      : {};
    window.subscriptionLabels = subscriptionLabels;

    if (incomingAppCounts && typeof incomingAppCounts === 'object') {
      window.appCountsBySubId = incomingAppCounts;
    }

    subDonutData = buildSubDonutData(window.metadataAggregations);
    subBarData = buildSubBarData(window.metadataAggregations);
    window.subDonutData = subDonutData;

    renderSubscriptionTable();
    renderNamespaceSummaryCounts();
    renderPdfCharts();
  };

  const renderPdfPreview = () => {
    if (hasMetadataAggregations()) {
      subDonutData = buildSubDonutData(window.metadataAggregations);
      subBarData = buildSubBarData(window.metadataAggregations);
      window.subDonutData = subDonutData;
      renderSubscriptionTable();
      renderNamespaceSummaryCounts();
    }

    renderPdfCharts();
  };

  window.addEventListener('message', handleMetadataMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPdfPreview);
  } else {
    renderPdfPreview();
  }
}
