import { waitForMetadataFields } from '../../pages/metadataFields.js';
import {
  applyHeaderFormatting,
  downloadWorkbook,
  ensurePageDocument,
  ensureWorkbookLibraries,
  openNamingModal,
  sanitizeFileName,
  sanitizeSheetName,
} from './excel_shared.js';

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

const buildDefaultFileName = () => {
  const today = new Date();
  const dateStamp = today.toISOString().slice(0, 10);
  return `metadata_fields-${dateStamp}`;
};

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

const buildSheetFromAoA = (aoa, fallbackMessage) => {
  if (!aoa || !aoa.length || !aoa[0]?.length) {
    const sheet = window.XLSX.utils.json_to_sheet([{ Note: fallbackMessage }]);
    applyHeaderFormatting(sheet);
    return sheet;
  }

  const sheet = window.XLSX.utils.aoa_to_sheet(aoa);
  applyHeaderFormatting(sheet);
  return sheet;
};

const addTableSheet = (workbook, table, label, sheetNames) => {
  const aoa = collectTableAoA(table);
  const sheet = buildSheetFromAoA(aoa, `${label} data was not available to export.`);
  window.XLSX.utils.book_append_sheet(workbook, sheet, sanitizeSheetName(label, sheetNames));
};

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
      console.error('Metadata fields may not finish loading before export completes.', error),
    );

    setStatus('Building XLSX workbook…', { pending: true });
    const metadataDoc = await ensurePageDocument('metadata_fields.html');
    const visitorTable = metadataDoc?.getElementById('visitor-metadata-table');
    const accountTable = metadataDoc?.getElementById('account-metadata-table');

    const workbook = window.XLSX.utils.book_new();
    const sheetNames = new Set();

    addTableSheet(workbook, visitorTable, 'Visitor', sheetNames);
    addTableSheet(workbook, accountTable, 'Account', sheetNames);

    downloadWorkbook(workbook, desiredName || buildDefaultFileName());
    setStatus('Export ready. Your XLSX download should start shortly.', { pending: false });
  } catch (error) {
    console.error('Unable to export metadata XLSX.', error);
    setStatus('Unable to export metadata to XLSX. Please try again.', {
      pending: false,
      tone: 'error',
    });
  } finally {
    setTimeout(() => restore(), 1500);
  }
};
