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
const emptyValueTokens = new Set(['null', 'undefined']);

// Return true when the page is being rendered for PDF export.
const isPdfExportContext = () => (
  typeof window !== 'undefined' && window.__pdfExportMode === true
);

// Dispatch a ready signal after this PDF page finishes rendering.
const dispatchPdfReady = () => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return;
  }

  window.dispatchEvent(new CustomEvent('pdf:ready'));
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

const windowLabelMap = {
  1: '1 day',
  7: '7 days',
  30: '30 days',
  180: '180 days'
};

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

// Build a readable list from one or more timeframe labels.
const formatTimeframeList = (labels = []) => {
  if (!labels.length) {
    return '';
  }

  if (labels.length === 1) {
    return labels[0];
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
};

// Collect the export timeframe labels that have processed metadata.
const getScannedTimeframes = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const processedWindows = new Set();

  if (!aggregations || typeof aggregations !== 'object') {
    return [];
  }

  Object.values(aggregations).forEach((subBucket) => {
    Object.values(subBucket?.apps || {}).forEach((appBucket) => {
      const windowBuckets = appBucket?.windows || {};
      const hasWindow1 = Boolean(windowBuckets?.[1]?.isProcessed || windowBuckets?.['1']?.isProcessed);
      const hasWindow7 = Boolean(windowBuckets?.[7]?.isProcessed || windowBuckets?.['7']?.isProcessed);
      const hasWindow23 = Boolean(windowBuckets?.[23]?.isProcessed || windowBuckets?.['23']?.isProcessed);
      const hasWindow150 = Boolean(windowBuckets?.[150]?.isProcessed || windowBuckets?.['150']?.isProcessed);

      if (hasWindow1) {
        processedWindows.add(1);
      }

      if (hasWindow7) {
        processedWindows.add(7);
      }

      if (hasWindow7 && hasWindow23) {
        processedWindows.add(30);
      }

      if (hasWindow7 && hasWindow23 && hasWindow150) {
        processedWindows.add(180);
      }
    });
  });

  return Array.from(processedWindows)
    .sort((first, second) => first - second)
    .map((windowKey) => windowLabelMap[windowKey])
    .filter(Boolean);
};

// Show the scanned timeframe near the top of the PDF overview page.
const renderOverviewTimeframe = () => {
  const timeframeElement = document.getElementById('overview-timeframe');
  const scannedTimeframes = getScannedTimeframes();

  if (!timeframeElement) {
    return;
  }

  if (!scannedTimeframes.length) {
    timeframeElement.textContent = 'Scanned timeframe: no completed metadata window was available for this export.';
    return;
  }

  timeframeElement.textContent = `Scanned timeframe: ${formatTimeframeList(scannedTimeframes)}.`;
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

// Return true when a tracked field value should be treated as empty for audit purposes.
const isEmptyValueLabel = (valueLabel) => {
  const normalizedLabel = String(valueLabel ?? '').trim();

  return normalizedLabel === '' || emptyValueTokens.has(normalizedLabel.toLowerCase());
};

// Summarize high-level audit counts used by the overview cards.
const collectAuditSummary = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const summary = {
    appsWithMetadata: 0,
    fieldsWithValues: 0,
    distinctValues: 0,
    fieldsWithEmptyValues: 0,
    emptyValueCount: 0,
  };

  if (!aggregations || typeof aggregations !== 'object') {
    return summary;
  }

  const fieldMetrics = {};

  Object.values(aggregations).forEach((subBucket) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return;
    }

    Object.entries(apps).forEach(([appId, appBucket]) => {
      const hasProcessedWindow = Object.values(appBucket?.windows || {}).some((windowBucket) => (
        Boolean(windowBucket?.isProcessed)
      ));

      if (hasProcessedWindow) {
        summary.appsWithMetadata += 1;
      }

      Object.values(appBucket?.windows || {}).forEach((windowBucket) => {
        Object.entries(windowBucket?.namespaces || {}).forEach(([namespaceKey, namespaceFields]) => {
          Object.entries(namespaceFields || {}).forEach(([fieldName, fieldBucket]) => {
            const fieldKey = `${appId}|||${namespaceKey}.${fieldName}`;
            const values = fieldBucket?.values || {};

            if (!fieldMetrics[fieldKey]) {
              fieldMetrics[fieldKey] = {
                distinctValues: new Set(),
                emptyValueCount: 0,
              };
            }

            Object.entries(values).forEach(([valueLabel, count]) => {
              fieldMetrics[fieldKey].distinctValues.add(valueLabel);

              if (isEmptyValueLabel(valueLabel)) {
                fieldMetrics[fieldKey].emptyValueCount += Number(count) || 0;
              }
            });
          });
        });
      });
    });
  });

  Object.values(fieldMetrics).forEach((fieldMetric) => {
    summary.fieldsWithValues += 1;
    summary.distinctValues += fieldMetric.distinctValues.size;

    if (fieldMetric.emptyValueCount > 0) {
      summary.fieldsWithEmptyValues += 1;
      summary.emptyValueCount += fieldMetric.emptyValueCount;
    }
  });

  return summary;
};

// Populate the overview cards that frame the export around the audit use cases.
const renderAuditSummary = () => {
  const summary = collectAuditSummary();
  const fieldsValue = document.getElementById('audit-summary-fields-value');
  const fieldsText = document.getElementById('audit-summary-fields-text');
  const valuesValue = document.getElementById('audit-summary-values-value');
  const valuesText = document.getElementById('audit-summary-values-text');
  const emptiesValue = document.getElementById('audit-summary-empties-value');
  const emptiesText = document.getElementById('audit-summary-empties-text');

  if (fieldsValue) {
    fieldsValue.textContent = summary.appsWithMetadata.toLocaleString();
  }

  if (fieldsText) {
    fieldsText.textContent = `${summary.appsWithMetadata.toLocaleString()} applications sent metadata in the scanned timeframe.`;
  }

  if (valuesValue) {
    valuesValue.textContent = summary.distinctValues.toLocaleString();
  }

  if (valuesText) {
    valuesText.textContent = `${summary.fieldsWithValues.toLocaleString()} fields have at least one tracked value across the scanned timeframe.`;
  }

  if (emptiesValue) {
    emptiesValue.textContent = summary.fieldsWithEmptyValues.toLocaleString();
  }

  if (emptiesText) {
    emptiesText.textContent = `${summary.emptyValueCount.toLocaleString()} blank, null, or undefined values were detected. See the Empty Value Hotspots table for the specific apps and fields.`;
  }
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

// Count how many apps are represented in the donut dataset.
const getSubScanCount = (dataset = subDonutData?.datasets?.[0]?.data) => {
  if (!Array.isArray(dataset)) {
    return 0;
  }

  return dataset.reduce((total, value) => total + (Number(value) || 0), 0);
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

// Draw the app total in the center of the doughnut chart after rendering.
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
    ctx.fillText('Apps', centerX, centerY + 12);
    ctx.restore();
  }
};

// Render the chart preview when the PDF iframe is ready.
let subDonutChart;
let subBarChart;

// Build a donut dataset using the discovered SubIDs in the metadata cache.
const buildSubDonutData = (aggregations = window.metadataAggregations) => {
  const subscriptionIds = getSubscriptionIds(aggregations);
  const appTotals = getTotalAppsBySubscription(aggregations);

  if (!subscriptionIds.length) {
    return defaultSubDonutData;
  }

  const palette = defaultSubDonutData?.datasets?.[0]?.backgroundColor || [];

  return {
    labels: subscriptionIds.map((subId) => formatSubscriptionDisplay(subId)),
    datasets: [{
      label: 'Apps by SubID',
      data: subscriptionIds.map((subId) => Number(appTotals?.[subId]?.total) || 0),
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
      animation: isPdfExportContext() ? false : undefined,
      plugins: {
        title: { display: false },
        legend: { display: false }
      }
    },
    plugins: [subDonutCenterText, subDonutSliceLabels]
  });

  const subBarConfig = createSubBarConfig(subBarData);

  if (isPdfExportContext()) {
    subBarConfig.options = {
      ...(subBarConfig.options || {}),
      animation: false,
    };
  }

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
    renderAuditSummary();
    renderOverviewTimeframe();
    renderPdfCharts();
    dispatchPdfReady();
  };

  const renderPdfPreview = () => {
    if (hasMetadataAggregations()) {
      subDonutData = buildSubDonutData(window.metadataAggregations);
      subBarData = buildSubBarData(window.metadataAggregations);
      window.subDonutData = subDonutData;
      renderSubscriptionTable();
      renderNamespaceSummaryCounts();
    }

    renderAuditSummary();
    renderOverviewTimeframe();
    renderPdfCharts();
    dispatchPdfReady();
  };

  window.addEventListener('message', handleMetadataMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPdfPreview);
  } else {
    renderPdfPreview();
  }
}
