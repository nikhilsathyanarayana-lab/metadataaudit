const exportSources = ['SPA/pdf/pdf0.html','SPA/pdf/pdf1.html', 'SPA/pdf/pdf2.html', 'SPA/pdf/pdf3.html', 'SPA/pdf/pdf4.html', 'SPA/pdf/pdf5.html'];
let currentSourceIndex = 0;
const exclusionModalUrl = new URL('../html/export-exclusion-modal.html', import.meta.url);

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

// Load the exclusion modal markup from a shared HTML partial and attach it to the document.
const loadExclusionModal = async () => {
  const response = await fetch(exclusionModalUrl, { cache: 'no-cache' });

  if (!response.ok) {
    return null;
  }

  const template = document.createElement('template');
  template.innerHTML = (await response.text()).trim();

  const modal = template.content.querySelector('#export-exclusion-modal');
  const backdrop = template.content.querySelector('#export-exclusion-backdrop');

  if (!modal || !backdrop) {
    return null;
  }

  document.body.append(backdrop, modal);

  return { modal, backdrop };
};

// Initialize export preview navigation controls.
export async function initSection(sectionElement) {
  const previewFrame = sectionElement?.querySelector('#export-preview-frame');
  const prevButton = sectionElement?.querySelector('#export-nav-prev');
  const nextButton = sectionElement?.querySelector('#export-nav-next');
  const exclusionButton = sectionElement?.querySelector('#export-exclusion-button');
  const exportPdfButton = sectionElement?.querySelector('#export-pdf-button');
  let exclusionModal = document.getElementById('export-exclusion-modal');
  let exclusionBackdrop = document.getElementById('export-exclusion-backdrop');
  let exclusionCloseButtons = null;
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

  if (!exclusionModal || !exclusionBackdrop) {
    const loadedExclusionModal = await loadExclusionModal();

    exclusionModal = loadedExclusionModal?.modal ?? null;
    exclusionBackdrop = loadedExclusionModal?.backdrop ?? null;
  }

  exclusionCloseButtons = exclusionModal?.querySelectorAll('[data-close-export-exclusion-modal]') || null;

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

  // Trigger a PDF export request for the current preview state.
  const triggerPdfExport = () => {
    document.dispatchEvent(new CustomEvent('pdf-export-requested'));
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
  exportPdfButton?.addEventListener('click', triggerPdfExport);
}
