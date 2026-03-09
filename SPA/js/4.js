/*jslint browser: true */
/*jslint es6: true */

import { exportSubscriptionLabels } from './subscriptionLabels.js';

const exportSources = ['SPA/pdf/table-of-contents.html','SPA/pdf/overview-dashboard.html', 'SPA/pdf/field-analysis.html', 'SPA/pdf/field-summary.html', 'SPA/pdf/subscription-details.html', 'SPA/pdf/application-details.html'];
let currentSourceIndex = 0;
const exclusionModalUrl = new URL('../html/export-exclusion-modal.html', import.meta.url);
const pdfStylesheetUrl = new URL('../pdf/pdf.css', import.meta.url).href;
const html2PdfLibraryUrl = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const renderDelayMs = 350;
const nonChartFallbackDelayMs = 120;
const readyEventName = 'pdf:ready';
const readySignalTimeoutMs = 2000;
const footerClassName = 'pdf-page-footer';
const exportedPdfFileName = 'Metadata export.pdf';
const chartExportSourceSegments = ['overview-dashboard.html', 'field-analysis.html'];

let html2PdfLoaderPromise = null;
let assembledExportPagesCache = [];

// Wait briefly to let iframe content finish rendering.
const delay = (duration) => new Promise((resolve) => {
  setTimeout(resolve, duration);
});

// Return true when the source path points to a chart-heavy export page.
const isChartExportSource = (source = '') => chartExportSourceSegments
  .some((segment) => String(source || '').includes(segment));

// Wait for a ready event from an export frame, resolving false on timeout.
const waitForFrameReadySignal = (frame, timeoutMs = readySignalTimeoutMs) => new Promise((resolve) => {
  const targetWindow = frame?.contentWindow;

  if (!targetWindow) {
    resolve(false);
    return;
  }

  let hasResolved = false;
  let timeoutId;

  const finish = (didReceiveSignal) => {
    if (hasResolved) {
      return;
    }

    hasResolved = true;
    clearTimeout(timeoutId);
    targetWindow.removeEventListener(readyEventName, handleReady);
    resolve(Boolean(didReceiveSignal));
  };

  const handleReady = () => {
    finish(true);
  };

  targetWindow.addEventListener(readyEventName, handleReady);
  timeoutId = window.setTimeout(() => {
    finish(false);
  }, timeoutMs);
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
  frame.contentWindow.__pdfExportMode = true;

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
  const readySignalPromise = waitForFrameReadySignal(frame);
  postMetadataToFrame(frame);
  const sourceUrl = frame?.getAttribute('src') || frame?.src || '';
  const isChartPage = isChartExportSource(sourceUrl);
  const didReceiveReadySignal = await readySignalPromise;

  if (didReceiveReadySignal) {
    if (!isChartPage) {
      await delay(nonChartFallbackDelayMs);
    }
  } else {
    await delay(isChartPage ? renderDelayMs : nonChartFallbackDelayMs);
  }

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
const createPdfRenderHost = (dimensions) => {
  const host = document.createElement('div');
  const stylesheet = document.createElement('link');
  const body = document.createElement('div');
  const pageWidthMm = dimensions?.pageWidthMm || 210;
  const pageHeightMm = dimensions?.pageHeightMm || 297;
  const pageMarginMm = dimensions?.pageMarginMm || 16;

  host.id = 'pdf-export-render-host';
  host.style.position = 'fixed';
  host.style.left = '0';
  host.style.top = '0';
  host.style.width = `${pageWidthMm}mm`;
  host.style.background = '#ffffff';
  host.style.opacity = '0';
  host.style.pointerEvents = 'none';
  host.style.zIndex = '-1';
  host.style.setProperty('--page-width', `${pageWidthMm}mm`);
  host.style.setProperty('--page-height', `${pageHeightMm}mm`);
  host.style.setProperty('--page-margin', `${pageMarginMm}mm`);

  stylesheet.rel = 'stylesheet';
  stylesheet.href = pdfStylesheetUrl;

  body.id = 'pdf-export-body';
  body.className = 'pdf-export-body';

  host.append(stylesheet, body);
  document.body.appendChild(host);

  return { host, stylesheet, body };
};

// Build export page wrappers once so preview and export share the same DOM shape.
const buildAssembledExportDom = (pages, targetDocument) => {
  const fragment = targetDocument.createDocumentFragment();

  pages.forEach(({ source, body: pageBody }, index) => {
    const pageNumber = index + 1;
    const wrapper = targetDocument.createElement('section');
    const adoptedBody = targetDocument.adoptNode(pageBody.cloneNode(true));

    wrapper.className = 'pdf-export-page';
    wrapper.id = `pdf-export-page-${pageNumber}`;
    wrapper.setAttribute('data-export-source', source);
    wrapper.appendChild(adoptedBody);

    applyPageFooter(wrapper, targetDocument, pageNumber);
    fragment.appendChild(wrapper);
  });

  return fragment;
};

// Render assembled export pages into the page 4 final preview container.
const renderAssembledPreview = async (previewContainer, pages) => {
  if (!previewContainer) {
    return;
  }

  previewContainer.replaceChildren(buildAssembledExportDom(pages, document));
  await waitForLayout();
};

// Render all assembled pages into a downloadable PDF blob.
const renderPdfBlob = async (pages) => {
  const html2pdf = await loadHtml2Pdf();
  const dimensions = readPdfDimensions();
  const {
    pageWidthIn,
    pageHeightIn,
    pageMarginIn,
  } = dimensions;
  const { host, stylesheet, body } = createPdfRenderHost(dimensions);

  try {
    await waitForStylesheet(stylesheet);
    body.appendChild(buildAssembledExportDom(pages, document));
    await waitForLayout();

    const renderDocument = host.ownerDocument;

    if (renderDocument?.fonts?.ready) {
      await renderDocument.fonts.ready;
    }

    return html2pdf().set({
      margin: pageMarginIn,
      filename: exportedPdfFileName,
      image: { type: 'png', quality: 1 },
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

// Build assembled export pages by loading each source into hidden iframes.
const assembleExportPages = async () => {
  const stagingArea = createStagingArea();
  const pages = [];

  try {
    for (const source of exportSources) {
      const frame = document.createElement('iframe');

      frame.src = source;
      frame.loading = 'eager';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.width = '1px';
      frame.style.height = '1px';

      stagingArea.appendChild(frame);
      pages.push({ source, body: await cloneFrameBody(frame) });
    }

    assembledExportPagesCache = pages;

    return pages;
  } finally {
    stagingArea.remove();
  }
};

// Initialize export preview navigation controls.
export async function initSection(sectionElement) {
  const previewFrame = sectionElement?.querySelector('#export-preview-frame');
  const previewControls = sectionElement?.querySelector('#export-preview-controls');
  const previewShell = sectionElement?.querySelector('#export-preview-page-shell');
  const assembledShell = sectionElement?.querySelector('#export-preview-assembled-shell');
  const assembledPreview = sectionElement?.querySelector('#export-preview-assembled');
  const previewModeToggle = sectionElement?.querySelector('#export-mode-toggle-button');
  const prevButton = sectionElement?.querySelector('#export-nav-prev');
  const nextButton = sectionElement?.querySelector('#export-nav-next');
  const exclusionButton = sectionElement?.querySelector('#export-exclusion-button');
  const exportPdfButton = sectionElement?.querySelector('#export-pdf-button');
  let exclusionModal = document.getElementById('export-exclusion-modal');
  let exclusionBackdrop = document.getElementById('export-exclusion-backdrop');
  let exclusionCloseButtons = null;
  let isDebugSourceMode = false;

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

  // Toggle between final assembled preview and source-page debug preview.
  const setPreviewMode = (enableDebugMode) => {
    isDebugSourceMode = Boolean(enableDebugMode);

    if (previewControls) {
      previewControls.hidden = !isDebugSourceMode;
    }

    if (previewShell) {
      previewShell.hidden = !isDebugSourceMode;
    }

    if (assembledShell) {
      assembledShell.hidden = isDebugSourceMode;
    }

    if (previewModeToggle) {
      previewModeToggle.textContent = isDebugSourceMode
        ? 'Final export preview'
        : 'Source page debug';
    }
  };

  // Refresh the final export preview with the assembled export DOM tree.
  const refreshAssembledPreview = async () => {
    if (!assembledPreview) {
      return;
    }

    setExportButtonBusyState(exportPdfButton, true);

    try {
      const pages = await assembleExportPages();

      await renderAssembledPreview(assembledPreview, pages);
    } catch (error) {
      console.error('Unable to refresh assembled export preview.', error);
    } finally {
      setExportButtonBusyState(exportPdfButton, false);
    }
  };

  if (!previewFrame || !prevButton || !nextButton || !assembledPreview || !previewModeToggle) {
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
    try {
      setExportButtonBusyState(exportPdfButton, true);

      const pages = assembledExportPagesCache.length
        ? assembledExportPagesCache
        : await assembleExportPages();
      const pdfBlob = await renderPdfBlob(pages);

      downloadPdfBlob(pdfBlob);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('PDF export failed.', error);
      alert('Unable to export PDF right now. Please try again.');
    } finally {
      setExportButtonBusyState(exportPdfButton, false);
    }
  };

  exclusionButton?.addEventListener('click', openExclusionModal);
  exclusionCloseButtons?.forEach((button) => {
    button.addEventListener('click', closeExclusionModal);
  });
  exclusionBackdrop?.addEventListener('click', closeExclusionModal);

  previewModeToggle.addEventListener('click', () => {
    setPreviewMode(!isDebugSourceMode);
  });

  // Dismiss the modal when the escape key is pressed.
  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      closeExclusionModal();
    }
  };

  document.addEventListener('keydown', handleEscape);
  exportPdfButton?.addEventListener('click', handlePdfExportRequested);

  setPreviewMode(false);
  await refreshAssembledPreview();
}
