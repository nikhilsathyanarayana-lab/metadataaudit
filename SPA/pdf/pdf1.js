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

const barLabels = ['January', 'February', 'March', 'April', 'May', 'June', 'July'];

const subBarData = {
  labels: barLabels,
  datasets: [{
    label: 'My First Dataset',
    data: [65, 59, 80, 81, 56, 55, 40],
    backgroundColor: [
      'rgba(255, 99, 132, 0.2)',
      'rgba(255, 159, 64, 0.2)',
      'rgba(255, 205, 86, 0.2)',
      'rgba(75, 192, 192, 0.2)',
      'rgba(54, 162, 235, 0.2)',
      'rgba(153, 102, 255, 0.2)',
      'rgba(201, 203, 207, 0.2)'
    ],
    borderColor: [
      'rgb(255, 99, 132)',
      'rgb(255, 159, 64)',
      'rgb(255, 205, 86)',
      'rgb(75, 192, 192)',
      'rgb(54, 162, 235)',
      'rgb(153, 102, 255)',
      'rgb(201, 203, 207)'
    ],
    borderWidth: 1
  }]
};

const subBarConfig = {
  type: 'bar',
  data: subBarData,
  options: {
    scales: {
      y: {
        beginAtZero: true
      }
    }
  }
};

// Confirm whether cached metadata aggregations are available on the window.
const hasMetadataAggregations = () => (
  typeof window !== 'undefined'
    && window.metadataAggregations
    && typeof window.metadataAggregations === 'object'
);

// Collect SubIDs from the cached metadata aggregations.
const getSubscriptionIds = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return [];
  }

  console.log('getSubscriptionIds: collecting SubIDs');
  return Object.keys(aggregations).filter((subId) => subId);
};

// Populate the subscription summary table with discovered SubIDs.
const renderSubscriptionTable = () => {
  const tableBody = document.getElementById('subscription-table-body');
  const subscriptionIds = getSubscriptionIds();

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
    labelCell.textContent = subId;

    const countCell = document.createElement('td');
    countCell.id = `subscription-count-${rowNumber}`;
    countCell.className = 'subscription-count-cell';
    countCell.textContent = '0 of 0';

    row.append(labelCell, countCell);
    tableBody.appendChild(row);
  });
};

// Count how many SubID slices are represented in the donut dataset.
const getSubScanCount = (dataset = subDonutData?.datasets?.[0]?.data) => {
  const count = Array.isArray(dataset) ? dataset.length : 0;
  return count;
};

// Draw the SubID scan total in the center of the doughnut chart after rendering.
const subDonutCenterText = {
  id: 'subDonutCenterText',
  afterDraw(chart) {
    const { ctx, chartArea: { left, top, width, height } } = chart;
    const count = getSubScanCount(chart?.data?.datasets?.[0]?.data);

    ctx.save();
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), left + (width / 2), top + (height / 2));
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
    labels: subscriptionIds,
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
        legend: { display: false }
      }
    },
    plugins: [subDonutCenterText]
  });

  subBarChart = new Chart(subBarCanvas, subBarConfig);
};

if (typeof document !== 'undefined') {
  // Refresh the PDF view when metadata updates arrive from the parent window.
  const handleMetadataMessage = (event) => {
    const message = event?.data;

    if (!message || message.type !== 'metadataAggregations') {
      return;
    }

    window.metadataAggregations = message.payload || {};
    subDonutData = buildSubDonutData(window.metadataAggregations);
    window.subDonutData = subDonutData;

    renderSubscriptionTable();
    renderPdfCharts();
  };

  const renderPdfPreview = () => {
    if (hasMetadataAggregations()) {
      subDonutData = buildSubDonutData(window.metadataAggregations);
      window.subDonutData = subDonutData;
      renderSubscriptionTable();
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
