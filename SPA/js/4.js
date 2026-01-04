/*jslint browser: true */
/*jslint es6: true */

const exportSources = ['SPA/pdf/table-of-contents.html','SPA/pdf/overview-dashboard.html', 'SPA/pdf/field-analysis.html', 'SPA/pdf/field-summary.html', 'SPA/pdf/subscription-details.html', 'SPA/pdf/application-details.html'];
let currentSourceIndex = 0;
const exclusionModalUrl = new URL('../html/export-exclusion-modal.html', import.meta.url);
const renderDelayMs = 350;

// Wait briefly to let iframe content finish rendering.
const delay = (duration) => new Promise((resolve) => {
  setTimeout(resolve, duration);
});

// Toggle busy state on the export button while preparing pages.
const setExportButtonBusyState = (button, isBusy) => {
  if (!button) {
    return;
  }

  if (isBusy) {
    button.dataset.previousLabel = button.textContent || '';
    button.textContent = 'Preparing PDF...';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.previousLabel) {
      button.textContent = button.dataset.previousLabel;
      delete button.dataset.previousLabel;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
};

// Build the metadata payload forwarded into export frames.
const buildMetadataMessage = () => {
  const message = {
    type: 'metadataAggregations',
    payload: typeof window !== 'undefined' ? (window.metadataAggregations || {}) : {},
  };

  if (typeof window !== 'undefined' && window.appCountsBySubId && typeof window.appCountsBySubId === 'object') {
    message.appCountsBySubId = window.appCountsBySubId;
  }

  return message;
};

// Send cached metadata into the target iframe.
const postMetadataToFrame = (frame) => {
  const message = buildMetadataMessage();

  if (!frame?.contentWindow) {
    return;
  }

  frame.contentWindow.metadataAggregations = message.payload;

  if (message.appCountsBySubId) {
    frame.contentWindow.appCountsBySubId = message.appCountsBySubId;
  }

  frame.contentWindow.postMessage(message, '*');
};

// Resolve when the iframe finishes loading.
const waitForFrameLoad = (frame) => new Promise((resolve, reject) => {
  if (!frame) {
    reject(new Error('Frame was not created.'));
    return;
  }

  const handleLoad = () => {
    frame.removeEventListener('load', handleLoad);
    frame.removeEventListener('error', handleError);
    resolve(frame);
  };

  const handleError = () => {
    frame.removeEventListener('load', handleLoad);
    frame.removeEventListener('error', handleError);
    reject(new Error(`Unable to load export source ${frame.src}`));
  };

  frame.addEventListener('load', handleLoad, { once: true });
  frame.addEventListener('error', handleError, { once: true });
});

// Clone the iframe body after its markup is ready.
const cloneFrameBody = async (frame) => {
  await waitForFrameLoad(frame);
  postMetadataToFrame(frame);
  await delay(renderDelayMs);

  const body = frame?.contentDocument?.body?.cloneNode(true);

  if (!body) {
    throw new Error('No body content was available to export.');
  }

  body.querySelectorAll('script').forEach((script) => script.remove());

  return body;
};

// Create a hidden container for export staging frames.
const createStagingArea = () => {
  const container = document.createElement('div');
  container.id = 'pdf-export-staging';
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '1px';
  container.style.height = '1px';
  container.style.overflow = 'hidden';
  document.body.appendChild(container);
  return container;
};

// Render all export pages into a printable window.
const renderPrintableDocument = (pages) => {
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    throw new Error('Unable to open a print window.');
  }

  const printDocument = printWindow.document;

  printDocument.open();
  printDocument.write('<!doctype html><html lang="en"><head></head><body></body></html>');
  printDocument.close();

  printDocument.title = 'Metadata export';

  const stylesheet = printDocument.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = 'SPA/pdf/pdf.css';
  printDocument.head.appendChild(stylesheet);

  const pageStyles = printDocument.createElement('style');
  pageStyles.textContent = `
    body { margin: 0; background: #fff; }
    .pdf-export-page { margin: 0; }
    @media print {
      .pdf-export-page { page-break-after: always; }
      .pdf-export-page:last-of-type { page-break-after: auto; }
    }
  `;
  printDocument.head.appendChild(pageStyles);

  pages.forEach(({ source, body }) => {
    const wrapper = printDocument.createElement('section');
    const adoptedBody = printDocument.importNode(body, true);

    wrapper.className = 'pdf-export-page';
    wrapper.setAttribute('data-export-source', source);
    wrapper.appendChild(adoptedBody);
    printDocument.body.appendChild(wrapper);
  });

  printWindow.focus();
  printWindow.print();
};

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

  // Assemble all export pages into a printable document.
  const handlePdfExportRequested = async () => {
    const stagingArea = createStagingArea();

    try {
      setExportButtonBusyState(exportPdfButton, true);

      const pages = [];

      for (const source of exportSources) {
        const frame = document.createElement('iframe');

        frame.src = source;
        frame.loading = 'eager';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.width = '1px';
        frame.style.height = '1px';

        stagingArea.appendChild(frame);

        const body = await cloneFrameBody(frame);
        pages.push({ source, body });
      }

      renderPrintableDocument(pages);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('PDF export failed.', error);
      alert('Unable to export PDF right now. Please try again.');
    } finally {
      stagingArea.remove();
      setExportButtonBusyState(exportPdfButton, false);
    }
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
  exportPdfButton?.addEventListener('click', handlePdfExportRequested);
}
