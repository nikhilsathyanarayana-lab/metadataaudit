// Orchestrates the deep dive experience by connecting data helpers, aggregation, and UI flows.
import { buildMetaEventsPayload, postAggregationWithIntegrationKey } from '../services/requests.js';
import { applyManualAppNames, loadManualAppNames } from '../services/appNames.js';
import {
  DEEP_DIVE_CONCURRENCY,
  LOOKBACK_OPTIONS,
  TARGET_LOOKBACK,
  logDeepDive,
} from './deepDive/constants.js';
import {
  buildRowsForLookback,
  buildScanEntries,
  loadDeepDiveRecords,
  loadMetadataRecords,
  scheduleDomUpdate,
  syncDeepDiveRecordsAppName,
  syncMetadataRecordsAppName,
  upsertDeepDiveRecord,
  yieldToBrowser,
} from './deepDive/dataHelpers.js';
import {
  clearDeepDiveCollections,
  collectDeepDiveMetadataFields,
  ensureDeepDiveAccumulatorEntry,
  exportDeepDiveJson,
  metadata_api_calls,
  updateMetadataApiCalls,
  updateMetadataCollections,
} from './deepDive/aggregation.js';
import {
  ensureMessageRegion,
  installDeepDiveGlobalErrorHandlers,
  renderTable,
  reportDeepDiveError,
  setExportAvailability,
  setupLookbackControls,
  setupProgressTracker,
  showMessage,
  updateMetadataFieldHeaders,
} from './deepDive/ui/render.js';
import { setupManualAppNameModal, setupRegexFormatModal } from './deepDive/ui/modals.js';

export { exportDeepDiveJson, installDeepDiveGlobalErrorHandlers, reportDeepDiveError };

const LOOKBACK_WINDOWS = [180, 30, 7];

const runDeepDiveScan = async (
  entries,
  lookback,
  updateProgress,
  messageRegion,
  rows,
  onSuccessfulCall,
  onComplete,
) => {
  clearDeepDiveCollections();

  const targetLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;
  const queue = entries.slice();
  const totalCalls = queue.length;
  let completedCalls = 0;
  let successCount = 0;
  const deepDiveAccumulator = new Map();

  const updateProgressAsync = () =>
    scheduleDomUpdate(() => {
      updateProgress?.(completedCalls, totalCalls);
      logDeepDive('info', 'Deep dive progress update', {
        completedCalls,
        totalCalls,
      });
    });

  const sendMessageAsync = (message, tone = 'info') =>
    scheduleDomUpdate(() => showMessage(messageRegion, message, tone));

  logDeepDive('info', 'Starting deep dive scan', {
    requestedEntries: entries.length,
    totalCalls,
    targetLookback,
  });

  if (!totalCalls) {
    updateProgressAsync();
    sendMessageAsync(
      'No metadata selections found. Run the Metadata Fields page first to capture app details.',
      'error',
    );
    return;
  }

  updateProgressAsync();

  const processEntry = async (entry) => {
    logDeepDive('info', 'Processing deep dive entry', {
      appId: entry.appId,
      subId: entry.subId,
      targetLookback,
    });

    await yieldToBrowser();
    let payload;
    let response = null;
    try {
      payload = buildMetaEventsPayload(entry.appId, targetLookback);
      logDeepDive('info', 'Built metadata events payload', {
        appId: entry.appId,
        subId: entry.subId,
        targetLookback,
        payload,
      });

      logDeepDive('info', 'Dispatching deep dive request', {
        appId: entry.appId,
        subId: entry.subId,
        integrationKey: entry.integrationKey,
      });

      response = await postAggregationWithIntegrationKey(entry, payload);

      if (!response || typeof response !== 'object') {
        throw new Error('Aggregation response was empty or malformed.');
      }

      const normalizedFields = await collectDeepDiveMetadataFields(
        response,
        deepDiveAccumulator,
        entry,
      );

      upsertDeepDiveRecord(entry, normalizedFields, '', targetLookback);
      updateMetadataApiCalls(entry, 'success', '');
      await updateMetadataCollections(response, entry);
      response = null;
      successCount += 1;
      if (onSuccessfulCall) {
        scheduleDomUpdate(() => onSuccessfulCall());
      }
    } catch (error) {
      const detail = error?.message || 'Unable to fetch metadata events.';
      const normalizedFields = ensureDeepDiveAccumulatorEntry(deepDiveAccumulator, entry);

      upsertDeepDiveRecord(entry, normalizedFields, detail, targetLookback);
      updateMetadataApiCalls(entry, 'error', detail);

      reportDeepDiveError(
        `Deep dive request failed for app ${entry.appId}: ${detail}`,
        error,
        messageRegion,
      );
    } finally {
      payload = null;
      response = null;
    }
  };

  const workerCount = Math.min(Math.max(DEEP_DIVE_CONCURRENCY, 1), totalCalls);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const entry = queue.shift();

      if (!entry) {
        continue;
      }

      await processEntry(entry);
      completedCalls += 1;
      updateProgressAsync();
      await yieldToBrowser();
    }
  });

  await Promise.all(workers);

  if (successCount) {
    sendMessageAsync(
      `Completed ${successCount} deep dive request${successCount === 1 ? '' : 's'}.`,
      'info',
    );
  }

  logDeepDive('info', 'Deep dive scan completed', {
    completedCalls,
    successCount,
    totalCalls,
  });

  const clearTransientCallData = () => metadata_api_calls.splice(0, metadata_api_calls.length);

  if (onComplete) {
    scheduleDomUpdate(() => {
      onComplete();
      clearTransientCallData();
    });
  } else {
    clearTransientCallData();
  }
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

const ensureWorkbookLibraries = () =>
  Promise.all([
    ensureScript('XLSX', 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'),
    ensureScript('saveAs', 'https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js'),
  ]);

const buildDefaultFileName = () => {
  const today = new Date();
  const dateStamp = today.toISOString().slice(0, 10);
  return `metadata_deep_dive-${dateStamp}`;
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

const normalizeAppName = (value) => {
  if (!value) {
    return '';
  }

  const trimmed = String(value).trim();
  return trimmed.toLowerCase() === 'not set' ? '' : trimmed;
};

const sanitizePlaceholderValues = (headers, rows) => {
  const normalizedHeaders = headers.map((header) => header.trim().toLowerCase());

  return rows.map((row) =>
    row.map((value, index) => {
      if (normalizedHeaders[index] === 'app name') {
        return normalizeAppName(value);
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
    new Blob([
      workbookArray,
    ], {
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

const parseCount = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
};

const collectTableData = (table) => {
  const headerCells = Array.from(table?.querySelectorAll('thead th') || []);
  let headers = headerCells.map((th) => th.textContent.trim());

  let rows = Array.from(table?.querySelectorAll('tbody tr') || []).map((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    return cells.map((cell) => {
      const select = cell.querySelector('select');
      if (select) {
        const selected = select.options[select.selectedIndex];
        return selected?.textContent?.trim() || select.value || '';
      }
      return cell.textContent.trim();
    });
  });

  rows = sanitizePlaceholderValues(headers, rows);

  return { headers, rows };
};

const collectFormatSelections = (table, type) => {
  const { headers, rows } = collectTableData(table);
  const subIndex = headers.findIndex((header) => header.toLowerCase() === 'sub id');
  const appNameIndex = headers.findIndex((header) => header.toLowerCase().includes('app name'));
  const appIdIndex = headers.findIndex((header) => header.toLowerCase().includes('app id'));
  const fieldIndex = headers.findIndex((header) => header.toLowerCase().includes('metadata field'));
  const formatIndex = headers.findIndex((header) => header.toLowerCase().includes('expected format'));

  return rows.map((cells, rowIndex) => {
    const formatCell = table?.querySelectorAll('tbody tr')?.[rowIndex]?.querySelectorAll('td')?.[
      formatIndex
    ];
    const select = formatCell?.querySelector('select');

    return {
      subId: subIndex === -1 ? '' : cells[subIndex],
      appName: appNameIndex === -1 ? '' : normalizeAppName(cells[appNameIndex]),
      appId: appIdIndex === -1 ? '' : cells[appIdIndex],
      fieldName: fieldIndex === -1 ? '' : cells[fieldIndex],
      type,
      format: formatIndex === -1 ? '' : cells[formatIndex],
      regexPattern: select?.dataset?.regexPattern || '',
    };
  });
};

const buildLookbackIndex = (records) => {
  const index = new Map();
  const totals = { visitor: { 180: 0, 30: 0, 7: 0 }, account: { 180: 0, 30: 0, 7: 0 } };
  const subIds = new Set();
  const appIds = new Set();

  records.forEach((record) => {
    if (!record?.appId || !LOOKBACK_WINDOWS.includes(record.windowDays)) {
      return;
    }

    if (record.subId) {
      subIds.add(record.subId);
    }
    appIds.add(record.appId);

    const appEntry = index.get(record.appId) || {
      appId: record.appId,
      appName: '',
      subId: record.subId || '',
      visitor: new Map(),
      account: new Map(),
    };

    const sanitizedAppName = normalizeAppName(record.appName);
    if (sanitizedAppName) {
      appEntry.appName = sanitizedAppName;
    }

    if (Array.isArray(record.visitorFields)) {
      totals.visitor[record.windowDays] += record.visitorFields.length;
      record.visitorFields.forEach((field) => {
        const counts = appEntry.visitor.get(field) || { 180: 0, 30: 0, 7: 0 };
        counts[record.windowDays] += 1;
        appEntry.visitor.set(field, counts);
      });
    }

    if (Array.isArray(record.accountFields)) {
      totals.account[record.windowDays] += record.accountFields.length;
      record.accountFields.forEach((field) => {
        const counts = appEntry.account.get(field) || { 180: 0, 30: 0, 7: 0 };
        counts[record.windowDays] += 1;
        appEntry.account.set(field, counts);
      });
    }

    index.set(record.appId, appEntry);
  });

  return { index, totals, distinctSubs: subIds.size, distinctApps: appIds.size };
};

const buildSubscriptionTotals = (records) => {
  const subscriptions = new Map();

  records.forEach((record) => {
    if (!record?.subId || !LOOKBACK_WINDOWS.includes(record.windowDays)) {
      return;
    }

    const subEntry = subscriptions.get(record.subId) || {
      subId: record.subId,
      appIds: new Set(),
      totals: { visitor: { 180: 0, 30: 0, 7: 0 }, account: { 180: 0, 30: 0, 7: 0 } },
    };

    subEntry.appIds.add(record.appId);

    if (Array.isArray(record.visitorFields)) {
      subEntry.totals.visitor[record.windowDays] += record.visitorFields.length;
    }

    if (Array.isArray(record.accountFields)) {
      subEntry.totals.account[record.windowDays] += record.accountFields.length;
    }

    subscriptions.set(record.subId, subEntry);
  });

  return Array.from(subscriptions.values());
};

const buildWorkbook = (formatSelections, metadataRecords) => {
  const workbook = window.XLSX.utils.book_new();
  const sheetNames = new Set();
  const { index, totals, distinctSubs, distinctApps } = buildLookbackIndex(metadataRecords);

  const summaryRows = [
    {
      Scope: 'All data',
      Type: 'Visitor',
      'Distinct subs': distinctSubs,
      'Distinct apps': distinctApps,
      '180 days': parseCount(totals.visitor[180]),
      '30 days': parseCount(totals.visitor[30]),
      '7 days': parseCount(totals.visitor[7]),
    },
    {
      Scope: 'All data',
      Type: 'Account',
      'Distinct subs': distinctSubs,
      'Distinct apps': distinctApps,
      '180 days': parseCount(totals.account[180]),
      '30 days': parseCount(totals.account[30]),
      '7 days': parseCount(totals.account[7]),
    },
  ];

  const summarySheet = buildSheet(summaryRows, 'No deep dive metadata was available to summarize.');
  window.XLSX.utils.book_append_sheet(workbook, summarySheet, sanitizeSheetName('whole-data summary', sheetNames));

  const subscriptionRows = buildSubscriptionTotals(metadataRecords).flatMap((subscription) => [
    {
      'Sub ID': subscription.subId,
      Type: 'Visitor',
      'App count': subscription.appIds.size,
      '180 days': parseCount(subscription.totals.visitor[180]),
      '30 days': parseCount(subscription.totals.visitor[30]),
      '7 days': parseCount(subscription.totals.visitor[7]),
    },
    {
      'Sub ID': subscription.subId,
      Type: 'Account',
      'App count': subscription.appIds.size,
      '180 days': parseCount(subscription.totals.account[180]),
      '30 days': parseCount(subscription.totals.account[30]),
      '7 days': parseCount(subscription.totals.account[7]),
    },
  ]);

  const subscriptionSheet = buildSheet(
    subscriptionRows,
    'No subscription-level metadata was available to export.',
  );
  window.XLSX.utils.book_append_sheet(workbook, subscriptionSheet, sanitizeSheetName('Sub level', sheetNames));

  const groupedSelections = formatSelections.reduce((acc, selection) => {
    if (!selection?.appId) {
      return acc;
    }

    const sanitizedSelection = { ...selection, appName: normalizeAppName(selection.appName) };
    const appEntry = acc.get(selection.appId) || { appId: selection.appId, rows: [] };
    appEntry.rows.push(sanitizedSelection);
    acc.set(selection.appId, appEntry);
    return acc;
  }, new Map());

  groupedSelections.forEach((appSelection) => {
    const lookup = index.get(appSelection.appId);
    const appName = normalizeAppName(lookup?.appName || appSelection.rows[0]?.appName || '');
    const subId = lookup?.subId || appSelection.rows[0]?.subId || '';

    const rows = appSelection.rows.map((selection) => {
      const counts = lookup?.[selection.type]?.get(selection.fieldName) || {
        180: 0,
        30: 0,
        7: 0,
      };

      return {
        Type: selection.type === 'visitor' ? 'Visitor' : 'Account',
        'Sub ID': subId || selection.subId || 'Unknown',
        'App name': appName || selection.appId || 'Unknown',
        'App ID': selection.appId,
        Field: selection.fieldName,
        'Expected format': selection.format || 'Unknown',
        'Regex pattern': selection.regexPattern || '',
        '180 days': parseCount(counts[180]),
        '30 days': parseCount(counts[30]),
        '7 days': parseCount(counts[7]),
      };
    });

    const sheet = buildSheet(rows, 'No deep dive metadata was available for this app.');
    const sheetLabel = `${subId || 'sub'}-${appName || appSelection.appId || 'app'} deep dive`;
    window.XLSX.utils.book_append_sheet(
      workbook,
      sheet,
      sanitizeSheetName(sheetLabel, sheetNames),
    );
  });

  return workbook;
};

export const exportDeepDiveXlsx = async () => {
  const desiredName = await openNamingModal();
  if (desiredName === null) {
    return;
  }

  await ensureWorkbookLibraries();

  const visitorTable = document.getElementById('visitor-deep-dive-table');
  const accountTable = document.getElementById('account-deep-dive-table');
  const metadataRecords = loadMetadataRecords(reportDeepDiveError);

  const visitorSelections = collectFormatSelections(visitorTable, 'visitor');
  const accountSelections = collectFormatSelections(accountTable, 'account');

  const workbook = buildWorkbook([...visitorSelections, ...accountSelections], metadataRecords);

  downloadWorkbook(workbook, desiredName || buildDefaultFileName());
};

export const initDeepDive = async () => {
  try {
    logDeepDive('info', 'Initializing deep dive experience');
    const visitorTableBody = document.getElementById('visitor-deep-dive-table-body');
    const accountTableBody = document.getElementById('account-deep-dive-table-body');

    if (!visitorTableBody || !accountTableBody) {
      return;
    }

    const messageRegion = ensureMessageRegion();
    const { updateText: updateProgress } = setupProgressTracker();
    const startButton = document.getElementById('deep-dive-start');

    const manualAppNames = loadManualAppNames();
    let metadataRecords = loadMetadataRecords(reportDeepDiveError);
    const deepDiveRecords = loadDeepDiveRecords();
    let hasSuccessfulScan = deepDiveRecords.some((record) => !record.error);
    const rows = [];
    const renderedRows = [];
    const getRenderedRows = () => renderedRows;
    const openAppNameModal = await setupManualAppNameModal(
      manualAppNames,
      rows,
      getRenderedRows,
      (appId, appName) => {
        metadataRecords = syncMetadataRecordsAppName(appId, appName, metadataRecords);
        syncDeepDiveRecordsAppName(appId, appName);
      },
    );
    const openRegexModal = await setupRegexFormatModal();

    let selectedLookback = TARGET_LOOKBACK;

    const updateExportAvailability = () => {
      setExportAvailability(hasSuccessfulScan && (rows.length > 0 || deepDiveRecords.length > 0));
    };

    const refreshTables = (lookback = selectedLookback) => {
      try {
        selectedLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;

        logDeepDive('info', 'Refreshing deep dive tables', {
          requestedLookback: lookback,
          selectedLookback,
        });

        const nextRows = applyManualAppNames(
          buildRowsForLookback(metadataRecords, selectedLookback),
          manualAppNames,
        );

        rows.splice(0, rows.length, ...nextRows);
        updateMetadataFieldHeaders(selectedLookback);

        renderedRows.length = 0;
        renderedRows.push(
          ...renderTable(
            visitorTableBody,
            rows,
            'visitor',
            openAppNameModal,
            openRegexModal,
            selectedLookback,
          ),
        );
        renderedRows.push(
          ...renderTable(
            accountTableBody,
            rows,
            'account',
            openAppNameModal,
            openRegexModal,
            selectedLookback,
          ),
        );

        logDeepDive('info', 'Updated deep dive tables', {
          selectedLookback,
          totalRows: rows.length,
          renderedRowCount: renderedRows.length,
        });

        updateExportAvailability();
        updateProgress(0, buildScanEntries(metadataRecords, manualAppNames, selectedLookback).length);
      } catch (error) {
        reportDeepDiveError('Unable to refresh deep dive tables.', error, messageRegion);
      }
    };

    selectedLookback = setupLookbackControls(refreshTables, selectedLookback);
    refreshTables(selectedLookback);

    if (startButton) {
      startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        startButton.textContent = 'Scanning…';
        showMessage(messageRegion, 'Starting deep dive scan…', 'info');

        try {
          await runDeepDiveScan(
            buildScanEntries(metadataRecords, manualAppNames, selectedLookback),
            selectedLookback,
            updateProgress,
            messageRegion,
            rows,
            () => {
              hasSuccessfulScan = true;
              updateExportAvailability();
            },
            updateExportAvailability,
          );
        } catch (error) {
          reportDeepDiveError(
            'Deep dive scan encountered an unexpected error. Please try again.',
            error,
            messageRegion,
          );
        } finally {
          startButton.disabled = false;
          startButton.textContent = 'Start scan';
        }
      });
    }
  } catch (error) {
    reportDeepDiveError(
      'Unable to initialize the deep dive experience. Please refresh and try again.',
      error,
    );
  }
};
