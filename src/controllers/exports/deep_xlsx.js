import {
  applyHeaderFormatting,
  downloadWorkbook,
  ensureWorkbookLibraries,
  logXlsx,
  openNamingModal,
  sanitizeFileName,
  sanitizeSheetName,
} from './excel_shared.js';
import { dedupeMetadataRecords, loadDeepDiveRecords, loadMetadataRecords } from '../../pages/deepDive/dataHelpers.js';
import { metadata_accounts, metadata_api_calls, metadata_visitors } from '../../pages/deepDive/aggregation.js';
import { reportDeepDiveError } from '../../pages/deepDive/ui/render.js';

const LOOKBACK_WINDOWS = [180, 30, 7];
const TOP_VALUE_LIMIT = 3;
const NULL_RATE_THRESHOLD = 0.2;
const MATCH_RATE_THRESHOLD = 0.8;

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
      console.warn('Invalid regex pattern encountered for format evaluation', error);
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
      totalValues: 0,
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
    totalValues: entry.total,
  };
};

const buildValueLookup = () => {
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

  metadata_visitors.forEach((visitorEntry) => {
    visitorEntry?.apps?.forEach((appEntry) => {
      appEntry?.metadataFields?.forEach((fieldEntry) => {
        fieldEntry?.values?.forEach((valueEntry) => {
          addValueCount('visitor', appEntry.appId, fieldEntry.field, valueEntry.value, valueEntry.count);
        });
      });
    });
  });

  metadata_accounts.forEach((accountEntry) => {
    addValueCount('account', accountEntry.appId, accountEntry.field, accountEntry.value, accountEntry.count);
  });

  return lookup;
};

const appendWorksheetFromRows = (workbook, rows, fallbackMessage, label, sheetNames, formatWorksheet) => {
  const worksheet = workbook.addWorksheet(sanitizeSheetName(label, sheetNames));

  if (!rows.length) {
    logXlsx('info', 'Building fallback deep-dive sheet because no rows were available', fallbackMessage);
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

  const maxRows = Math.min(3, worksheet.rowCount);
  for (let rowIndex = 1; rowIndex <= maxRows; rowIndex += 1) {
    const cell = worksheet.getRow(rowIndex).getCell(1);
    styleCell(cell);
  }

  logXlsx('debug', `Applied overview formatting to ${headerRow.cellCount + maxRows} cell(s)`);
};

const buildLookbackIndex = (records) => {
  const index = new Map();
  const totals = { visitor: { 180: 0, 30: 0, 7: 0 }, account: { 180: 0, 30: 0, 7: 0 } };
  const subIds = new Set();
  const appIds = new Set();
  const datasetCountsFromCalls = buildDatasetCountLookup(metadata_api_calls);
  const datasetTotals = new Map(datasetCountsFromCalls.totalsBySub);
  const datasetTotalsByApp = new Map(datasetCountsFromCalls.totalsByApp);
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

      datasetTotalsByApp.set(
        record.appId,
        (datasetTotalsByApp.get(record.appId) || 0) + datasetCountForTotals,
      );
      totalDatasets += datasetCountForTotals;
    }

    const appEntry = index.get(record.appId) || {
      appId: record.appId,
      appName: '',
      subId: record.subId || '',
      visitor: new Map(),
      account: new Map(),
    };

    appEntry.appName = record.appName || appEntry.appName;
    appEntry.subId = record.subId || appEntry.subId;

    const recordLookup = record?.type ? appEntry[record.type] : null;
    const key = record.fieldName || record.field;

    if (!recordLookup || !key) {
      index.set(record.appId, appEntry);
      return;
    }

    if (!recordLookup.has(key)) {
      recordLookup.set(key, new Map());
    }

    recordLookup.get(key).set(record.windowDays, record.count);
    index.set(record.appId, appEntry);
  });

  return {
    index,
    totals,
    distinctSubs: subIds.size,
    distinctApps: appIds.size,
    subIds: Array.from(subIds.values()),
    datasetTotals,
    datasetTotalsByApp,
    totalDatasets,
  };
};

const buildWorkbook = (formatSelections, metadataRecords) => {
  const workbook = new window.ExcelJS.Workbook();
  const sheetNames = new Set();
  const {
    index,
    totals,
    distinctSubs,
    distinctApps,
    subIds,
    datasetTotals,
    datasetTotalsByApp,
    totalDatasets,
  } = buildLookbackIndex(metadataRecords);
  const scannedSubIds = subIds.length ? subIds.join(', ') : 'No Sub IDs captured';
  const datasetsBySub =
    datasetTotals.size > 0
      ? Array.from(datasetTotals.entries())
          .sort(([first], [second]) => String(first || '').localeCompare(String(second || '')))
          .map(([subId, count]) => `${subId}: ${count}`)
          .join('; ')
      : 'No datasets tracked';
  const datasetsByApp =
    datasetTotalsByApp.size > 0
      ? Array.from(datasetTotalsByApp.entries())
          .map(([appId, count]) => {
            const lookup = index.get(appId);
            const appName = normalizeAppName(lookup?.appName || '');
            return `${appName ? `${appName} (${appId})` : appId}: ${count}`;
          })
          .sort((first, second) => String(first || '').localeCompare(String(second || '')))
          .join('; ')
      : 'No datasets tracked';
  const totalDatasetCount = totalDatasets || 0;
  const valueLookup = buildValueLookup();
  const aggregatedRows = [];

  const summaryRows = (subIds.length ? subIds : ['No Sub ID captured']).map((subId) => {
    const datasetsForSub = datasetTotals.get(subId) || 0;
    const resolvedSubId = subId || 'No Sub ID captured';
    const datasetsBySubLabel = datasetTotals.size > 0 ? `${resolvedSubId}: ${datasetsForSub}` : datasetsBySub;

    return {
      'Sub ID': resolvedSubId,
      'Distinct subs': distinctSubs,
      'Distinct apps': distinctApps,
      'Sub IDs scanned': scannedSubIds,
      'Datasets tracked': datasetTotals.size > 0 ? datasetsForSub : totalDatasetCount,
      'Datasets by sub': datasetsBySubLabel,
      'Datasets by app': datasetsByApp,
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
      const stats = getValueStats(selection, valueLookup);

      aggregatedRows.push({
        Type: selection.type === 'account' ? 'Account' : 'Visitor',
        'Sub ID': subId,
        App: appName || lookup?.appId || selection.appId,
        'App ID': selection.appId,
        'Metadata field': selection.fieldName,
        'Expected format': selection.format,
        'Regex pattern': selection.regexPattern,
        'Top values': stats.topValues,
        'Match rate': stats.matchRate === null ? 'N/A' : `${Math.round(stats.matchRate * 100)}%`,
        'Null/empty rate': `${Math.round(stats.nullRate * 100)}%`,
        'Needs review': stats.needsReview ? 'Yes' : 'No',
        '180 days': parseCount(counts[180]),
        '30 days': parseCount(counts[30]),
        '7 days': parseCount(counts[7]),
        'Total occurrences': parseCount(counts[180]) + parseCount(counts[30]) + parseCount(counts[7]),
      });

      return {
        Sub: subId,
        Field: selection.fieldName,
        'Expected format': selection.format,
        'Regex pattern': selection.regexPattern,
        Type: selection.type === 'account' ? 'Account' : 'Visitor',
        '180 days': parseCount(counts[180]),
        '30 days': parseCount(counts[30]),
        '7 days': parseCount(counts[7]),
        'Top values': stats.topValues,
        'Match rate': stats.matchRate === null ? 'N/A' : `${Math.round(stats.matchRate * 100)}%`,
        'Null/empty rate': `${Math.round(stats.nullRate * 100)}%`,
        'Needs review': stats.needsReview ? 'Yes' : 'No',
        'Total occurrences': parseCount(counts[180]) + parseCount(counts[30]) + parseCount(counts[7]),
      };
    });

    const sheetLabel = appName || appSelection.appId || 'app';

    appendWorksheetFromRows(
      workbook,
      rows,
      'No deep dive metadata was available for this app.',
      sheetLabel,
      sheetNames,
    );
  });

  const fieldAnalysisRows = aggregatedRows.sort(
    (first, second) => (parseCount(second['Total occurrences']) || 0) - (parseCount(first['Total occurrences']) || 0),
  );

  appendWorksheetFromRows(
    workbook,
    fieldAnalysisRows,
    'No field-level analytics were available to export.',
    'Field analysis',
    sheetNames,
  );

  return workbook;
};

export const exportDeepDiveXlsx = async () => {
  logXlsx('info', 'Starting deep-dive XLSX export flow');
  const visitorTable = document.getElementById('visitor-deep-dive-table');
  const accountTable = document.getElementById('account-deep-dive-table');
  const metadataRecords = dedupeMetadataRecords(
    loadMetadataRecords(),
    loadDeepDiveRecords(),
  );

  logXlsx('debug', 'Collected metadata records for export', {
    metadataRecords: metadataRecords.length,
    visitors: metadata_visitors.length,
    accounts: metadata_accounts.length,
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

  const workbook = buildWorkbook([...visitorSelections, ...accountSelections], metadataRecords);

  logXlsx('info', 'Deep-dive workbook assembled; starting download');

  await downloadWorkbook(workbook, desiredName || defaultFileName);
};
