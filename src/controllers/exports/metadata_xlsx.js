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

// Captures the export banner elements and helpers for updating status messaging.
const getExportUi = () => {
  const progressBanner = document.getElementById('metadata-fields-progress');
  const progressText = document.getElementById('metadata-fields-progress-text');
  const exportButton = document.getElementById('export-button');
  const exportMarker = `export-${Date.now()}`;
  let lastMessage = '';

  const previousText = progressText?.textContent;
  const previousBannerBusy = progressBanner?.getAttribute('aria-busy');
  const previousButtonDisabled = exportButton?.disabled ?? false;

  const setStatus = (message, { tone = 'info', pending = false } = {}) => {
    if (progressText && message) {
      progressText.textContent = message;
      progressText.dataset.exportStatus = exportMarker;
      lastMessage = message;
    }

    if (progressBanner) {
      if (pending) {
        progressBanner.setAttribute('aria-busy', 'true');
      } else {
        progressBanner.removeAttribute('aria-busy');
      }

      progressBanner.classList.toggle('is-error', tone === 'error');
    }

    if (exportButton) {
      exportButton.disabled = pending;
      exportButton.setAttribute('aria-disabled', String(pending));
      exportButton.setAttribute('aria-busy', String(pending));
    }
  };

  const restore = () => {
    if (progressText?.dataset?.exportStatus !== exportMarker) {
      return;
    }

    if (progressText && typeof previousText === 'string' && progressText.textContent === lastMessage) {
      progressText.textContent = previousText;
      delete progressText.dataset.exportStatus;
    }

    if (progressBanner) {
      if (previousBannerBusy) {
        progressBanner.setAttribute('aria-busy', previousBannerBusy);
      } else {
        progressBanner.removeAttribute('aria-busy');
      }

      progressBanner.classList.remove('is-error');
    }

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

const normalizePercentage = (numerator, denominator) => {
  if (!denominator) {
    return 0;
  }

  const raw = Math.round((numerator / denominator) * 100);
  return Math.max(0, Math.min(100, raw));
};

const buildPieChart = (alignedCount, misalignedCount, title) => {
  const total = alignedCount + misalignedCount;
  const canvas = document.createElement('canvas');
  canvas.width = 340;
  canvas.height = 220;
  const context = canvas.getContext('2d');

  if (!context || !total) {
    return null;
  }

  const normalizedAligned = Math.max(0, alignedCount);
  const normalizedMisaligned = Math.max(0, misalignedCount);
  const startAngle = -Math.PI / 2;
  const alignedAngle = (normalizedAligned / total) * Math.PI * 2;

  context.fillStyle = '#198754';
  context.beginPath();
  context.moveTo(canvas.width / 2, canvas.height / 2);
  context.arc(canvas.width / 2, canvas.height / 2, 80, startAngle, startAngle + alignedAngle);
  context.closePath();
  context.fill();

  context.fillStyle = '#dc3545';
  context.beginPath();
  context.moveTo(canvas.width / 2, canvas.height / 2);
  context.arc(
    canvas.width / 2,
    canvas.height / 2,
    80,
    startAngle + alignedAngle,
    startAngle + Math.PI * 2,
  );
  context.closePath();
  context.fill();

  context.fillStyle = '#111827';
  context.font = '16px Arial';
  context.textAlign = 'center';
  context.fillText(title, canvas.width / 2, 30);

  const alignedLabel = `${normalizePercentage(normalizedAligned, total)}% aligned`;
  const misalignedLabel = `${normalizePercentage(normalizedMisaligned, total)}% misaligned`;

  context.font = '14px Arial';
  context.fillText(alignedLabel, canvas.width / 2, canvas.height - 50);
  context.fillText(misalignedLabel, canvas.width / 2, canvas.height - 30);

  return canvas.toDataURL('image/png');
};

const addAlignmentChart = (workbook, worksheet, stats) => {
  if (!worksheet) {
    return;
  }

  const { alignedCount, misalignedCount, alignedPercentage, totalApps } = stats || {};
  const columnOffset = worksheet.metadataColumnCount || worksheet.columnCount || 1;
  const titleCell = worksheet.getCell(1, columnOffset + 1);
  titleCell.value = 'Apps with aligned metadata (7 days)';
  titleCell.font = { bold: true };

  if (!totalApps) {
    worksheet.getCell(2, columnOffset + 1).value = 'Alignment data unavailable for export.';
    return;
  }

  worksheet.getCell(2, columnOffset + 1).value = `Aligned: ${alignedCount} of ${totalApps} (${alignedPercentage}%)`;
  worksheet.getCell(3, columnOffset + 1).value = `Misaligned: ${misalignedCount}`;

  const chartDataUrl = buildPieChart(alignedCount, misalignedCount, 'Apps with aligned metadata (7 days)');

  if (!chartDataUrl) {
    return;
  }

  const imageId = workbook.addImage({ base64: chartDataUrl.split(',')[1], extension: 'png' });
  worksheet.addImage(imageId, {
    tl: { col: columnOffset + 0.5, row: 0.5 },
    ext: { width: 240, height: 160 },
  });
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

    const visitorSheet = appendTableSheet(workbook, visitorTable, 'Visitor', sheetNames);
    const accountSheet = appendTableSheet(workbook, accountTable, 'Account', sheetNames);

    const sevenDayRecords = getMetadataFieldRecords(7);
    const visitorAlignment = calculateAlignmentStats(sevenDayRecords, {
      fieldKey: 'visitorFields',
      windowDays: 7,
    });
    const accountAlignment = calculateAlignmentStats(sevenDayRecords, {
      fieldKey: 'accountFields',
      windowDays: 7,
    });

    addAlignmentChart(workbook, visitorSheet, visitorAlignment);
    addAlignmentChart(workbook, accountSheet, accountAlignment);

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
