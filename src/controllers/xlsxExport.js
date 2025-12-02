import { waitForMetadataFields } from '../pages/metadataFields.js';

const XLSX_LIBRARIES = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  fileSaver: 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
};

let workbookLibsPromise;

const getExportUi = () => {
  const progressBanner = document.getElementById('metadata-fields-progress');
  const progressText = document.getElementById('metadata-fields-progress-text');
  const exportButton = document.getElementById('export-button');
  const exportMarker = `export-${Date.now()}`;
  let lastMessage = '';

  const previousText = progressText?.textContent;
  const previousBannerBusy = progressBanner?.getAttribute('aria-busy');
  const previousButtonDisabled = exportButton?.disabled ?? false;

  const setStatus = (message, { tone = 'info', pending = false } = {}) => {
    if (progressText && message) {
      progressText.textContent = message;
      progressText.dataset.exportStatus = exportMarker;
      lastMessage = message;
    }

    if (progressBanner) {
      if (pending) {
        progressBanner.setAttribute('aria-busy', 'true');
      } else {
        progressBanner.removeAttribute('aria-busy');
      }

      progressBanner.classList.toggle('is-error', tone === 'error');
    }

    if (exportButton) {
      exportButton.disabled = pending;
      exportButton.setAttribute('aria-disabled', String(pending));
      exportButton.setAttribute('aria-busy', String(pending));
    }
  };

  const restore = () => {
    if (progressText?.dataset?.exportStatus !== exportMarker) {
      return;
    }

    if (progressText && typeof previousText === 'string' && progressText.textContent === lastMessage) {
      progressText.textContent = previousText;
      delete progressText.dataset.exportStatus;
    }

    if (progressBanner) {
      if (previousBannerBusy) {
        progressBanner.setAttribute('aria-busy', previousBannerBusy);
      } else {
        progressBanner.removeAttribute('aria-busy');
      }

      progressBanner.classList.remove('is-error');
    }

    if (exportButton) {
      exportButton.disabled = previousButtonDisabled;
      exportButton.setAttribute('aria-disabled', String(previousButtonDisabled));
      exportButton.removeAttribute('aria-busy');
    }
  };

  return { setStatus, restore };
};

const ensureScript = (key, url) =>
  new Promise((resolve, reject) => {
    if (key && window[key]) {
      resolve(window[key]);
      return;
    }

    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve(window[key]);
    script.onerror = () => reject(new Error(`Failed to load ${key} library`));
    document.head.appendChild(script);
  });

const ensureWorkbookLibraries = () => {
  if (!workbookLibsPromise) {
    workbookLibsPromise = Promise.all([
      ensureScript('XLSX', XLSX_LIBRARIES.xlsx),
      ensureScript('saveAs', XLSX_LIBRARIES.fileSaver),
    ]);
  }

  return workbookLibsPromise;
};

const buildDefaultFileName = () => {
  const today = new Date();
  const dateStamp = today.toISOString().slice(0, 10);
  return `metadata_fields-${dateStamp}`;
};

const sanitizeFileName = (value) => {
  const fallback = buildDefaultFileName();
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const withoutExt = trimmed.replace(/\.xlsx$/i, '').trim();
  return withoutExt || fallback;
};

const closeNamingModal = (modal, backdrop, handlers = []) => {
  modal.classList.remove('is-visible');
  backdrop.classList.remove('is-visible');
  modal.hidden = true;
  backdrop.hidden = true;
  handlers.forEach((handler) => handler?.());
};

const openNamingModal = () =>
  new Promise((resolve) => {
    const modal = document.getElementById('xlsx-naming-modal');
    const backdrop = document.getElementById('xlsx-naming-backdrop');
    const form = document.getElementById('xlsx-naming-form');
    const input = document.getElementById('xlsx-file-name');
    const dismissButtons = modal?.querySelectorAll('[data-dismiss-xlsx-modal]') || [];

    if (!modal || !backdrop || !form || !input) {
      const filename = window.prompt('Name your XLSX export', buildDefaultFileName());
      resolve(filename === null ? null : sanitizeFileName(filename));
      return;
    }

    const cleanup = [];
    const defaultName = buildDefaultFileName();
    input.value = defaultName;

    modal.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      modal.classList.add('is-visible');
      backdrop.classList.add('is-visible');
      input.focus();
      input.select();
    });

    const handleCancel = () => {
      closeNamingModal(modal, backdrop, cleanup);
      resolve(null);
    };

    const handleSubmit = (event) => {
      event.preventDefault();
      const value = sanitizeFileName(input.value);
      closeNamingModal(modal, backdrop, cleanup);
      resolve(value);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleCancel();
      }
    };

    cleanup.push(() => document.removeEventListener('keydown', handleKeyDown));
    cleanup.push(() => form.removeEventListener('submit', handleSubmit));
    cleanup.push(() => backdrop.removeEventListener('click', handleCancel));
    dismissButtons.forEach((button) => {
      const handler = () => handleCancel();
      button.addEventListener('click', handler);
      cleanup.push(() => button.removeEventListener('click', handler));
    });

    document.addEventListener('keydown', handleKeyDown);
    form.addEventListener('submit', handleSubmit);
    backdrop.addEventListener('click', handleCancel);
  });

const extractCellValue = (cell) => {
  if (!cell) {
    return '';
  }

  const select = cell.querySelector('select');
  if (select) {
    const selected = select.options[select.selectedIndex];
    return selected?.textContent?.trim() || select.value || '';
  }

  return cell.textContent.trim();
};

const HEADER_STYLE = {
  font: {
    bold: true,
    sz: 14,
    color: { rgb: 'E83E8C' },
  },
};

const applyHeaderFormatting = (sheet) => {
  if (!sheet || !sheet['!ref']) {
    return;
  }

  const range = window.XLSX.utils.decode_range(sheet['!ref']);
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const cellAddress = window.XLSX.utils.encode_cell({ r: range.s.r, c: columnIndex });
    const cell = sheet[cellAddress];

    if (cell) {
      cell.s = {
        ...(cell.s || {}),
        font: { ...(cell.s?.font || {}), ...HEADER_STYLE.font },
      };
    }
  }
};

const collectTableAoA = (table) => {
  if (!table) {
    return null;
  }

  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
  const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map(extractCellValue),
  );

  return [headers, ...rows];
};

const fetchStaticDocument = async (path) => {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${path}: ${response.status}`);
    }

    const html = await response.text();
    const parser = new DOMParser();
    return parser.parseFromString(html, 'text/html');
  } catch (error) {
    console.error(`Unable to load ${path} for export`, error);
    return null;
  }
};

const ensurePageDocument = async (path) => {
  const currentPath = window.location.pathname.split('/').pop();
  if (currentPath === path) {
    return document;
  }

  return fetchStaticDocument(path);
};

const downloadWorkbook = (workbook, filename) => {
  const workbookArray = window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  window.saveAs(
    new Blob([workbookArray], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${filename}.xlsx`,
  );
};

const sanitizeSheetName = (name, existingNames = new Set()) => {
  const cleaned = (name || 'Sheet').replace(/[\[\]\*\?:\\\/]/g, '').slice(0, 31) || 'Sheet';
  let candidate = cleaned;
  let suffix = 1;

  while (existingNames.has(candidate)) {
    const trimmedBase = cleaned.slice(0, 28);
    candidate = `${trimmedBase}-${suffix}`.slice(0, 31);
    suffix += 1;
  }

  existingNames.add(candidate);
  return candidate;
};

const buildSheetFromAoA = (aoa, fallbackMessage) => {
  if (!aoa || !aoa.length || !aoa[0]?.length) {
    const sheet = window.XLSX.utils.json_to_sheet([{ Note: fallbackMessage }]);
    applyHeaderFormatting(sheet);
    return sheet;
  }

  const sheet = window.XLSX.utils.aoa_to_sheet(aoa);
  applyHeaderFormatting(sheet);
  return sheet;
};

const addTableSheet = (workbook, table, label, sheetNames) => {
  const aoa = collectTableAoA(table);
  const sheet = buildSheetFromAoA(aoa, `${label} data was not available to export.`);
  window.XLSX.utils.book_append_sheet(workbook, sheet, sanitizeSheetName(label, sheetNames));
};

export const exportMetadataXlsx = async () => {
  const desiredName = await openNamingModal();
  if (desiredName === null) {
    return;
  }

  const { setStatus, restore } = getExportUi();

  try {
    setStatus('Preparing XLSX export…', { pending: true });
    await ensureWorkbookLibraries();

    setStatus('Loading available metadata for export…', { pending: true });
    waitForMetadataFields().catch((error) =>
      console.error('Metadata fields may not finish loading before export completes.', error),
    );

    setStatus('Building XLSX workbook…', { pending: true });
    const metadataDoc = await ensurePageDocument('metadata_fields.html');
    const visitorTable = metadataDoc?.getElementById('visitor-metadata-table');
    const accountTable = metadataDoc?.getElementById('account-metadata-table');

    const workbook = window.XLSX.utils.book_new();
    const sheetNames = new Set();

    addTableSheet(workbook, visitorTable, 'Visitor', sheetNames);
    addTableSheet(workbook, accountTable, 'Account', sheetNames);

    downloadWorkbook(workbook, desiredName || buildDefaultFileName());
    setStatus('Export ready. Your XLSX download should start shortly.', { pending: false });
  } catch (error) {
    console.error('Unable to export metadata XLSX.', error);
    setStatus('Unable to export metadata to XLSX. Please try again.', {
      pending: false,
      tone: 'error',
    });
  } finally {
    setTimeout(() => restore(), 1500);
  }
};
