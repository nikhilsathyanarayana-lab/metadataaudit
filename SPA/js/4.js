/*jslint browser: true */
/*jslint es6: true */

import { exportSubscriptionLabels } from './subscriptionLabels.js';

const exportSources = ['SPA/pdf/table-of-contents.html','SPA/pdf/overview-dashboard.html', 'SPA/pdf/field-analysis.html', 'SPA/pdf/field-summary.html', 'SPA/pdf/subscription-details.html', 'SPA/pdf/application-details.html'];
let currentSourceIndex = 0;
const exclusionModalUrl = new URL('../html/export-exclusion-modal.html', import.meta.url);
const pdfStylesheetUrl = new URL('../pdf/pdf.css', import.meta.url).href;
const html2PdfLibraryUrl = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const renderDelayMs = 350;
const footerClassName = 'pdf-page-footer';
const exportedPdfFileName = 'Metadata export.pdf';

let html2PdfLoaderPromise = null;

// Wait briefly to let iframe content finish rendering.
const delay = (duration) => new Promise((resolve) => {
  setTimeout(resolve, duration);
});

// Build a shared footer containing the page number label.
const buildPageFooter = (doc, pageNumber) => {
  const footer = doc?.createElement('footer');
  const label = doc?.createElement('span');

  if (!footer || !label) {
    return null;
  }

  footer.className = footerClassName;
  label.className = 'pdf-page-number';
  label.textContent = `Page ${pageNumber}`;

  footer.appendChild(label);

  return footer;
};

// Attach or replace the footer on the printable area for a page.
const applyPageFooter = (pageElement, doc, pageNumber) => {
  if (!pageElement || !doc) {
    return;
  }

  const footerHost = pageElement.querySelector('main') || pageElement;

  footerHost.querySelectorAll(`.${footerClassName}`).forEach((footer) => footer.remove());

  const footer = buildPageFooter(doc, pageNumber);

  if (footer) {
    footerHost.appendChild(footer);
  }
};

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
    payload: typeof window !== 'undefined'
      ? (window.metadataAggregations || {})
      : {},
  };

  if (typeof window !== 'undefined') {
    const fieldTypeSelections = window.fieldTypeSelections
      || window.FIELDTYPES?.fieldTypeSelections
      || {};

    message.fieldTypeSelections = fieldTypeSelections;
  }

  if (typeof window !== 'undefined') {
    const appCountsSnapshot = window.appCountsBySubId;

    if (appCountsSnapshot && typeof appCountsSnapshot === 'object') {
      message.appCountsBySubId = appCountsSnapshot;
    }
  }

  message.subscriptionLabels = exportSubscriptionLabels();

  return message;
};

// Send cached metadata into the target iframe.
const postMetadataToFrame = (frame) => {
  const message = buildMetadataMessage();

  if (!frame?.contentWindow) {
    return;
  }

  frame.contentWindow.metadataAggregations = message.payload;

  if (message.fieldTypeSelections) {
    frame.contentWindow.fieldTypeSelections = message.fieldTypeSelections;
  }

  if (message.appCountsBySubId) {
    frame.contentWindow.appCountsBySubId = message.appCountsBySubId;
  }

  frame.contentWindow.subscriptionLabels = message.subscriptionLabels;

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

  const sourceDocument = frame?.contentDocument;
  const sourceCanvasNodes = Array.from(sourceDocument?.querySelectorAll('canvas') || []);

  const body = sourceDocument?.body?.cloneNode(true);

  if (!body) {
    throw new Error('No body content was available to export.');
  }

  const clonedCanvasNodes = Array.from(body.querySelectorAll('canvas'));

  sourceCanvasNodes.forEach((sourceCanvas, index) => {
    const clonedCanvas = clonedCanvasNodes[index];

    if (!sourceCanvas || !clonedCanvas) {
      return;
    }

    try {
      const image = sourceDocument.createElement('img');

      image.src = sourceCanvas.toDataURL('image/png');
      image.className = sourceCanvas.className;
      image.width = sourceCanvas.width;
      image.height = sourceCanvas.height;
      image.style.cssText = sourceCanvas.style.cssText;
      image.alt = sourceCanvas.getAttribute('aria-label') || 'Chart snapshot';

      clonedCanvas.replaceWith(image);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Canvas export fallback: failed to capture canvas as image.', error);
    }
  });

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

// Wait for a stylesheet to finish loading in a target document.
const waitForStylesheet = (stylesheet) => new Promise((resolve, reject) => {
  const handleLoad = () => {
    stylesheet.removeEventListener('load', handleLoad);
    stylesheet.removeEventListener('error', handleError);
    resolve();
  };

  const handleError = () => {
    stylesheet.removeEventListener('load', handleLoad);
    stylesheet.removeEventListener('error', handleError);
    const error = new Error(`Unable to load stylesheet: ${stylesheet.href}`);

    // eslint-disable-next-line no-console
    console.error('Stylesheet failed to load.', error);
    reject(error);
  };

  stylesheet.addEventListener('load', handleLoad, { once: true });
  stylesheet.addEventListener('error', handleError, { once: true });
});

// Wait for a paint tick so the export layout can settle.
const waitForLayout = () => new Promise((resolve) => {
  window.requestAnimationFrame(() => {
    setTimeout(resolve, 50);
  });
});

// Convert CSS millimeter values to inches for the PDF generator.
const millimetersToInches = (millimeters) => millimeters / 25.4;

// Convert a CSS length value (mm) into a numeric millimeter value.
const parseMillimeterValue = (value) => {
  const parsedValue = parseFloat((value || '').trim());

  if (!Number.isFinite(parsedValue)) {
    return null;
  }

  return parsedValue;
};

// Read PDF page dimensions from css variables with A4 defaults.
const readPdfDimensions = () => {
  const rootStyles = getComputedStyle(document.documentElement);
  const pageWidthMm = parseMillimeterValue(rootStyles.getPropertyValue('--page-width')) || 210;
  const pageHeightMm = parseMillimeterValue(rootStyles.getPropertyValue('--page-height')) || 297;
  const pageMarginMm = parseMillimeterValue(rootStyles.getPropertyValue('--page-margin')) || 16;

  return {
    pageWidthMm,
    pageHeightMm,
    pageMarginMm,
    pageWidthIn: millimetersToInches(pageWidthMm),
    pageHeightIn: millimetersToInches(pageHeightMm),
    pageMarginIn: millimetersToInches(pageMarginMm),
  };
};

// Load html2pdf once and resolve with the global export function.
const loadHtml2Pdf = () => {
  if (typeof window.html2pdf === 'function') {
    return Promise.resolve(window.html2pdf);
  }

  if (!html2PdfLoaderPromise) {
    html2PdfLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');

      script.src = html2PdfLibraryUrl;
      script.async = true;
      script.addEventListener('load', () => {
        if (typeof window.html2pdf === 'function') {
          resolve(window.html2pdf);
          return;
        }

        reject(new Error('html2pdf loaded but did not expose a global function.'));
      }, { once: true });
      script.addEventListener('error', () => {
        reject(new Error('Unable to load html2pdf library.'));
      }, { once: true });

      document.head.appendChild(script);
    });
  }

  return html2PdfLoaderPromise;
};

// Build a hidden document shell for rendering export pages to PDF.
const createPdfRenderHost = () => {
  const host = document.createElement('div');
  const stylesheet = document.createElement('link');
  const body = document.createElement('div');

  host.id = 'pdf-export-render-host';
  host.style.position = 'fixed';
  host.style.left = '-9999px';
  host.style.top = '0';
  host.style.width = '210mm';
  host.style.background = '#ffffff';

  stylesheet.rel = 'stylesheet';
  stylesheet.href = pdfStylesheetUrl;

  body.id = 'pdf-export-body';
  body.className = 'pdf-export-body';

  host.append(stylesheet, body);
  document.body.appendChild(host);

  return { host, stylesheet, body };
};

// Render all assembled pages into a downloadable PDF blob.
const renderPdfBlob = async (pages) => {
  const html2pdf = await loadHtml2Pdf();
  const { pageWidthIn, pageHeightIn, pageMarginIn } = readPdfDimensions();
  const { host, stylesheet, body } = createPdfRenderHost();

  try {
    await waitForStylesheet(stylesheet);

    pages.forEach(({ source, body: pageBody }, index) => {
      const pageNumber = index + 1;
      const wrapper = document.createElement('section');
      const adoptedBody = pageBody.cloneNode(true);

      wrapper.className = 'pdf-export-page';
      wrapper.id = `pdf-export-page-${pageNumber}`;
      wrapper.setAttribute('data-export-source', source);
      wrapper.appendChild(adoptedBody);

      applyPageFooter(wrapper, document, pageNumber);
      body.appendChild(wrapper);
    });

    await waitForLayout();

    if (document.fonts?.ready) {
      await document.fonts.ready;
    }

    return html2pdf().set({
      margin: pageMarginIn,
      filename: exportedPdfFileName,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: {
        unit: 'in',
        format: [pageWidthIn, pageHeightIn],
        orientation: 'portrait',
      },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(body).toPdf().outputPdf('blob');
  } finally {
    host.remove();
  }
};

// Download the generated PDF blob to the user's device.
const downloadPdfBlob = (pdfBlob) => {
  const objectUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');

  link.href = objectUrl;
  link.download = exportedPdfFileName;
  link.style.display = 'none';

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
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
    if (!previewFrame?.contentWindow || typeof window === 'undefined') {
      return;
    }

    const aggregations = window.metadataAggregations;

    if (!aggregations) {
      return;
    }

    const message = {
      type: 'metadataAggregations',
      payload: aggregations,
      fieldTypeSelections: window.fieldTypeSelections
        || window.FIELDTYPES?.fieldTypeSelections
        || {},
      subscriptionLabels: exportSubscriptionLabels(),
    };

    if (window.appCountsBySubId && typeof window.appCountsBySubId === 'object') {
      message.appCountsBySubId = window.appCountsBySubId;
    }

    previewFrame.contentWindow.subscriptionLabels = message.subscriptionLabels;
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

    const updatePreviewFooter = () => {
      applyPageFooter(previewFrame?.contentDocument?.body, previewFrame?.contentDocument, currentSourceIndex + 1);
    };

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
    updatePreviewFooter();
  }

  const handlePreviewLoad = () => {
    postMetadataToPreview();
    applyPageFooter(previewFrame?.contentDocument?.body, previewFrame?.contentDocument, currentSourceIndex + 1);
  };

  previewFrame.addEventListener('load', handlePreviewLoad);

  prevButton.addEventListener('click', () => {
    setExportPreviewSource(previewFrame, currentSourceIndex - 1);
  });

  nextButton.addEventListener('click', () => {
    setExportPreviewSource(previewFrame, currentSourceIndex + 1);
  });

  const closeExclusionModal = () => setExclusionModalVisibility(exclusionModal, exclusionBackdrop, false);

  // Open the exclusion modal to let users pick PDF sections to skip.
  const openExclusionModal = () => setExclusionModalVisibility(exclusionModal, exclusionBackdrop, true);

  // Assemble all export pages into a downloadable PDF document.
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

      const pdfBlob = await renderPdfBlob(pages);
      downloadPdfBlob(pdfBlob);
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
