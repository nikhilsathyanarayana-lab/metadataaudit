import { getMetadataFieldRecords, waitForMetadataFields } from '../../pages/metadataFields.js';
import { calculateAlignmentStats } from '../../services/alignmentStats.js';
import {
  applyHeaderFormatting,
  downloadWorkbook,
  ensurePageDocument,
  ensureWorkbookLibraries,
  logXlsx,
  openNamingModal,
  sanitizeFileName,
  sanitizeSheetName,
} from './excel_shared.js';
import { createExportStatusHelper } from './export_status.js';

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

// Generates a date-stamped default file name for metadata exports.
const buildDefaultFileName = () => {
  const today = new Date();
  const dateStamp = today.toISOString().slice(0, 10);
  return `metadata_fields-${dateStamp}`;
};

// Normalizes a cell value from text or dropdown selections for XLSX output.
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

// Converts a metadata table into an array-of-arrays structure for worksheet hydration.
const collectTableAoA = (table, appNameLookup = new Map()) => {
  if (!table) {
    return null;
  }

  const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
  const rows = Array.from(table.querySelectorAll('tbody tr')).map((row) => {
    const cells = Array.from(row.querySelectorAll('td')).map(extractCellValue);

    const appIdIndex = headers.indexOf('App ID');
    const appNameIndex = headers.indexOf('App Name');

    if (appIdIndex >= 0 && appNameIndex >= 0) {
      const appId = cells[appIdIndex];
      const preferredName = appNameLookup.get(appId);

      if (preferredName) {
        cells[appNameIndex] = preferredName;
      }
    }

    return cells;
  });

  return [headers, ...rows];
};

// Adds a worksheet to the export workbook from a metadata table, handling empty states gracefully.
const appendTableSheet = (workbook, table, label, sheetNames, appNameLookup) => {
  const aoa = collectTableAoA(table, appNameLookup);
  const worksheet = workbook.addWorksheet(sanitizeSheetName(label, sheetNames));

  if (!aoa || !aoa.length || !aoa[0]?.length) {
    worksheet.addRow(['Note']);
    worksheet.addRow([`${label} data was not available to export.`]);
    applyHeaderFormatting(worksheet);
    worksheet.metadataColumnCount = worksheet.columnCount || 1;
    return worksheet;
  }

  aoa.forEach((row) => worksheet.addRow(row));
  applyHeaderFormatting(worksheet);
  worksheet.metadataColumnCount = aoa?.[0]?.length || worksheet.columnCount || 1;
  return worksheet;
};

const normalizeFieldSet = (fields = []) => {
  const result = new Set();
  fields.forEach((field) => {
    if (typeof field === 'string' || typeof field === 'number') {
      const normalized = String(field).trim();
      if (normalized) {
        result.add(normalized);
      }
    }
  });
  return result;
};

const buildCombinedFieldSet = (record = {}) => {
  const combined = new Set();
  const addFields = (fields) => normalizeFieldSet(fields).forEach((field) => combined.add(field));

  addFields(record.visitorFields || record.visitorMetadata);
  addFields(record.accountFields || record.accountMetadata);

  return combined;
};

const buildRecordLookup = (records = []) => {
  const lookup = new Map();
  records.forEach((record) => {
    if (record?.appId) {
      lookup.set(record.appId, record);
    }
  });
  return lookup;
};

const buildTimeframeChanges = (timeframeRecords = []) => {
  const timeframes = timeframeRecords
    .map(({ label, windowDays, records = [] }) => ({
      label,
      windowDays,
      records,
      lookup: buildRecordLookup(records),
    }))
    .filter((frame) => Number.isFinite(frame.windowDays));

  const changes = [];

  const appIds = new Set();
  timeframes.forEach(({ records }) => {
    records.forEach((record) => {
      if (record?.appId) {
        appIds.add(record.appId);
      }
    });
  });

  appIds.forEach((appId) => {
    const frameDetails = timeframes.map((frame) => {
      const record = frame.lookup.get(appId);
      return {
        ...frame,
        record,
        fields: buildCombinedFieldSet(record),
        appName: record?.appName,
      };
    });

    const appName = frameDetails.find((frame) => frame.appName)?.appName || appId;

    frameDetails.forEach((sourceFrame) => {
      frameDetails.forEach((targetFrame) => {
        if (
          sourceFrame.windowDays === targetFrame.windowDays ||
          !sourceFrame.record ||
          !targetFrame.record
        ) {
          return;
        }

        sourceFrame.fields.forEach((field) => {
          if (!targetFrame.fields.has(field)) {
            changes.push({
              field,
              appId,
              appName,
              note: `${field} was not found in the ${targetFrame.label} window but was found in the ${sourceFrame.label} window for ${appName}`,
            });
          }
        });
      });
    });
  });

  return changes;
};

const formatMergedTitleRow = (worksheet, row, columnCount = 1) => {
  if (!worksheet || !row) {
    logXlsx('warn', 'formatMergedTitleRow skipped because worksheet or row is missing');
    return;
  }

  const lastColumn = Math.max(1, columnCount);
  worksheet.mergeCells(row.number, 1, row.number, lastColumn);

  const titleCell = row.getCell(1);
  titleCell.font = { ...(titleCell.font || {}), ...TITLE_STYLE.font };
  titleCell.fill = TITLE_STYLE.fill;
  titleCell.alignment = TITLE_STYLE.alignment;
};

const addOverviewSheet = (workbook, { visitorAlignment, accountAlignment, timeframeChanges }, sheetNames) => {
  const worksheet = workbook.addWorksheet(sanitizeSheetName('Overview', sheetNames));

  const alignmentTitle = worksheet.addRow(['Apps with aligned metadata (7 days)']);
  formatMergedTitleRow(worksheet, alignmentTitle, 5);

  if (visitorAlignment?.totalApps || accountAlignment?.totalApps) {
    const header = worksheet.addRow(['Category', 'Aligned', 'Misaligned', 'Total Apps', 'Aligned %']);
    header.font = { bold: true };

    const addStatsRow = (label, stats) => {
      const aligned = stats?.alignedCount ?? 'N/A';
      const misaligned = stats?.misalignedCount ?? 'N/A';
      const total = stats?.totalApps ?? 'N/A';
      const percentage = stats?.alignedPercentage ?? 'N/A';
      worksheet.addRow([label, aligned, misaligned, total, percentage]);
    };

    addStatsRow('Visitor', visitorAlignment);
    addStatsRow('Account', accountAlignment);
  } else {
    worksheet.addRow(['Alignment data unavailable for export.']);
  }

  worksheet.addRow([]);
  const changesTitle = worksheet.addRow(['Metadata changes by timeframe']);
  formatMergedTitleRow(worksheet, changesTitle, 4);

  if (timeframeChanges.length) {
    const changeHeader = worksheet.addRow(['Field', 'App Name', 'App ID', 'Note']);
    changeHeader.font = { bold: true };
    timeframeChanges.forEach(({ field, appName, appId, note }) => {
      worksheet.addRow([field, appName || appId || 'Unknown App', appId || 'Unknown App ID', note]);
    });
  } else {
    worksheet.addRow(['No field differences detected across available timeframes.']);
  }

  return worksheet;
};

// Orchestrates the metadata XLSX export flow from modal prompt to download delivery.
export const exportMetadataXlsx = async () => {
  const desiredName = await openNamingModal(buildDefaultFileName, (value) =>
    sanitizeFileName(value, buildDefaultFileName()),
  );
  if (desiredName === null) {
    return;
  }

  const { setStatus, restore } = createExportStatusHelper();

  try {
    setStatus('Preparing XLSX export…', { pending: true });
    await ensureWorkbookLibraries();

    setStatus('Loading available metadata for export…', { pending: true });
    waitForMetadataFields().catch((error) =>
      logXlsx('error', 'Metadata fields may not finish loading before export completes.', error),
    );

    setStatus('Building XLSX workbook…', { pending: true });
    const metadataDoc = await ensurePageDocument('metadata_fields.html');
    const visitorTable = metadataDoc?.getElementById('visitor-metadata-table');
    const accountTable = metadataDoc?.getElementById('account-metadata-table');

    const workbook = new window.ExcelJS.Workbook();
    const sheetNames = new Set();

    const sevenDayRecords = getMetadataFieldRecords(7);
    const thirtyDayRecords = getMetadataFieldRecords(30);
    const oneEightyDayRecords = getMetadataFieldRecords(180);
    const visitorAlignment = calculateAlignmentStats(sevenDayRecords, {
      fieldKey: 'visitorFields',
      windowDays: 7,
    });
    const accountAlignment = calculateAlignmentStats(sevenDayRecords, {
      fieldKey: 'accountFields',
      windowDays: 7,
    });
    const timeframeChanges = buildTimeframeChanges([
      { label: '7 day', windowDays: 7, records: sevenDayRecords },
      { label: '30 day', windowDays: 30, records: thirtyDayRecords },
      { label: '180 day', windowDays: 180, records: oneEightyDayRecords },
    ]);

    addOverviewSheet(
      workbook,
      { visitorAlignment, accountAlignment, timeframeChanges },
      sheetNames,
    );

    const appNameLookup = new Map();
    [sevenDayRecords, thirtyDayRecords, oneEightyDayRecords]
      .flat()
      .forEach((record) => {
        if (record?.appId && record?.appName) {
          appNameLookup.set(record.appId, record.appName);
        }
      });

    const visitorSheet = appendTableSheet(workbook, visitorTable, 'Visitor', sheetNames, appNameLookup);
    const accountSheet = appendTableSheet(workbook, accountTable, 'Account', sheetNames, appNameLookup);

    await downloadWorkbook(workbook, desiredName || buildDefaultFileName());
    setStatus('Export ready. Your XLSX download should start shortly.', { pending: false });
  } catch (error) {
    logXlsx('error', 'Unable to export metadata XLSX.', error);
    setStatus('Unable to export metadata to XLSX. Please try again.', {
      pending: false,
      tone: 'error',
    });
  } finally {
    setTimeout(() => restore(), 1500);
  }
};
