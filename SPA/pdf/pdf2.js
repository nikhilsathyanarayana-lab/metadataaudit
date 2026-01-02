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

// Build a default field total map from the sample chart data.
const buildDefaultFieldTotals = () => {
  const defaultDataset = defaultSubBarData.datasets?.[0] || {};

  return (defaultSubBarData.labels || []).reduce((occurrences, label, index) => {
    const defaultCount = Array.isArray(defaultDataset.data)
      ? Number(defaultDataset.data[index]) || 0
      : 0;

    occurrences[label] = defaultCount;
    return occurrences;
  }, {});
};

let fieldTotalsByName = buildDefaultFieldTotals();
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

// Choose a processed window bucket for an app when tallying field totals.
const selectProcessedWindow = (appBucket) => {
  if (!appBucket || typeof appBucket !== 'object') {
    return null;
  }

  const windows = Object.values(appBucket.windows || {});

  if (!windows.length) {
    return null;
  }

  return windows.find((windowBucket) => windowBucket?.isProcessed) || windows[0];
};

// Combine field totals across apps with the same name, segmented by namespace.
const combineFieldTotalsByNamespace = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return {};
  }

  const appTotalsByName = {};

  Object.values(aggregations).forEach((subBucket) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return;
    }

    Object.values(apps).forEach((appBucket) => {
      const appName = appBucket?.appName || appBucket?.appId;
      const processedWindow = selectProcessedWindow(appBucket);

      if (!appName || !processedWindow || typeof processedWindow !== 'object') {
        return;
      }

      if (!appTotalsByName[appName]) {
        appTotalsByName[appName] = {};
      }

      Object.entries(processedWindow.namespaces || {}).forEach(([namespaceKey, namespaceFields]) => {
        if (!namespaceFields || typeof namespaceFields !== 'object') {
          return;
        }

        Object.entries(namespaceFields).forEach(([fieldName, fieldBucket]) => {
          const total = Number(fieldBucket?.total) || 0;

          if (!total) {
            return;
          }

          const fieldKey = `${namespaceKey}.${fieldName}`;
          appTotalsByName[appName][fieldKey] = (appTotalsByName[appName][fieldKey] || 0) + total;
        });
      });
    });
  });

  return Object.values(appTotalsByName).reduce((totals, appTotals) => {
    Object.entries(appTotals).forEach(([fieldKey, total]) => {
      totals[fieldKey] = (totals[fieldKey] || 0) + Number(total || 0);
    });

    return totals;
  }, {});
};

// Build a bar dataset showing how many applications include each field.
const buildSubBarData = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const fieldCounts = countFieldsAcrossApps(aggregations);
  const fieldEntries = Object.entries(fieldCounts || {})
    .sort(([, countA], [, countB]) => Number(countB) - Number(countA))
    .slice(0, 10);

  if (!fieldEntries.length) {
    return defaultSubBarData;
  }

  const fieldKeys = fieldEntries.map(([fieldKey]) => fieldKey);
  const backgrounds = fieldKeys.map((_, index) => defaultBarBackgrounds[index % defaultBarBackgrounds.length]);
  const borders = fieldKeys.map((_, index) => defaultBarBorders[index % defaultBarBorders.length]);

  return {
    labels: fieldKeys,
    datasets: [{
      data: fieldEntries.map(([, count]) => Number(count) || 0),
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
      title: { display: false }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          stepSize: 1,
          callback: (value) => (Number.isInteger(value) ? value : null)
        }
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
    barTitle.textContent = 'Top 10 Fields per Application';
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

// Update cached field totals and log them to the console.
const updateFieldTotals = (aggregations) => {
  const computedTotals = combineFieldTotalsByNamespace(aggregations);
  fieldTotalsByName = Object.keys(computedTotals).length
    ? computedTotals
    : buildDefaultFieldTotals();
  console.log('Field record totals', fieldTotalsByName);
};

// Convert the field totals map into summary rows for the table.
const buildFieldSummaryRowsFromTotals = (totals = fieldTotalsByName) => {
  const totalEntries = Object.entries(totals || {});

  if (!totalEntries.length) {
    return [];
  }

  return totalEntries
    .sort(([, countA], [, countB]) => Number(countB) - Number(countA))
    .map(([label, count]) => ({ label, count: Number(count) || 0 }));
};

// Sync cached metadata aggregations with the bar chart.
const updateFromMetadataAggregations = (aggregations) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return;
  }

  window.metadataAggregations = aggregations;
  updateFieldTotals(aggregations);
  subBarData = buildSubBarData(aggregations);
  fieldSummaryRows = buildFieldSummaryRowsFromTotals();

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

    updateFieldTotals(window.metadataAggregations);
    subBarData = buildSubBarData(window.metadataAggregations);
    fieldSummaryRows = buildFieldSummaryRowsFromTotals();
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
