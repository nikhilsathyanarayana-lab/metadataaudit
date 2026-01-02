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
    label: 'Most common fields',
    data: [65, 59, 80, 81, 56, 55, 40],
    backgroundColor: defaultBarBackgrounds,
    borderColor: defaultBarBorders,
    borderWidth: 1
  }]
};

let subBarData = defaultSubBarData;
let fieldSubBarChart;
let fieldOccurrencesByName = {};

const defaultFieldSummaryRows = [
  { label: 'Email', count: 1450 },
  { label: 'User ID', count: 1380 },
  { label: 'Account ID', count: 1215 },
  { label: 'Last Seen', count: 1140 },
  { label: 'Region', count: 940 }
];

let fieldSummaryRows = defaultFieldSummaryRows;

// Check whether the window already includes metadata aggregations we can use.
const hasMetadataAggregations = () => (
  typeof window !== 'undefined'
    && window.metadataAggregations
    && typeof window.metadataAggregations === 'object'
);

// Count how many apps expose each namespace/field combination across all SubIDs.
const countFieldsAcrossApps = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return {};
  }

  return Object.values(aggregations).reduce((counts, subBucket) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return counts;
    }

    Object.values(apps).forEach((appBucket) => {
      const appFieldKeys = new Set();

      Object.values(appBucket?.windows || {}).forEach((windowBucket) => {
        Object.entries(windowBucket?.namespaces || {}).forEach(([namespaceKey, namespaceFields]) => {
          Object.keys(namespaceFields || {}).forEach((fieldName) => {
            appFieldKeys.add(`${namespaceKey}.${fieldName}`);
          });
        });
      });

      appFieldKeys.forEach((fieldKey) => {
        counts[fieldKey] = (counts[fieldKey] || 0) + 1;
      });
    });

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
    labels: subscriptionIds,
    datasets: [{
      label: 'Most common fields',
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
    scales: {
      y: {
        beginAtZero: true
      }
    }
  }
});

// Render the Field Analysis bar chart.
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

// Render a mock field summary table beneath the bar chart.
const renderFieldSummaryTable = (rows = fieldSummaryRows) => {
  const tableBody = document.getElementById('field-summary-body');

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';

  rows.forEach((row, index) => {
    const rowNumber = String(index + 1).padStart(2, '0');
    const summaryRow = document.createElement('tr');
    summaryRow.id = `field-row-${rowNumber}`;
    summaryRow.className = 'subscription-row';

    const labelCell = document.createElement('td');
    labelCell.id = `field-label-${rowNumber}`;
    labelCell.className = 'subscription-label-cell';
    labelCell.textContent = row.label || '';

    const countCell = document.createElement('td');
    countCell.id = `field-count-${rowNumber}`;
    countCell.className = 'subscription-count-cell';
    countCell.textContent = (row.count ?? '')?.toString();

    summaryRow.append(labelCell, countCell);
    tableBody.appendChild(summaryRow);
  });
};

// Update cached field occurrence pairs and log them to the console.
const updateFieldOccurrences = (aggregations) => {
  fieldOccurrencesByName = countFieldsAcrossApps(aggregations);
  console.log('Field occurrence counts', fieldOccurrencesByName);
};

// Sync cached metadata aggregations with the bar chart.
const updateFromMetadataAggregations = (aggregations) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return;
  }

  window.metadataAggregations = aggregations;
  subBarData = buildSubBarData(aggregations);
  fieldSummaryRows = defaultFieldSummaryRows;
  updateFieldOccurrences(aggregations);

  renderFieldAnalysis();
  renderFieldSummaryTable();
};

if (typeof document !== 'undefined') {
  // Refresh the Field Analysis view when metadata updates arrive from the parent window.
  const handleMetadataMessage = (event) => {
    const message = event?.data;

    if (!message || message.type !== 'metadataAggregations') {
      return;
    }

    updateFromMetadataAggregations(message.payload || {});
  };

  const renderPdfPreview = () => {
    if (hasMetadataAggregations()) {
      updateFromMetadataAggregations(window.metadataAggregations);
      return;
    }

    renderFieldAnalysis();
    renderFieldSummaryTable();
    updateFieldOccurrences(window.metadataAggregations);
  };

  window.addEventListener('message', handleMetadataMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPdfPreview);
  } else {
    renderPdfPreview();
  }
}
