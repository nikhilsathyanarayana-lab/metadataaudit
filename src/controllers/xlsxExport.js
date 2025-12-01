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

const LOOKBACK_WINDOWS = [180, 30, 7];

const parseCount = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
};

const initWindowTotals = () => ({
  180: 0,
  30: 0,
  7: 0,
});

const addCountsToTotals = (totals, counts) => {
  LOOKBACK_WINDOWS.forEach((windowDays) => {
    totals[windowDays] += counts?.[windowDays] || 0;
  });
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

const collectMetadataRows = (table, type) => {
  if (!table) {
    return [];
  }

  const { headers, rows } = collectTableData(table);
  const subIndex = headers.findIndex((header) => header.toLowerCase() === 'sub id');
  const appNameIndex = headers.findIndex((header) => header.toLowerCase().includes('app name'));
  const appIdIndex = headers.findIndex((header) => header.toLowerCase().includes('app id'));
  const windowIndexes = LOOKBACK_WINDOWS.reduce((acc, windowDays) => {
    const idx = headers.findIndex((header) => header.includes(windowDays));
    if (idx !== -1) {
      acc[windowDays] = idx;
    }
    return acc;
  }, {});

  return rows.map((cells) => ({
    subId: subIndex === -1 ? '' : cells[subIndex],
    appName: appNameIndex === -1 ? '' : cells[appNameIndex],
    appId: appIdIndex === -1 ? '' : cells[appIdIndex],
    type,
    counts: LOOKBACK_WINDOWS.reduce(
      (acc, windowDays) => ({
        ...acc,
        [windowDays]: parseCount(cells[windowIndexes[windowDays]]),
      }),
      {},
    ),
  }));
};

const aggregateBySubscription = (visitorRows, accountRows) => {
  const subscriptions = new Map();
  const overallTotals = { visitor: initWindowTotals(), account: initWindowTotals() };

  const addRow = (row) => {
    if (!row) {
      return;
    }

    const { subId, appId, appName, counts, type } = row;
    const existingSub = subscriptions.get(subId) || {
      subId,
      apps: new Map(),
      totals: { visitor: initWindowTotals(), account: initWindowTotals() },
    };

    addCountsToTotals(existingSub.totals[type], counts);

    const existingApp = existingSub.apps.get(appId) || {
      appId,
      appName,
      totals: { visitor: initWindowTotals(), account: initWindowTotals() },
    };

    addCountsToTotals(existingApp.totals[type], counts);

    existingSub.apps.set(appId, existingApp);
    subscriptions.set(subId, existingSub);
    addCountsToTotals(overallTotals[type], counts);
  };

  visitorRows.forEach((row) => addRow(row));
  accountRows.forEach((row) => addRow(row));

  return {
    overallTotals,
    subscriptions: Array.from(subscriptions.values()).map((subscription) => ({
      ...subscription,
      apps: Array.from(subscription.apps.values()),
    })),
    distinctSubCount: subscriptions.size,
    distinctAppCount: new Set([...visitorRows, ...accountRows].map((row) => row.appId)).size,
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

const buildWorkbook = ({ overallTotals, subscriptions, distinctSubCount, distinctAppCount }) => {
  const workbook = window.XLSX.utils.book_new();
  const sheetNames = new Set();

  const summaryRows = [
    {
      Scope: 'All data',
      Type: 'Visitor',
      'Distinct subs': distinctSubCount,
      'Distinct apps': distinctAppCount,
      '180 days': overallTotals.visitor[180],
      '30 days': overallTotals.visitor[30],
      '7 days': overallTotals.visitor[7],
    },
    {
      Scope: 'All data',
      Type: 'Account',
      'Distinct subs': distinctSubCount,
      'Distinct apps': distinctAppCount,
      '180 days': overallTotals.account[180],
      '30 days': overallTotals.account[30],
      '7 days': overallTotals.account[7],
    },
  ];

  const summarySheet = buildSheet(summaryRows, 'No metadata fields were available to summarize.');
  window.XLSX.utils.book_append_sheet(workbook, summarySheet, sanitizeSheetName('whole-data summary', sheetNames));

  const subLevelRows = subscriptions.flatMap((subscription) => [
    {
      'Sub ID': subscription.subId || 'Unknown',
      Type: 'Visitor',
      'App count': subscription.apps.length,
      '180 days': subscription.totals.visitor[180],
      '30 days': subscription.totals.visitor[30],
      '7 days': subscription.totals.visitor[7],
    },
    {
      'Sub ID': subscription.subId || 'Unknown',
      Type: 'Account',
      'App count': subscription.apps.length,
      '180 days': subscription.totals.account[180],
      '30 days': subscription.totals.account[30],
      '7 days': subscription.totals.account[7],
    },
  ]);

  const subLevelSheet = buildSheet(subLevelRows, 'No subscription-level details were available to export.');
  window.XLSX.utils.book_append_sheet(workbook, subLevelSheet, sanitizeSheetName('Sub level', sheetNames));

  subscriptions.forEach((subscription) => {
    subscription.apps.forEach((app) => {
      const rows = [
        {
          Type: 'Visitor',
          'Sub ID': subscription.subId || 'Unknown',
          'App name': app.appName || app.appId || 'Unknown',
          'App ID': app.appId || '',
          '180 days': app.totals.visitor[180],
          '30 days': app.totals.visitor[30],
          '7 days': app.totals.visitor[7],
        },
        {
          Type: 'Account',
          'Sub ID': subscription.subId || 'Unknown',
          'App name': app.appName || app.appId || 'Unknown',
          'App ID': app.appId || '',
          '180 days': app.totals.account[180],
          '30 days': app.totals.account[30],
          '7 days': app.totals.account[7],
        },
      ];

      const sheet = buildSheet(rows, 'No app-level metadata was available to export.');
      const sheetLabel = `${subscription.subId || 'sub'}-${app.appName || app.appId || 'app'} breakdown`;
      window.XLSX.utils.book_append_sheet(workbook, sheet, sanitizeSheetName(sheetLabel, sheetNames));
    });
  });

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
  const visitorTable = metadataDoc?.getElementById('visitor-metadata-table');
  const accountTable = metadataDoc?.getElementById('account-metadata-table');

  const visitorRows = collectMetadataRows(visitorTable, 'visitor');
  const accountRows = collectMetadataRows(accountTable, 'account');
  const aggregation = aggregateBySubscription(visitorRows, accountRows);

  const workbook = buildWorkbook(aggregation);

  downloadWorkbook(workbook, desiredName || buildDefaultFileName());
};
