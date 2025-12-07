import {
  applyHeaderFormatting,
  downloadWorkbook,
  ensureWorkbookLibraries,
  logXlsx,
  openNamingModal,
  sanitizeFileName,
  sanitizeSheetName,
} from './excel_shared.js';
import { buildDeepDiveExportState, snapshotDeepDiveCollection } from './deep_state.js';
import { reportDeepDiveError } from '../../pages/deepDive/ui/render.js';

const TOP_VALUE_LIMIT = 3;
const NULL_RATE_THRESHOLD = 0.2;
const MATCH_RATE_THRESHOLD = 0.8;
const LOOKBACK_WINDOWS = [180, 30, 7];

const buildDefaultFileName = (metadataRecords = []) => {
  const subId = metadataRecords.find((record) => record?.subId)?.subId || '';
  return sanitizeFileName(
    subId ? `${subId}_Metadata_Audit` : 'Metadata_Audit',
    'Metadata_Audit',
  );
};

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

const collectTableData = (table) => {
  const headerCells = Array.from(table?.querySelectorAll('thead th') || []);
  let headers = headerCells.map((th) => th.textContent.trim());

  let rows = Array.from(table?.querySelectorAll('tbody tr') || []).map((row) => {
    const cells = Array.from(row.querySelectorAll('td'));
    return cells.map((cell) => {
      const select = cell.querySelector('select');
      if (select) {
        const selected = select.options[select.selectedIndex];
        return selected?.value?.trim() || select.value || selected?.textContent?.trim() || '';
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

const parseCount = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const numeric = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(numeric) ? numeric : 0;
};

const isNullishValue = (value) => {
  if (value === null || value === undefined) {
    return true;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === '' || normalized === 'null' || normalized === 'undefined';
};

const buildDatasetCountLookup = (calls = []) => {
  const totalsBySub = new Map();
  const totalsByApp = new Map();
  let total = 0;

  calls.forEach((call) => {
    const datasetCount = parseCount(call?.datasetCount);

    if (datasetCount <= 0 || !call?.appId) {
      return;
    }

    totalsByApp.set(call.appId, (totalsByApp.get(call.appId) || 0) + datasetCount);

    if (call.subId) {
      totalsBySub.set(call.subId, (totalsBySub.get(call.subId) || 0) + datasetCount);
    }

    total += datasetCount;
  });

  return { totalsBySub, totalsByApp, total };
};

const getFormatEvaluator = (format, regexPattern) => {
  if (format === 'email') {
    return (value) => /[^@\s]+@[^@\s]+\.[^@\s]+/.test(String(value).trim());
  }

  if (format === 'number') {
    return (value) => Number.isFinite(Number(String(value).trim()));
  }

  if (format === 'text') {
    return (value) => !isNullishValue(value);
  }

  if (format === 'regex' && regexPattern) {
    try {
      const regex = new RegExp(regexPattern);
      return (value) => regex.test(String(value));
    } catch (error) {
      logXlsx('warn', 'Invalid regex pattern encountered for format evaluation', error);
      return null;
    }
  }

  return null;
};

const getValueStats = (selection, valueLookup) => {
  const key = `${selection.type}:${selection.appId}:${selection.fieldName}`;
  const entry = valueLookup.get(key);

  if (!entry) {
    return {
      topValues: 'No values captured',
      matchRate: null,
      nullRate: 0,
      needsReview: false,
      uniqueValues: 0,
      uniqueValueCount: 0,
    };
  }

  const sortedValues = Array.from(entry.counts.entries()).sort((first, second) => {
    if (second[1] === first[1]) {
      return String(first[0]).localeCompare(String(second[0]));
    }
    return second[1] - first[1];
  });
  const topValues = sortedValues
    .slice(0, TOP_VALUE_LIMIT)
    .map(([value, count]) => `${value} (${count})`)
    .join('; ');

  const evaluator = getFormatEvaluator(selection.format, selection.regexPattern);
  let matchRate = null;
  const uniqueValues = entry.counts.size;

  if (evaluator && entry.total) {
    const matches = sortedValues.reduce(
      (total, [value, count]) => total + (evaluator(value) ? parseCount(count) : 0),
      0,
    );
    matchRate = entry.total ? matches / entry.total : null;
  }

  const nullRate = entry.total ? entry.nullishCount / entry.total : 0;
  const mismatchConcern = matchRate !== null && matchRate < MATCH_RATE_THRESHOLD;
  const nullConcern = entry.total > 0 && nullRate >= NULL_RATE_THRESHOLD;
  const missingRegex = selection.format === 'regex' && !selection.regexPattern;

  return {
    topValues: topValues || 'No values captured',
    matchRate,
    nullRate,
    needsReview: mismatchConcern || nullConcern || missingRegex,
    uniqueValues,
    uniqueValueCount: uniqueValues,
  };
};

const buildValueLookup = (visitorData = [], accountData = []) => {
  const lookup = new Map();

  const addValueCount = (type, appId, field, rawValue, count = 0) => {
    if (!type || !appId || !field) {
      return;
    }

    const value = rawValue ?? '';
    const key = `${type}:${appId}:${field}`;
    const existing = lookup.get(key) || { total: 0, nullishCount: 0, counts: new Map() };
    const nextCount = parseCount(count);

    existing.total += nextCount;
    existing.nullishCount += isNullishValue(value) ? nextCount : 0;
    existing.counts.set(value, (existing.counts.get(value) || 0) + nextCount);

    lookup.set(key, existing);
  };

  visitorData.forEach((visitorEntry) => {
    visitorEntry?.apps?.forEach((appEntry) => {
      appEntry?.metadataFields?.forEach((fieldEntry) => {
        fieldEntry?.values?.forEach((valueEntry) => {
          addValueCount('visitor', appEntry.appId, fieldEntry.field, valueEntry.value, valueEntry.count);
        });
      });
    });
  });

  accountData.forEach((accountEntry) => {
    addValueCount('account', accountEntry.appId, accountEntry.field, accountEntry.value, accountEntry.count);
  });

  return lookup;
};

const appendWorksheetFromRows = (workbook, rows, fallbackMessage, label, sheetNames, formatWorksheet) => {
  const worksheet = workbook.addWorksheet(sanitizeSheetName(label, sheetNames));

  if (!rows.length) {
    logXlsx(
      'error',
      `No rows available for worksheet ${label}; generating fallback sheet to avoid blank export`,
      fallbackMessage,
    );
    worksheet.addRow(['Note']);
    worksheet.addRow([fallbackMessage]);
    applyHeaderFormatting(worksheet);
    if (typeof formatWorksheet === 'function') {
      formatWorksheet(worksheet);
    }
    return worksheet;
  }

  const headers = Object.keys(rows[0]);
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(headers.map((header) => row[header] ?? '')));

  applyHeaderFormatting(worksheet);
  if (typeof formatWorksheet === 'function') {
    formatWorksheet(worksheet);
  }

  logXlsx('debug', `Built worksheet ${label} with ${rows.length} row(s)`);
  return worksheet;
};

const applyOverviewFormatting = (worksheet) => {
  if (!worksheet) {
    logXlsx('warn', 'applyOverviewFormatting skipped because the overview worksheet is missing');
    return;
  }

  const headerRow = worksheet.getRow(1);
  if (!headerRow || headerRow.cellCount === 0) {
    logXlsx('warn', 'applyOverviewFormatting skipped because the header row is empty');
    return;
  }

  const styleCell = (cell) => {
    cell.font = {
      ...(cell.font || {}),
      bold: true,
      size: 16,
      color: { argb: 'FFFFFFFF' },
    };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE83E8C' },
    };
  };

  headerRow.eachCell(styleCell);

  const subIdColumn = worksheet.getColumn(1);
  if (subIdColumn) {
    subIdColumn.width = subIdColumn.width ? subIdColumn.width * 3 : 30;
  }

  logXlsx('debug', `Applied overview formatting to ${headerRow.cellCount} header cell(s)`);
};

const buildLookbackIndex = (records, metadataApiCalls = []) => {
  const index = new Map();
  const subIds = new Set();
  const appIds = new Set();
  const datasetCountsFromCalls = buildDatasetCountLookup(metadataApiCalls);
  const datasetTotals = new Map(datasetCountsFromCalls.totalsBySub);
  let totalDatasets = datasetCountsFromCalls.total;

  records.forEach((record) => {
    if (!record?.appId || !LOOKBACK_WINDOWS.includes(record.windowDays)) {
      return;
    }

    if (record.subId) {
      subIds.add(record.subId);
    }
    appIds.add(record.appId);

    const datasetCount = parseCount(
      record.datasetCount ?? record.dataset_total ?? record.dataset_count ?? record.datasets,
    );
    const datasetCountForTotals =
      datasetCount > 0 && !datasetCountsFromCalls.totalsByApp.has(record.appId) ? datasetCount : 0;

    if (datasetCountForTotals > 0) {
      if (record.subId) {
        datasetTotals.set(record.subId, (datasetTotals.get(record.subId) || 0) + datasetCountForTotals);
      }

      totalDatasets += datasetCountForTotals;
    }

    const appEntry = index.get(record.appId) || { appId: record.appId, appName: '', subId: '' };
    appEntry.appName = record.appName || appEntry.appName;
    appEntry.subId = record.subId || appEntry.subId;
    index.set(record.appId, appEntry);
  });

  return {
    index,
    distinctApps: appIds.size,
    subIds: Array.from(subIds.values()),
    datasetTotals,
    totalDatasets,
  };
};

const buildWorkbook = (
  formatSelections,
  metadataRecords,
  deepDiveRecords = [],
  valueLookupParam = buildValueLookup(),
  metadataApiCalls = [],
) => {
  const workbook = new window.ExcelJS.Workbook();
  const sheetNames = new Set();
  const { index, distinctApps, subIds, datasetTotals, totalDatasets } = buildLookbackIndex(
    metadataRecords,
    metadataApiCalls,
  );
  const totalDatasetCount = totalDatasets || 0;
  const valueLookup = valueLookupParam || new Map();
  const fieldAnalysisEntries = [];
  const appSheets = [];

  const summaryRows = (subIds.length ? subIds : ['No Sub ID captured']).map((subId) => {
    const datasetsForSub = datasetTotals.get(subId) || 0;
    const resolvedSubId = subId || 'No Sub ID captured';

    return {
      'Sub ID': resolvedSubId,
      Apps: distinctApps,
      'Records Scanned': datasetTotals.size > 0 ? datasetsForSub : totalDatasetCount,
    };
  });

  appendWorksheetFromRows(
    workbook,
    summaryRows,
    'No deep dive metadata was available to summarize.',
    'Overview',
    sheetNames,
    applyOverviewFormatting,
  );

  const statusByApp = new Map(
    deepDiveRecords
      .filter((record) => record?.appId)
      .map((record) => [record.appId, { status: record.status || 'unknown', error: record.error || '' }]),
  );

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

  if (groupedSelections.size === 0) {
    logXlsx('error', 'No grouped format selections found; no app worksheets will be generated.');
  }

  const hasValueDataForApp = (appId) => {
    if (!appId) {
      return false;
    }

    for (const [key, entry] of valueLookup.entries()) {
      if (key.split(':')[1] === appId && (entry?.total || entry?.counts?.size)) {
        return true;
      }
    }

    return false;
  };

  const describeCompleteness = (appId) => {
    const status = statusByApp.get(appId);
    const hasValues = hasValueDataForApp(appId);

    if (status?.status === 'success' && hasValues) {
      return { label: 'Complete', hasValues };
    }

    if (status?.status === 'success' && !hasValues) {
      return { label: 'Complete - no values captured', hasValues };
    }

    if (hasValues) {
      return { label: 'Partial - values captured without successful scan', hasValues };
    }

    return { label: 'Incomplete - no values captured', hasValues };
  };

  const incompleteApps = [];
  groupedSelections.forEach((appSelection) => {
    const lookup = index.get(appSelection.appId);
    const appName = normalizeAppName(lookup?.appName || appSelection.rows[0]?.appName || '');
    const subId = lookup?.subId || appSelection.rows[0]?.subId || '';

    const completeness = describeCompleteness(appSelection.appId);
    if (completeness.label !== 'Complete') {
      incompleteApps.push({
        appId: appSelection.appId,
        appName,
        subId,
        label: completeness.label,
        hasValues: completeness.hasValues,
        status: statusByApp.get(appSelection.appId) || null,
      });
    }

    const rows = appSelection.rows.map((selection) => {
      const stats = getValueStats(selection, valueLookup);
      fieldAnalysisEntries.push({
        row: {
          Type: selection.type === 'account' ? 'Account' : 'Visitor',
          'Sub ID': subId,
          App: appName || lookup?.appId || selection.appId,
          'App ID': selection.appId,
          'Metadata field': selection.fieldName,
          'Expected format': selection.format,
          'Regex pattern': selection.regexPattern,
          'Data completeness': completeness.label,
          'Top values': stats.topValues,
          'Unique values': stats.uniqueValueCount,
          'Match rate': stats.matchRate === null ? 'N/A' : `${Math.round(stats.matchRate * 100)}%`,
          'Null/empty rate': `${Math.round(stats.nullRate * 100)}%`,
          'Needs review': stats.needsReview ? 'Yes' : 'No',
        },
        uniqueValueCount: parseCount(stats.uniqueValueCount),
      });

      return {
        Sub: subId,
        Field: selection.fieldName,
        'Expected format': selection.format,
        'Regex pattern': selection.regexPattern,
        Type: selection.type === 'account' ? 'Account' : 'Visitor',
        'Data completeness': completeness.label,
        'Top values': stats.topValues,
        'Unique values': stats.uniqueValueCount,
        'Match rate': stats.matchRate === null ? 'N/A' : `${Math.round(stats.matchRate * 100)}%`,
        'Null/empty rate': `${Math.round(stats.nullRate * 100)}%`,
        'Needs review': stats.needsReview ? 'Yes' : 'No',
      };
    });

    const sheetLabel = appName || appSelection.appId || 'app';

    appSheets.push({
      rows,
      sheetLabel,
    });
  });

  const fieldAnalysisRows = fieldAnalysisEntries
    .sort((first, second) => (second.uniqueValueCount || 0) - (first.uniqueValueCount || 0))
    .map((entry) => entry.row);

  appendWorksheetFromRows(
    workbook,
    fieldAnalysisRows,
    'No field-level analytics were available to export.',
    'Field analysis',
    sheetNames,
  );

  appSheets.forEach(({ rows, sheetLabel }) => {
    appendWorksheetFromRows(
      workbook,
      rows,
      'No deep dive metadata was available for this app.',
      sheetLabel,
      sheetNames,
    );
  });

  return { workbook, incompleteApps };
};

export const exportDeepDiveXlsx = async () => {
  logXlsx('info', 'Starting deep-dive XLSX export flow');
  const visitorTable = document.getElementById('visitor-deep-dive-table');
  const accountTable = document.getElementById('account-deep-dive-table');
  const { deepDiveRecords, metadataRecords, visitors, accounts, apiCalls } =
    buildDeepDiveExportState();
  const visitorSnapshot = snapshotDeepDiveCollection(visitors);
  const accountSnapshot = snapshotDeepDiveCollection(accounts);

  logXlsx('debug', 'Collected metadata records for export', {
    metadataRecords: metadataRecords.length,
    visitors: visitorSnapshot.length,
    accounts: accountSnapshot.length,
  });

  const defaultFileName = buildDefaultFileName(metadataRecords);
  const desiredName = await openNamingModal(() => defaultFileName, (value) =>
    sanitizeFileName(value, defaultFileName),
  );
  if (desiredName === null) {
    logXlsx('info', 'Deep-dive XLSX export cancelled before workbook creation');
    return;
  }

  try {
    logXlsx('debug', 'Ensuring ExcelJS and FileSaver libraries are available');
    await ensureWorkbookLibraries();
  } catch (error) {
    reportDeepDiveError('Unable to load ExcelJS dependencies for export', error);
    return;
  }

  const visitorSelections = collectFormatSelections(visitorTable, 'visitor');
  const accountSelections = collectFormatSelections(accountTable, 'account');

  logXlsx('debug', 'Collected format selections from tables', {
    visitorSelections: visitorSelections.length,
    accountSelections: accountSelections.length,
  });

  let workbookResult;
  try {
    workbookResult = buildWorkbook(
      [...visitorSelections, ...accountSelections],
      metadataRecords,
      deepDiveRecords,
      buildValueLookup(visitorSnapshot, accountSnapshot),
      apiCalls,
    );
  } catch (error) {
    reportDeepDiveError('Unable to build deep-dive workbook', error);
    return;
  }

  const { workbook, incompleteApps = [] } = workbookResult || {};

  if (!workbook) {
    reportDeepDiveError('Deep-dive workbook could not be created. Please try again.', null);
    return;
  }

  if (incompleteApps.length > 0) {
    const incompleteSummary = incompleteApps
      .map((app) => {
        const name = app.appName || app.appId || 'Unknown app';
        const valueNote = app.hasValues ? 'values present' : 'no values captured';
        const statusNote = app.status?.status ? `status: ${app.status.status}` : 'status unknown';
        const errorNote = app.status?.error ? `error: ${app.status.error}` : null;
        return [name, `(subId: ${app.subId || 'N/A'})`, app.label, statusNote, valueNote, errorNote]
          .filter(Boolean)
          .join(' - ');
      })
      .join('; ');

    const message = `Some apps did not complete scanning but were included in the export: ${incompleteSummary}`;
    logXlsx('warn', message, { incompleteApps });

    const processingProgressText = document.getElementById('deep-dive-processing-progress');
    if (processingProgressText) {
      processingProgressText.textContent = message;
      processingProgressText.setAttribute('role', 'alert');
    }
  }

  logXlsx('info', 'Deep-dive workbook assembled; starting download');

  await downloadWorkbook(workbook, desiredName || defaultFileName);
};
