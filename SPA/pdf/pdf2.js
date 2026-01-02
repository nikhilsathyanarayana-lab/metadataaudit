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
    label: 'Applications per field',
    data: [65, 59, 80, 81, 56, 55, 40],
    backgroundColor: defaultBarBackgrounds,
    borderColor: defaultBarBorders,
    borderWidth: 1
  }]
};

let subBarData = defaultSubBarData;
let fieldSubBarChart;

// Build a default field occurrence map from the sample chart data.
const buildDefaultFieldOccurrences = () => {
  const defaultDataset = defaultSubBarData.datasets?.[0] || {};

  return (defaultSubBarData.labels || []).reduce((occurrences, label, index) => {
    const defaultCount = Array.isArray(defaultDataset.data)
      ? Number(defaultDataset.data[index]) || 0
      : 0;

    occurrences[label] = defaultCount;
    return occurrences;
  }, {});
};

let fieldOccurrencesByName = buildDefaultFieldOccurrences();
let fieldSummaryRows = [];

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

// Build a bar dataset showing how many applications include each field.
const buildSubBarData = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const fieldCounts = countFieldsAcrossApps(aggregations);
  const fieldKeys = Object.keys(fieldCounts || {});

  if (!fieldKeys.length) {
    return defaultSubBarData;
  }

  const backgrounds = fieldKeys.map((_, index) => defaultBarBackgrounds[index % defaultBarBackgrounds.length]);
  const borders = fieldKeys.map((_, index) => defaultBarBorders[index % defaultBarBorders.length]);

  return {
    labels: fieldKeys,
    datasets: [{
      label: 'Applications per field',
      data: fieldKeys.map((fieldKey) => fieldCounts[fieldKey] || 0),
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
  const barTitle = document.getElementById('field-bar-title');

  if (!barCanvas) {
    return;
  }

  if (barTitle) {
    barTitle.textContent = 'Applications per Field';
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
  const computedOccurrences = countFieldsAcrossApps(aggregations);
  fieldOccurrencesByName = Object.keys(computedOccurrences).length
    ? computedOccurrences
    : buildDefaultFieldOccurrences();
  console.log('Field occurrence counts', fieldOccurrencesByName);
};

// Convert the field occurrence map into summary rows for the table.
const buildFieldSummaryRowsFromOccurrences = (occurrences = fieldOccurrencesByName) => {
  const occurrenceEntries = Object.entries(occurrences || {});

  if (!occurrenceEntries.length) {
    return [];
  }

  return occurrenceEntries
    .sort(([, countA], [, countB]) => Number(countB) - Number(countA))
    .map(([label, count]) => ({ label, count: Number(count) || 0 }));
};

// Sync cached metadata aggregations with the bar chart.
const updateFromMetadataAggregations = (aggregations) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return;
  }

  window.metadataAggregations = aggregations;
  updateFieldOccurrences(aggregations);
  subBarData = buildSubBarData(aggregations);
  fieldSummaryRows = buildFieldSummaryRowsFromOccurrences();

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

    updateFieldOccurrences(window.metadataAggregations);
    subBarData = buildSubBarData(window.metadataAggregations);
    fieldSummaryRows = buildFieldSummaryRowsFromOccurrences();
    renderFieldAnalysis();
    renderFieldSummaryTable();
  };

  window.addEventListener('message', handleMetadataMessage);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderPdfPreview);
  } else {
    renderPdfPreview();
  }
}
