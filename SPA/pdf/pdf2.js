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
let fieldTotalsByWindow = {};
let fieldDifferencesByApp = [];

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
// Build default per-window totals from the sample chart data.
const buildDefaultWindowTotals = () => ({
  sevenDay: buildDefaultFieldTotals(),
  otherWindows: {},
});

fieldTotalsByWindow = buildDefaultWindowTotals();
let fieldSummaryRows = [];
const WINDOW_COLUMNS = [
  { key: 'sevenDay', match: (windowKey) => Number(windowKey) === 7, label: '7-Day Records' },
  { key: 'otherWindows', match: (windowKey) => Number(windowKey) !== 7, label: 'Other Window Records' }
];

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

// Resolve which summary column should hold totals for a window bucket.
const getColumnKeyForWindow = (windowKey) => {
  const matchingColumn = WINDOW_COLUMNS.find((column) => column.match(windowKey));
  return matchingColumn?.key;
};

// Combine field totals across apps by window column without discarding buckets.
const combineFieldTotalsByWindow = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return buildDefaultWindowTotals();
  }

  const totalsByWindow = WINDOW_COLUMNS.reduce((accumulator, column) => ({
    ...accumulator,
    [column.key]: {},
  }), {});

  Object.values(aggregations).forEach((subBucket) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return;
    }

    Object.values(apps).forEach((appBucket) => {
      Object.entries(appBucket?.windows || {}).forEach(([windowKey, windowBucket]) => {
        if (!windowBucket || typeof windowBucket !== 'object') {
          return;
        }

        const columnKey = getColumnKeyForWindow(windowKey);

        if (!columnKey) {
          return;
        }

        Object.entries(windowBucket.namespaces || {}).forEach(([namespaceKey, namespaceFields]) => {
          if (!namespaceFields || typeof namespaceFields !== 'object') {
            return;
          }

          Object.entries(namespaceFields).forEach(([fieldName, fieldBucket]) => {
            const total = Number(fieldBucket?.total) || 0;

            if (!total) {
              return;
            }

            const fieldKey = `${namespaceKey}.${fieldName}`;
            totalsByWindow[columnKey][fieldKey] = (totalsByWindow[columnKey][fieldKey] || 0) + total;
          });
        });
      });
    });
  });

  return totalsByWindow;
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

// Build namespace/field sets for each window to compare coverage by app.
const collectFieldSetsByWindow = (appBucket) => {
  const windowFieldSets = {};

  Object.entries(appBucket?.windows || {}).forEach(([windowKey, windowBucket]) => {
    if (!windowBucket || typeof windowBucket !== 'object') {
      return;
    }

    const columnKey = getColumnKeyForWindow(windowKey);

    if (!columnKey) {
      return;
    }

    if (!windowFieldSets[columnKey]) {
      windowFieldSets[columnKey] = new Set();
    }

    Object.entries(windowBucket.namespaces || {}).forEach(([namespaceKey, namespaceFields]) => {
      if (!namespaceFields || typeof namespaceFields !== 'object') {
        return;
      }

      Object.keys(namespaceFields).forEach((fieldName) => {
        windowFieldSets[columnKey].add(`${namespaceKey}.${fieldName}`);
      });
    });
  });

  return windowFieldSets;
};

// Describe missing/extra fields between 7-day and other windows for an app.
const buildFieldDifferencesByApp = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return [];
  }

  return Object.entries(aggregations).reduce((differences, [subId, subBucket]) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return differences;
    }

    Object.values(apps).forEach((appBucket) => {
      const appName = appBucket?.appName || appBucket?.appId || 'Unknown App';
      const windowFieldSets = collectFieldSetsByWindow(appBucket);
      const sevenDayFields = windowFieldSets.sevenDay || new Set();
      const otherWindowFields = windowFieldSets.otherWindows || new Set();

      const missingInSevenDay = [...otherWindowFields].filter((fieldKey) => !sevenDayFields.has(fieldKey));
      const extraInSevenDay = [...sevenDayFields].filter((fieldKey) => !otherWindowFields.has(fieldKey));

      if (!missingInSevenDay.length && !extraInSevenDay.length) {
        return;
      }

      differences.push({ subId, appName, missingInSevenDay, extraInSevenDay });
    });

    return differences;
  }, []);
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

    const sevenDayCell = document.createElement('td');
    sevenDayCell.id = `field-seven-${rowNumber}`;
    sevenDayCell.className = 'subscription-count-cell';
    sevenDayCell.textContent = row.appName || '';

    const otherWindowCell = document.createElement('td');
    otherWindowCell.id = `field-other-${rowNumber}`;
    otherWindowCell.className = 'subscription-count-cell';
    otherWindowCell.textContent = row.notes || '';

    const differenceCell = document.createElement('td');
    differenceCell.id = `field-diff-${rowNumber}`;
    differenceCell.className = 'subscription-count-cell';
    differenceCell.textContent = row.differences || '';

    summaryRow.append(labelCell, sevenDayCell, otherWindowCell, differenceCell);
    tableBody.appendChild(summaryRow);
  });
};

// Update cached field totals and log them to the console.
const updateFieldTotals = (aggregations) => {
  const computedTotals = combineFieldTotalsByWindow(aggregations);
  const hasWindowTotals = Object.values(computedTotals || {}).some((windowTotals) => (
    windowTotals && Object.keys(windowTotals).length
  ));

  fieldTotalsByWindow = hasWindowTotals ? computedTotals : buildDefaultWindowTotals();
  console.log('Field record totals by window', fieldTotalsByWindow);
};

// Update cached per-app field differences for window comparisons.
const updateFieldDifferences = (aggregations) => {
  fieldDifferencesByApp = buildFieldDifferencesByApp(aggregations);
  console.log('Field coverage differences', fieldDifferencesByApp);
};

// Convert per-app field differences into readable summary rows.
const buildDifferenceSummaryRows = (differences = fieldDifferencesByApp) => {
  if (!Array.isArray(differences) || !differences.length) {
    return [];
  }

  return differences.map((difference) => {
    const missingLabel = difference.missingInSevenDay?.length
      ? `Missing in 7-Day: ${difference.missingInSevenDay.join(', ')}`
      : '';
    const extraLabel = difference.extraInSevenDay?.length
      ? `Extra in 7-Day: ${difference.extraInSevenDay.join(', ')}`
      : '';
    const differenceText = [missingLabel, extraLabel].filter(Boolean).join(' | ');

    return {
      label: difference.subId || 'Unknown SubID',
      appName: difference.appName || 'Unknown App',
      notes: '',
      differences: differenceText,
    };
  });
};

// Merge mismatch details into the table dataset.
const buildFieldSummaryRows = () => buildDifferenceSummaryRows(fieldDifferencesByApp);

// Sync cached metadata aggregations with the bar chart.
const updateFromMetadataAggregations = (aggregations) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return;
  }

  window.metadataAggregations = aggregations;
  updateFieldTotals(aggregations);
  updateFieldDifferences(aggregations);
  subBarData = buildSubBarData(aggregations);
  fieldSummaryRows = buildFieldSummaryRows();

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
    updateFieldDifferences(window.metadataAggregations);
    subBarData = buildSubBarData(window.metadataAggregations);
    fieldSummaryRows = buildFieldSummaryRows();
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
