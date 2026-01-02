const exportSources = ['SPA/pdf/pdf0.html','SPA/pdf/pdf1.html', 'SPA/pdf/pdf2.html', 'SPA/pdf/pdf3.html', 'SPA/pdf/pdf4.html'];
let currentSourceIndex = 0;

// Update the iframe source to the selected export preview.
const setExportPreviewSource = (frame, nextIndex) => {
  if (!frame || !exportSources.length) {
    return;
  }

  currentSourceIndex = (nextIndex + exportSources.length) % exportSources.length;
  frame.src = exportSources[currentSourceIndex];
};

// Show or hide the section exclusion modal overlay.
const setExclusionModalVisibility = (modal, backdrop, isVisible) => {
  if (!modal || !backdrop) {
    return;
  }

  modal.hidden = !isVisible;
  backdrop.hidden = !isVisible;
  modal.classList.toggle('is-visible', isVisible);
  backdrop.classList.toggle('is-visible', isVisible);
};

// Initialize export preview navigation controls.
export async function initSection(sectionElement) {
  const previewFrame = sectionElement?.querySelector('#export-preview-frame');
  const prevButton = sectionElement?.querySelector('#export-nav-prev');
  const nextButton = sectionElement?.querySelector('#export-nav-next');
  const exclusionModal = sectionElement?.querySelector('#export-exclusion-modal');
  const exclusionBackdrop = sectionElement?.querySelector('#export-exclusion-backdrop');
  const exclusionButton = sectionElement?.querySelector('#export-exclusion-button');
  const exclusionCloseButtons = exclusionModal?.querySelectorAll('[data-close-export-exclusion-modal]');
  const exportPdfButton = sectionElement?.querySelector('#export-pdf-button');

  // Return the exclusion selections from the modal checkboxes.
  const getExportExclusions = () => ({
    overview: Boolean(sectionElement?.querySelector('#exclude-overview-input')?.checked),
    summary: Boolean(sectionElement?.querySelector('#exclude-summary-input')?.checked),
    details: Boolean(sectionElement?.querySelector('#exclude-details-input')?.checked),
  });

  // Filter the export sources to honor the selected exclusions.
  const getIncludedSources = () => {
    const exclusions = getExportExclusions();

    return exportSources.filter((source) => {
      if (exclusions.overview && source.includes('pdf1.html')) {
        return false;
      }

      if (exclusions.summary && source.includes('pdf3.html')) {
        return false;
      }

      if (exclusions.details && source.includes('pdf4.html')) {
        return false;
      }

      return true;
    });
  };

  // Open a new window for the selected export page and trigger the print flow.
  const openPdfExportWindow = (sourceUrl) => {
    if (typeof window === 'undefined' || !sourceUrl) {
      return;
    }

    const exportWindow = window.open(sourceUrl, '_blank', 'noopener');

    if (!exportWindow) {
      // eslint-disable-next-line no-console
      console.warn('Unable to open export window.');
      return;
    }

    const triggerPrint = () => {
      exportWindow.removeEventListener('load', triggerPrint);
      exportWindow.focus();
      exportWindow.print();
    };

    exportWindow.addEventListener('load', triggerPrint);
  };
  // Send updated metadata aggregations to the export preview iframe.
  const postMetadataToPreview = () => {
    if (!previewFrame?.contentWindow || typeof window === 'undefined' || !window.metadataAggregations) {
      return;
    }

    const message = {
      type: 'metadataAggregations',
      payload: window.metadataAggregations,
    };

    if (window.appCountsBySubId && typeof window.appCountsBySubId === 'object') {
      message.appCountsBySubId = window.appCountsBySubId;
    }

    previewFrame.contentWindow.postMessage(message, '*');
  };

  if (!previewFrame || !prevButton || !nextButton) {
    return;
  }

  const startingSource = previewFrame.getAttribute('src');
  const startingIndex = exportSources.findIndex((source) => source === startingSource);

  if (startingIndex >= 0) {
    currentSourceIndex = startingIndex;
  }

  if (typeof window !== 'undefined') {
    let metadataAggregationsCache = window.metadataAggregations;
    let appCountsBySubIdCache = window.appCountsBySubId;
    let hasLoggedMetadataCache = false;

    // Log when metadata aggregations become available in the cache.
    const logMetadataCacheAvailable = () => {
      if (hasLoggedMetadataCache || !metadataAggregationsCache) {
        return;
      }

      console.log('metadataAggregationsCache available');
      hasLoggedMetadataCache = true;
    };

    Object.defineProperty(window, 'metadataAggregations', {
      configurable: true,
      enumerable: true,
      get() {
        return metadataAggregationsCache;
      },
      set(value) {
        metadataAggregationsCache = value;
        logMetadataCacheAvailable();
        postMetadataToPreview();
      },
    });

    Object.defineProperty(window, 'appCountsBySubId', {
      configurable: true,
      enumerable: true,
      get() {
        return appCountsBySubIdCache;
      },
      set(value) {
        appCountsBySubIdCache = value;

        if (metadataAggregationsCache) {
          postMetadataToPreview();
        }
      },
    });

    logMetadataCacheAvailable();
    postMetadataToPreview();
  }

  previewFrame.addEventListener('load', postMetadataToPreview);

  prevButton.addEventListener('click', () => {
    setExportPreviewSource(previewFrame, currentSourceIndex - 1);
  });

  nextButton.addEventListener('click', () => {
    setExportPreviewSource(previewFrame, currentSourceIndex + 1);
  });

  const closeExclusionModal = () => setExclusionModalVisibility(exclusionModal, exclusionBackdrop, false);

  // Open the exclusion modal to let users pick PDF sections to skip.
  const openExclusionModal = () => setExclusionModalVisibility(exclusionModal, exclusionBackdrop, true);

  // Kick off PDF export by honoring exclusions and printing the selected page.
  const handlePdfExportRequest = () => {
    const includedSources = getIncludedSources();

    if (!includedSources.length) {
      // eslint-disable-next-line no-console
      console.warn('All export sections are excluded; nothing to export.');
      return;
    }

    const normalizedCurrentSource = previewFrame?.src
      ? new URL(previewFrame.src, window.location.href).pathname
      : '';
    const matchingSource = includedSources.find((source) => {
      return new URL(source, window.location.href).pathname === normalizedCurrentSource;
    });
    const exportSource = matchingSource || includedSources[0];

    closeExclusionModal();
    openPdfExportWindow(new URL(exportSource, window.location.href).toString());
  };

  // Trigger a PDF export request for the current preview state.
  const triggerPdfExport = () => {
    document.dispatchEvent(new CustomEvent('pdf-export-requested'));
    handlePdfExportRequest();
  };

  exclusionButton?.addEventListener('click', openExclusionModal);
  exclusionCloseButtons?.forEach((button) => {
    button.addEventListener('click', closeExclusionModal);
  });
  exclusionBackdrop?.addEventListener('click', closeExclusionModal);

  // Dismiss the modal when the escape key is pressed.
  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeExclusionModal();
    }
  };

  document.addEventListener('keydown', handleEscape);
  document.addEventListener('pdf-export-requested', handlePdfExportRequest);
  exportPdfButton?.addEventListener('click', triggerPdfExport);
}
