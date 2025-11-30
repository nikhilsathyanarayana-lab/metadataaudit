import { waitForMetadataFields } from '../pages/metadataFields.js';

const XLSX_LIBRARIES = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  fileSaver: 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js',
};

let workbookLibsPromise;

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

const combineAppIdentifiers = (headers, rows) => {
  const appNameIndex = headers.findIndex((header) => header.toLowerCase() === 'app name');
  const appIdIndex = headers.findIndex((header) => header.toLowerCase() === 'app id');

  if (appNameIndex === -1 || appIdIndex === -1) {
    return { headers, rows };
  }

  const primaryIndex = Math.min(appNameIndex, appIdIndex);
  const removalIndex = appNameIndex === primaryIndex ? appIdIndex : appNameIndex;

  const updatedHeaders = [...headers];
  updatedHeaders.splice(removalIndex, 1);

  const updatedRows = rows.map((row) => {
    const combinedValue = [row[appNameIndex], row[appIdIndex]].filter(Boolean).join('\n');
    const updatedRow = [...row];
    updatedRow[primaryIndex] = combinedValue;
    updatedRow.splice(removalIndex, 1);
    return updatedRow;
  });

  return { headers: updatedHeaders, rows: updatedRows };
};

const stripIntegrationKeyColumns = (headers) => {
  const indicesToKeep = [];
  const cleanedHeaders = [];

  headers.forEach((header, index) => {
    const normalized = header.toLowerCase();
    if (normalized.includes('integration key')) {
      return;
    }

    indicesToKeep.push(index);
    cleanedHeaders.push(header);
  });

  return { indicesToKeep, cleanedHeaders };
};

const sanitizePlaceholderValues = (headers, rows) => {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());

  return rows.map((row) =>
    row.map((value, index) => {
      if (normalizedHeaders[index] === 'app name' && typeof value === 'string') {
        return value.trim().toLowerCase() === 'not set' ? '' : value;
      }

      return value;
    }),
  );
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

const collectTableData = (table) => {
  const headerCells = Array.from(table.querySelectorAll('thead th'));
  let headers = headerCells.map((th) => th.textContent.trim());

  let rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    return cells.map((cell) => extractCellValue(cell));
  });

  rows = sanitizePlaceholderValues(headers, rows);

  ({ headers, rows } = combineAppIdentifiers(headers, rows));
  const { indicesToKeep, cleanedHeaders } = stripIntegrationKeyColumns(headers);
  const cleanedRows = rows.map((row) => indicesToKeep.map((index) => row[index]));

  return { headers: cleanedHeaders, rows: cleanedRows };
};

const buildTableRows = (table, label) => {
  if (!table) {
    return [];
  }

  const { headers, rows } = collectTableData(table);

  return rows.map((rowCells) => {
    const row = { Type: label };
    headers.forEach((header, idx) => {
      row[header || `Column ${idx + 1}`] = rowCells[idx];
    });
    return row;
  });
};

const collectPageTables = (root) => {
  const visitorMetadataTable = root.getElementById('visitor-metadata-table');
  const accountMetadataTable = root.getElementById('account-metadata-table');
  const visitorDeepDiveTable = root.getElementById('visitor-deep-dive-table');
  const accountDeepDiveTable = root.getElementById('account-deep-dive-table');

  return {
    metadataRows: [
      ...buildTableRows(visitorMetadataTable, 'Visitor metadata'),
      ...buildTableRows(accountMetadataTable, 'Account metadata'),
    ],
    deepDiveRows: [
      ...buildTableRows(visitorDeepDiveTable, 'Visitor deep dive'),
      ...buildTableRows(accountDeepDiveTable, 'Account deep dive'),
    ],
  };
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

const buildSheet = (rows, fallbackMessage) => {
  if (!rows.length) {
    const fallbackSheet = window.XLSX.utils.json_to_sheet([{ Note: fallbackMessage }]);
    applyHeaderFormatting(fallbackSheet);
    return fallbackSheet;
  }

  const sheet = window.XLSX.utils.json_to_sheet(rows);
  applyHeaderFormatting(sheet);
  return sheet;
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

const buildWorkbook = ({ metadataRows, deepDiveRows }) => {
  const workbook = window.XLSX.utils.book_new();

  const metadataSheet = buildSheet(
    metadataRows,
    'No metadata fields were available to export. Run the Metadata Fields page and try again.',
  );
  window.XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Metadata fields');

  const deepDiveSheet = buildSheet(
    deepDiveRows,
    'No deep-dive rows were available to export. Visit the Deep Dive page and try again.',
  );
  window.XLSX.utils.book_append_sheet(workbook, deepDiveSheet, 'Deep dive');

  return workbook;
};

export const exportMetadataXlsx = async () => {
  const desiredName = await openNamingModal();
  if (desiredName === null) {
    return;
  }

  await ensureWorkbookLibraries();
  await waitForMetadataFields();

  const metadataDoc = await ensurePageDocument('metadata_fields.html');
  const deepDiveDoc = await ensurePageDocument('deep_dive.html');

  const metadataTables = metadataDoc ? collectPageTables(metadataDoc) : { metadataRows: [], deepDiveRows: [] };
  const deepDiveTables = deepDiveDoc ? collectPageTables(deepDiveDoc) : { metadataRows: [], deepDiveRows: [] };

  const workbook = buildWorkbook({
    metadataRows: metadataTables.metadataRows,
    deepDiveRows: deepDiveTables.deepDiveRows,
  });

  downloadWorkbook(workbook, desiredName || buildDefaultFileName());
};
