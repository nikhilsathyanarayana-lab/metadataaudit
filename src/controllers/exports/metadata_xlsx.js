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
import { ensureMessageRegion, renderRegionBanner } from '../../ui/statusBanner.js';
import { renderPendingQueueBanner } from '../../ui/pendingQueueBanner.js';

// Captures the export banner elements and helpers for updating status messaging.
const getExportUi = () => {
  const statusRegion = ensureMessageRegion('page-status-banner', { beforeSelector: 'header.page-header' });
  const exportButton = document.getElementById('export-button');
  const previousButtonDisabled = exportButton?.disabled ?? false;

  const setStatus = (message, { tone = 'info', pending = false } = {}) => {
    if (statusRegion) {
      statusRegion.setAttribute('aria-busy', String(pending));
    }

    renderRegionBanner(statusRegion, message, tone, { ariaLive: tone === 'error' ? 'assertive' : 'polite' });

    if (exportButton) {
      exportButton.disabled = pending;
      exportButton.setAttribute('aria-disabled', String(pending));
      exportButton.setAttribute('aria-busy', String(pending));
    }
  };

  const restore = () => {
    renderPendingQueueBanner({ regionId: 'page-status-banner', beforeSelector: 'header.page-header' });
    statusRegion?.removeAttribute('aria-busy');

    if (exportButton) {
      exportButton.disabled = previousButtonDisabled;
      exportButton.setAttribute('aria-disabled', String(previousButtonDisabled));
      exportButton.removeAttribute('aria-busy');
    }
  };

  return { setStatus, restore };
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

// Adds a worksheet to the export workbook from a metadata table, handling empty states gracefully.
const appendTableSheet = (workbook, table, label, sheetNames) => {
  const aoa = collectTableAoA(table);
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

const buildTimeframeChanges = (sevenDayRecords = [], thirtyDayRecords = []) => {
  const sevenLookup = buildRecordLookup(sevenDayRecords);
  const thirtyLookup = buildRecordLookup(thirtyDayRecords);
  const changes = [];

  const appIds = new Set([
    ...sevenDayRecords.map((record) => record?.appId).filter(Boolean),
    ...thirtyDayRecords.map((record) => record?.appId).filter(Boolean),
  ]);

  appIds.forEach((appId) => {
    const sevenRecord = sevenLookup.get(appId);
    const thirtyRecord = thirtyLookup.get(appId);
    const appName = sevenRecord?.appName || thirtyRecord?.appName || appId;
    const sevenFields = buildCombinedFieldSet(sevenRecord);
    const thirtyFields = buildCombinedFieldSet(thirtyRecord);

    thirtyFields.forEach((field) => {
      if (!sevenFields.has(field)) {
        changes.push({
          field,
          appId,
          appName,
          note: `${field} was not found in the 7 day window but was found in the 30 day window for ${appName}`,
        });
      }
    });

    sevenFields.forEach((field) => {
      if (!thirtyFields.has(field)) {
        changes.push({
          field,
          appId,
          appName,
          note: `${field} was not found in the 30 day window but was found in the 7 day window for ${appName}`,
        });
      }
    });
  });

  return changes;
};

const addOverviewSheet = (workbook, { visitorAlignment, accountAlignment, timeframeChanges }, sheetNames) => {
  const worksheet = workbook.addWorksheet(sanitizeSheetName('Overview', sheetNames));

  const alignmentTitle = worksheet.addRow(['Apps with aligned metadata (7 days)']);
  alignmentTitle.font = { bold: true, size: 14 };

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
  changesTitle.font = { bold: true, size: 14 };

  if (timeframeChanges.length) {
    const changeHeader = worksheet.addRow(['Field', 'App Name', 'App ID', 'Note']);
    changeHeader.font = { bold: true };
    timeframeChanges.forEach(({ field, appName, appId, note }) => {
      worksheet.addRow([field, appName || appId || 'Unknown App', appId || 'Unknown App ID', note]);
    });
  } else {
    worksheet.addRow(['No field differences detected between 7 day and 30 day windows.']);
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

  const { setStatus, restore } = getExportUi();

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
    const visitorAlignment = calculateAlignmentStats(sevenDayRecords, {
      fieldKey: 'visitorFields',
      windowDays: 7,
    });
    const accountAlignment = calculateAlignmentStats(sevenDayRecords, {
      fieldKey: 'accountFields',
      windowDays: 7,
    });
    const timeframeChanges = buildTimeframeChanges(sevenDayRecords, thirtyDayRecords);

    addOverviewSheet(
      workbook,
      { visitorAlignment, accountAlignment, timeframeChanges },
      sheetNames,
    );

    const visitorSheet = appendTableSheet(workbook, visitorTable, 'Visitor', sheetNames);
    const accountSheet = appendTableSheet(workbook, accountTable, 'Account', sheetNames);

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
