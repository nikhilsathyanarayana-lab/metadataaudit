const XLSX_LIBRARIES = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  fileSaver: 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
};

let workbookLibsPromise;
let hasLoggedStyleLimitation = false;

const logStyleLimitation = () => {
  if (hasLoggedStyleLimitation) {
    return;
  }

  hasLoggedStyleLimitation = true;
  logXlsx(
    'warn',
    'The bundled SheetJS community build does not support writing cell styles, so exported XLSX files will not include header formatting.',
  );
};

export const logXlsx = (level, ...messages) => {
  const normalizedLevel = level === 'error' || level === 'warn' || level === 'debug' ? level : 'info';
  const logger =
    normalizedLevel === 'error' && typeof console?.error === 'function'
      ? console.error
      : typeof console?.[normalizedLevel] === 'function'
        ? console[normalizedLevel]
        : console.log;

  logger('[XLSX Export]', ...messages);
};

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
      ensureScript('XLSX', XLSX_LIBRARIES.xlsx),
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
  logStyleLimitation();
  const workbookArray = window.XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  window.saveAs(
    new Blob([
      workbookArray,
    ], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `${filename}.xlsx`,
  );
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
    sz: 14,
    color: { rgb: 'E83E8C' },
  },
};

export const applyHeaderFormatting = (sheet) => {
  if (!sheet || !sheet['!ref']) {
    logXlsx('warn', 'applyHeaderFormatting skipped because the sheet is missing data or range metadata');
    return;
  }

  logStyleLimitation();

  const range = window.XLSX.utils.decode_range(sheet['!ref']);
  if (range.s.c > range.e.c) {
    logXlsx('warn', 'applyHeaderFormatting skipped because the sheet range is empty', sheet['!ref']);
    return;
  }

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

  logXlsx('debug', `Applied header formatting to ${range.e.c - range.s.c + 1} column(s)`);
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

export const ensurePageDocument = async (path) => {
  const currentPath = window.location.pathname.split('/').pop();
  if (currentPath === path) {
    return document;
  }

  return fetchStaticDocument(path);
};
