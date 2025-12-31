const exportSources = ['SPA/pdf/pdf1.html', 'SPA/pdf/pdf2.html'];
let currentSourceIndex = 0;
const donutPalette = [
  'rgb(255, 99, 132)',
  'rgb(54, 162, 235)',
  'rgb(255, 205, 86)',
  'rgb(75, 192, 192)',
  'rgb(153, 102, 255)',
  'rgb(201, 203, 207)',
];

// Create a palette with enough distinct colors for every SubID slice.
const buildSubPalette = (count) => {
  if (!count || count < 1) {
    return [];
  }

  if (count <= donutPalette.length) {
    return donutPalette.slice(0, count);
  }

  return Array.from({ length: count }, (_, index) => {
    const hue = Math.round((360 / count) * index);
    return `hsl(${hue}, 65%, 55%)`;
  });
};

// Build a doughnut dataset summarizing scan counts by SubID.
const buildSubDonutDataset = (aggregations) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return null;
  }

  const subscriptionIds = Object.keys(aggregations).filter((subId) => subId);

  if (!subscriptionIds.length) {
    return null;
  }

  const scanCounts = subscriptionIds.map((subId) => {
    const apps = aggregations[subId]?.apps;
    return apps ? Object.keys(apps).length : 0;
  });

  return {
    labels: subscriptionIds,
    datasets: [{
      label: 'Subscription scans',
      data: scanCounts,
      backgroundColor: buildSubPalette(subscriptionIds.length),
      hoverOffset: 4,
    }],
  };
};

// Update the iframe source to the selected export preview.
const setExportPreviewSource = (frame, nextIndex) => {
  if (!frame || !exportSources.length) {
    return;
  }

  currentSourceIndex = (nextIndex + exportSources.length) % exportSources.length;
  frame.src = exportSources[currentSourceIndex];
};

// Initialize export preview navigation controls.
export async function initSection(sectionElement) {
  const previewFrame = sectionElement?.querySelector('#export-preview-frame');
  const prevButton = sectionElement?.querySelector('#export-nav-prev');
  const nextButton = sectionElement?.querySelector('#export-nav-next');

  if (!previewFrame || !prevButton || !nextButton) {
    return;
  }

  const startingSource = previewFrame.getAttribute('src');
  const startingIndex = exportSources.findIndex((source) => source === startingSource);

  if (startingIndex >= 0) {
    currentSourceIndex = startingIndex;
  }

  // Ensure the export preview iframe receives metadata aggregations and chart data.
  const injectPreviewData = () => {
    const targetWindow = previewFrame.contentWindow;
    const aggregations = (typeof window !== 'undefined' && window.metadataAggregations)
      ? window.metadataAggregations
      : null;

    if (!targetWindow || !aggregations || typeof aggregations !== 'object') {
      return;
    }

    targetWindow.metadataAggregations = aggregations;
    const donutData = buildSubDonutDataset(aggregations);

    if (donutData) {
      targetWindow.subDonutData = donutData;
    }
  };

  previewFrame.addEventListener('load', injectPreviewData);

  if (previewFrame.contentDocument?.readyState === 'complete') {
    injectPreviewData();
  }

  prevButton.addEventListener('click', () => {
    setExportPreviewSource(previewFrame, currentSourceIndex - 1);
  });

  nextButton.addEventListener('click', () => {
    setExportPreviewSource(previewFrame, currentSourceIndex + 1);
  });
}
