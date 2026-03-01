import { tableData } from '../3.js';
import { getSubscriptionDisplay } from '../subscriptionLabels.js';
import { ensureWorkbookLibraries } from '../../../src/controllers/exports/excel_shared.js';

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

const TITLE_STYLE = {
  font: {
    bold: true,
    size: 18,
    color: { argb: 'FFFFFFFF' },
  },
  fill: {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE83E8C' },
  },
  alignment: { horizontal: 'center', vertical: 'middle' },
};

const OVERVIEW_TITLE_COLUMN_SPAN = 8;


const METADATA_STATUS_PENDING = 'Pending...';

// Tag worksheet rows with preview roles used by the SPA workbook renderer.
const markPreviewRowRole = (worksheet, rowNumber, role) => {
  if (!worksheet || !rowNumber || !role) {
    return;
  }

  if (!worksheet.previewRowRoles) {
    worksheet.previewRowRoles = {};
  }

  worksheet.previewRowRoles[rowNumber] = role;
};

// Resolve a SubID display value using injected labels first, then shared in-memory labels.
const getSubIdDisplay = (subId, labelLookup) => {
  const rawSubId = String(subId || '');

  if (labelLookup instanceof Map) {
    return labelLookup.get(rawSubId) || getSubscriptionDisplay(rawSubId) || rawSubId;
  }

  if (labelLookup && typeof labelLookup === 'object') {
    return labelLookup[rawSubId] || getSubscriptionDisplay(rawSubId) || rawSubId;
  }

  return getSubscriptionDisplay(rawSubId) || rawSubId;
};

// Build a date-stamped default workbook name for SPA exports.
export const buildSpaDefaultFileName = () => {
  const today = new Date();
  return `metadata_fields-${today.toISOString().slice(0, 10)}`;
};

// Keep worksheet names valid and unique for workbook output.
const sanitizeSheetName = (name, existingNames = new Set()) => {
  const cleaned = (name || 'Sheet').replace(/[\[\]\*\?:\\\/]/g, '').slice(0, 31) || 'Sheet';
  let candidate = cleaned;
  let suffix = 1;

  while (existingNames.has(candidate)) {
    candidate = `${cleaned.slice(0, 28)}-${suffix}`.slice(0, 31);
    suffix += 1;
  }

  existingNames.add(candidate);
  return candidate;
};

// Apply the shared pink header style to the first row of a worksheet.
const applyHeaderFormatting = (worksheet) => {
  const headerRow = worksheet?.getRow(1);

  if (!headerRow || headerRow.cellCount === 0) {
    return;
  }

  headerRow.eachCell((cell) => {
    cell.font = { ...(cell.font || {}), ...HEADER_STYLE.font };
    cell.fill = HEADER_STYLE.fill;
  });
};

// Convert a 1-indexed column number into an Excel column letter.
const columnNumberToLetter = (columnNumber) => {
  let dividend = Math.max(1, columnNumber);
  let columnName = '';

  while (dividend > 0) {
    const modulo = (dividend - 1) % 26;
    columnName = String.fromCharCode(65 + modulo) + columnName;
    dividend = Math.floor((dividend - modulo) / 26);
  }

  return columnName;
};

// Render a bold merged title row in the overview worksheet.
const formatMergedTitleRow = (worksheet, row, columnCount = 1) => {
  const lastColumnLetter = columnNumberToLetter(Math.max(1, columnCount));
  const mergeRange = `A${row.number}:${lastColumnLetter}${row.number}`;

  worksheet.mergeCells(mergeRange);
  const titleCell = row.getCell(1);
  titleCell.font = { ...(titleCell.font || {}), ...TITLE_STYLE.font };
  titleCell.fill = TITLE_STYLE.fill;
  titleCell.alignment = TITLE_STYLE.alignment;
  worksheet.getCell(mergeRange.split(':')[1]).alignment = TITLE_STYLE.alignment;
  row.height = 24;
};

// Normalize any field list into a deduplicated sorted array.
const normalizeFields = (fields) => {
  const validFields = Array.isArray(fields)
    ? fields.filter((field) => typeof field === 'string' && field.trim())
    : [];

  return [...new Set(validFields)].sort((first, second) => first.localeCompare(second));
};

// Build alignment counts for one namespace from seven-day field snapshots.
const calculateAlignmentStats = (rows = []) => {
  const signatures = new Map();

  rows.forEach((row) => {
    const signature = normalizeFields(row?.window7).join('||');
    const stats = signatures.get(signature) || { count: 0 };
    signatures.set(signature, { count: stats.count + 1 });
  });

  const totalApps = rows.length;
  const alignedCount = Math.max(0, ...Array.from(signatures.values()).map((value) => value.count));
  const misalignedCount = Math.max(0, totalApps - alignedCount);
  const alignedPercentage = totalApps ? Math.round((alignedCount / totalApps) * 100) : 0;

  return { alignedCount, misalignedCount, alignedPercentage, totalApps };
};

// Convert cached window values into readable worksheet cell text.
const formatWindowValue = (value) => {
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : 'No Data';
  }

  if (value === null) {
    return 'No Data';
  }

  return value || METADATA_STATUS_PENDING;
};

// Resolve app display names from metadata aggregation caches when available.
const buildAggregationAppNameLookup = () => {
  const lookup = new Map();
  const aggregations = (typeof window !== 'undefined' && window.metadataAggregations)
    ? window.metadataAggregations
    : {};

  Object.values(aggregations).forEach((subBucket) => {
    Object.values(subBucket?.apps || {}).forEach((appBucket) => {
      if (appBucket?.appId && appBucket?.appName) {
        lookup.set(String(appBucket.appId), appBucket.appName);
      }
    });
  });

  return lookup;
};

// Add one worksheet for a namespace table using SPA table cache rows.
const appendNamespaceSheet = (workbook, namespace, sheetNames, appNameLookup, subIdLabelLookup) => {
  const worksheet = workbook.addWorksheet(sanitizeSheetName(namespace, sheetNames));
  const rows = tableData.filter((entry) => entry?.namespace === namespace.toLowerCase());
  const header = ['SubID', 'App Name', 'App ID', '7 Day', '30 Day', '180 Day'];

  worksheet.addRow(header);
  markPreviewRowRole(worksheet, 1, 'header');

  if (!rows.length) {
    worksheet.addRow(['No metadata rows available for this namespace.']);
    applyHeaderFormatting(worksheet);
    worksheet.metadataColumnCount = header.length;
    return;
  }

  rows.forEach((entry) => {
    const appId = String(entry?.appId || '');
    const appName = appNameLookup.get(appId) || entry?.appName || appId || 'Unknown app';

    worksheet.addRow([
      getSubIdDisplay(entry?.subId, subIdLabelLookup) || 'Unknown SubID',
      appName,
      appId,
      formatWindowValue(entry?.window7),
      formatWindowValue(entry?.window30),
      formatWindowValue(entry?.window180),
    ]);
  });

  applyHeaderFormatting(worksheet);
  worksheet.metadataColumnCount = header.length;
};

// Build a per-app summary map for visitor/account fields by export window.
const buildAppWindowSummary = () => {
  const summary = new Map();

  tableData
    .filter((entry) => ['visitor', 'account'].includes(entry?.namespace))
    .forEach((entry) => {
      const key = `${entry?.subId || ''}::${entry?.appId || ''}`;
      const existing = summary.get(key) || {
        subId: entry?.subId || '',
        appId: entry?.appId || '',
        appName: entry?.appName || entry?.appId || 'Unknown app',
        window7: new Set(),
        window30: new Set(),
        window180: new Set(),
      };

      normalizeFields(entry?.window7).forEach((field) => existing.window7.add(field));
      normalizeFields(entry?.window30).forEach((field) => existing.window30.add(field));
      normalizeFields(entry?.window180).forEach((field) => existing.window180.add(field));
      summary.set(key, existing);
    });

  return summary;
};

// Add one worksheet per app with a simple title row for future app-level export details.
const appendApplicationSheets = (workbook, sheetNames, subIdLabelLookup) => {
  const appSummary = buildAppWindowSummary();

  appSummary.forEach((summary) => {
    const subIdDisplay = getSubIdDisplay(summary?.subId, subIdLabelLookup) || 'Unknown SubID';
    const appName = summary?.appName || summary?.appId || 'Unknown app';
    const worksheetName = sanitizeSheetName(`${appName} (${subIdDisplay})`, sheetNames);
    const worksheet = workbook.addWorksheet(worksheetName);
    const titleRow = worksheet.addRow([appName]);
    const titleCell = titleRow.getCell(1);

    titleCell.font = { ...(titleCell.font || {}), ...TITLE_STYLE.font };
    markPreviewRowRole(worksheet, titleRow.number, 'title');
    worksheet.metadataColumnCount = 1;
  });
};

// Compare field sets across windows to list missing fields in each timeframe.
const buildTimeframeChanges = (appSummary = new Map(), subIdLabelLookup) => {
  const frames = [
    { key: 'window7', label: '7 day' },
    { key: 'window30', label: '30 day' },
    { key: 'window180', label: '180 day' },
  ];
  const changes = [];

  appSummary.forEach((summary) => {
    frames.forEach((sourceFrame) => {
      frames.forEach((targetFrame) => {
        if (sourceFrame.key === targetFrame.key) {
          return;
        }

        const sourceFields = summary[sourceFrame.key] || new Set();
        const targetFields = summary[targetFrame.key] || new Set();

        if (!sourceFields.size || !targetFields.size) {
          return;
        }

        sourceFields.forEach((field) => {
          if (!targetFields.has(field)) {
            const subIdDisplay = getSubIdDisplay(summary.subId, subIdLabelLookup) || 'Unknown SubID';

            changes.push({
              field,
              subIdDisplay,
              appId: summary.appId,
              appName: summary.appName,
              note: `${field} was not found in the ${targetFrame.label} window but was found in the ${sourceFrame.label} window for ${summary.appName} (${subIdDisplay})`,
            });
          }
        });
      });
    });
  });

  return changes;
};

// Add the overview worksheet using SPA table snapshots for alignment and timeframe changes.
const appendOverviewSheet = (workbook, sheetNames, subIdLabelLookup) => {
  const worksheet = workbook.addWorksheet(sanitizeSheetName('Overview', sheetNames));
  const visitorRows = tableData.filter((entry) => entry?.namespace === 'visitor');
  const accountRows = tableData.filter((entry) => entry?.namespace === 'account');
  const visitorAlignment = calculateAlignmentStats(visitorRows);
  const accountAlignment = calculateAlignmentStats(accountRows);
  const timeframeChanges = buildTimeframeChanges(buildAppWindowSummary(), subIdLabelLookup);

  const alignmentTitle = worksheet.addRow(['Apps with aligned metadata (7 days)']);
  markPreviewRowRole(worksheet, alignmentTitle.number, 'title');
  formatMergedTitleRow(worksheet, alignmentTitle, OVERVIEW_TITLE_COLUMN_SPAN);

  const header = worksheet.addRow(['Category', 'Aligned', 'Misaligned', 'Total Apps', 'Aligned %']);
  header.font = { bold: true };
  markPreviewRowRole(worksheet, header.number, 'header');
  worksheet.addRow([
    'Visitor',
    visitorAlignment.alignedCount,
    visitorAlignment.misalignedCount,
    visitorAlignment.totalApps,
    visitorAlignment.alignedPercentage,
  ]);
  worksheet.addRow([
    'Account',
    accountAlignment.alignedCount,
    accountAlignment.misalignedCount,
    accountAlignment.totalApps,
    accountAlignment.alignedPercentage,
  ]);

  worksheet.addRow([]);
  const changesTitle = worksheet.addRow(['Metadata changes by timeframe']);
  markPreviewRowRole(worksheet, changesTitle.number, 'title');
  formatMergedTitleRow(worksheet, changesTitle, OVERVIEW_TITLE_COLUMN_SPAN);

  if (!timeframeChanges.length) {
    worksheet.addRow(['No field differences detected across available timeframes.']);
    worksheet.metadataColumnCount = OVERVIEW_TITLE_COLUMN_SPAN;
    return;
  }

  const changeHeader = worksheet.addRow(['Field', 'SubID', 'App Name', 'App ID', 'Note']);
  changeHeader.font = { bold: true };
  markPreviewRowRole(worksheet, changeHeader.number, 'header');
  timeframeChanges.forEach((change) => {
    worksheet.addRow([
      change.field,
      change.subIdDisplay,
      change.appName || change.appId || 'Unknown app',
      change.appId || '',
      change.note,
    ]);
  });

  worksheet.metadataColumnCount = OVERVIEW_TITLE_COLUMN_SPAN;
};

// Build the SPA workbook using in-memory table data and metadata aggregation caches.
export const buildSpaMetadataWorkbook = async ({ subIdLabels } = {}) => {
  await ensureWorkbookLibraries();

  const workbook = new window.ExcelJS.Workbook();
  const sheetNames = new Set();
  const appNameLookup = buildAggregationAppNameLookup();

  appendOverviewSheet(workbook, sheetNames, subIdLabels);
  appendNamespaceSheet(workbook, 'Visitor', sheetNames, appNameLookup, subIdLabels);
  appendNamespaceSheet(workbook, 'Account', sheetNames, appNameLookup, subIdLabels);
  appendApplicationSheets(workbook, sheetNames, subIdLabels);

  return {
    workbook,
    defaultFileName: buildSpaDefaultFileName(),
  };
};
