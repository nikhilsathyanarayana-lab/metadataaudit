import { createLogger } from '../../utils/logger.js';

const XLSX_LIBRARIES = {
  exceljs: 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
  fileSaver: 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
};

let workbookLibsPromise;

export const logXlsx = createLogger('XLSX Export').log;

const ensureScript = (key, url) =>
  new Promise((resolve, reject) => {
    if (key && window[key]) {
      logXlsx('debug', `${key} already available for workbook export`);
      resolve(window[key]);
      return;
    }

    logXlsx('debug', `Loading ${key} from CDN for workbook export (${url})`);
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      logXlsx('info', `${key} loaded for workbook export`);
      resolve(window[key]);
    };
    script.onerror = () => {
      logXlsx('error', `Failed to load ${key} library for workbook export`, url);
      reject(new Error(`Failed to load ${key} library`));
    };
    document.head.appendChild(script);
  });

export const ensureWorkbookLibraries = () => {
  if (!workbookLibsPromise) {
    workbookLibsPromise = Promise.all([
      ensureScript('ExcelJS', XLSX_LIBRARIES.exceljs),
      ensureScript('saveAs', XLSX_LIBRARIES.fileSaver),
    ]);
  }

  return workbookLibsPromise;
};

export const sanitizeFileName = (value, fallback) => {
  const fallbackName = fallback || 'metadata_export';
  if (!value) {
    return fallbackName;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallbackName;
  }

  const withoutExt = trimmed.replace(/\.xlsx$/i, '').trim();
  return withoutExt || fallbackName;
};

const closeNamingModal = (modal, backdrop, handlers = []) => {
  modal.classList.remove('is-visible');
  backdrop.classList.remove('is-visible');
  modal.hidden = true;
  backdrop.hidden = true;
  handlers.forEach((handler) => handler?.());
};

export const openNamingModal = (buildDefaultFileName, sanitizeName = sanitizeFileName) =>
  new Promise((resolve) => {
    const modal = document.getElementById('xlsx-naming-modal');
    const backdrop = document.getElementById('xlsx-naming-backdrop');
    const form = document.getElementById('xlsx-naming-form');
    const input = document.getElementById('xlsx-file-name');
    const dismissButtons = modal?.querySelectorAll('[data-dismiss-xlsx-modal]') || [];
    const fallbackName = typeof buildDefaultFileName === 'function' ? buildDefaultFileName() : 'metadata_export';

    if (!modal || !backdrop || !form || !input) {
      const filename = window.prompt('Name your XLSX export', fallbackName);
      resolve(filename === null ? null : sanitizeName(filename, fallbackName));
      return;
    }

    const cleanup = [];
    input.value = fallbackName;

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
      const value = sanitizeName(input.value, fallbackName);
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

export const downloadWorkbook = (workbook, filename) => {
  return workbook.xlsx
    .writeBuffer()
    .then((buffer) =>
      window.saveAs(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${filename}.xlsx`,
      ),
    )
    .catch((error) => {
      logXlsx('error', 'Workbook download failed.', error);
      throw error;
    });
};

export const sanitizeSheetName = (name, existingNames = new Set()) => {
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

const HEADER_STYLE = {
  font: {
    bold: true,
    size: 16,
    color: { argb: 'FFFFFFFF' },
  },
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE83E8C' },
  },
};

export const applyHeaderFormatting = (worksheet) => {
  if (!worksheet) {
    logXlsx('warn', 'applyHeaderFormatting skipped because the worksheet is missing');
    return;
  }

  const headerRow = worksheet.getRow(1);
  if (!headerRow || headerRow.cellCount === 0) {
    logXlsx('warn', 'applyHeaderFormatting skipped because the header row is empty');
    return;
  }

  headerRow.eachCell((cell) => {
    cell.font = { ...(cell.font || {}), ...HEADER_STYLE.font };
    cell.fill = HEADER_STYLE.fill;
  });

  logXlsx('debug', `Applied header formatting to ${headerRow.cellCount} column(s)`);
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
    logXlsx('error', `Unable to load ${path} for export`, error);
    return null;
  }
};

export const ensurePageDocument = async (path) => {
  const currentPath = window.location.pathname.split('/').pop();
  if (currentPath === path) {
    return document;
  }

  return fetchStaticDocument(path);
};
