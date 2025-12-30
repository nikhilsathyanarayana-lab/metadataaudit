import { tableData } from './3.js';
import { getAppCountForSub } from '../API/app_names.js';

let doughnutChart;
let chartModulePromise;
const chartPalette = ['#f6708f', '#f7c266', '#53a8ff', '#7bc67e', '#8e72ff', '#f1955c'];

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

// Return the largest available app total per SubID.
const getAppTotals = (subIds) => {
  return subIds.map((subId) => {
    const availableApps = getAppCountForSub(subId);
    const processedApps = getProcessedAppsForSub(subId);

    return Math.max(availableApps, processedApps);
  });
};

// Load Chart.js from the CDN once per session.
const loadChartModule = async () => {
  if (!chartModulePromise) {
    chartModulePromise = import('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js');
  }

  return chartModulePromise;
};

// Resolve the Chart.js constructor from the loaded module regardless of export shape.
const getChartConstructor = (chartModule) => {
  if (!chartModule) {
    return null;
  }

  if (typeof chartModule.Chart === 'function') {
    return chartModule.Chart;
  }

  if (typeof chartModule.default === 'function') {
    return chartModule.default;
  }

  if (typeof chartModule.default?.Chart === 'function') {
    return chartModule.default.Chart;
  }

  return null;
};

// Draw app totals on each doughnut segment.
const buildSegmentLabelPlugin = (appTotals) => {
  return {
    id: 'pdfSegmentLabels',
    afterDatasetDraw(chart) {
      const { ctx } = chart;
      const meta = chart.getDatasetMeta(0);

      ctx.save();
      ctx.font = '600 12px "Inter", "Sora", system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      meta.data.forEach((arc, index) => {
        const { x, y } = arc.tooltipPosition();
        ctx.fillText(String(appTotals[index] ?? 0), x, y);
      });

      ctx.restore();
    },
  };
};

// Place the SubID total in the center of the doughnut.
const buildCenterLabelPlugin = (subCount) => {
  return {
    id: 'pdfCenterLabel',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      const centerX = (chartArea.left + chartArea.right) / 2;
      const centerY = (chartArea.top + chartArea.bottom) / 2;

      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#1c4da1';
      ctx.font = '700 24px "Inter", "Sora", system-ui, sans-serif';
      ctx.fillText(String(subCount || 0), centerX, centerY - 6);
      ctx.fillStyle = '#2f3c55';
      ctx.font = '600 12px "Inter", "Sora", system-ui, sans-serif';
      ctx.fillText('Subs', centerX, centerY + 14);
      ctx.restore();
    },
  };
};

// Render the Chart.js doughnut with per-SubID app totals.
const renderSubscriptionChart = async (chartCanvas, emptyState, subIds) => {
  if (!chartCanvas) {
    return;
  }

  const appTotals = getAppTotals(subIds);

  if (!subIds.length) {
    if (emptyState) {
      emptyState.hidden = false;
    }
    chartCanvas.hidden = true;
    if (doughnutChart) {
      doughnutChart.destroy();
      doughnutChart = null;
    }
    return;
  }

  if (emptyState) {
    emptyState.hidden = true;
  }
  chartCanvas.hidden = false;

  const Chart = getChartConstructor(await loadChartModule());
  if (!Chart) {
    // eslint-disable-next-line no-console
    console.error('Chart.js failed to load.');
    return;
  }
  const context = chartCanvas.getContext('2d');

  if (!context) {
    return;
  }

  if (doughnutChart) {
    doughnutChart.destroy();
  }

  const colors = subIds.map((_, index) => chartPalette[index % chartPalette.length]);

  doughnutChart = new Chart(context, {
    type: 'doughnut',
    data: {
      labels: subIds,
      datasets: [
        {
          data: appTotals,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label({ label, parsed }) {
              return `${label || 'Sub'}: ${parsed} app${parsed === 1 ? '' : 's'}`;
            },
          },
        },
      },
    },
    plugins: [buildSegmentLabelPlugin(appTotals), buildCenterLabelPlugin(subIds.length)],
  });
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

// Render the overview summary and donut chart inside the PDF page.
const renderPdfOverview = async (sectionRoot) => {
  const summaryContainer = sectionRoot?.querySelector('#pdf-export-summary');
  const chartCanvas = sectionRoot?.querySelector('#pdf-subscription-donut');
  const emptyState = sectionRoot?.querySelector('#pdf-export-chart-empty-state');
  const subIds = getSubIds();

  if (!summaryContainer) {
    return;
  }

  renderSubscriptionSummary(summaryContainer, subIds);
  await renderSubscriptionChart(chartCanvas, emptyState, subIds);
};

// Initialize PDF page one with overview and chart data.
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
