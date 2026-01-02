import { buildMetadataWorkbook } from '../../src/controllers/exports/metadata_xlsx.js';
import {
  downloadWorkbook,
  openNamingModal,
  sanitizeFileName,
} from '../../src/controllers/exports/excel_shared.js';

let workbookCache = null;
let defaultWorkbookName = '';
let excludedSheetNames = new Set();
let activeSheetName = '';

// Escapes HTML characters for safe preview rendering.
const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Returns the worksheets that are not currently excluded.
const getIncludedSheets = (workbook, excluded = new Set()) => {
  if (!workbook?.worksheets?.length) {
    return [];
  }

  return workbook.worksheets.filter((worksheet) => !excluded.has(worksheet?.name));
};

// Resolves the active sheet name, defaulting to the first available sheet.
const resolveActiveSheetName = (sheets, desiredName) => {
  if (!sheets.length) {
    return '';
  }

  const hasDesiredSheet = sheets.some((sheet) => sheet?.name === desiredName);
  return hasDesiredSheet ? desiredName : sheets[0]?.name || '';
};

// Creates HTML markup representing a worksheet for iframe preview.
const buildWorksheetHtml = (worksheet) => {
  if (!worksheet) {
    return '<p>Workbook preview is unavailable.</p>';
  }

  const columnCount = worksheet.metadataColumnCount || worksheet.columnCount || worksheet.actualColumnCount || 1;
  const rows = [];

  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = [];
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      const rawValue = cell?.text ?? cell?.value ?? '';
      const cellTag = rowNumber === 1 ? 'th' : 'td';
      cells.push(`<${cellTag}>${escapeHtml(rawValue)}</${cellTag}>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  });

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: Arial, sans-serif; padding: 12px; }
          h1 { font-size: 18px; margin: 0 0 12px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; text-align: left; }
          th { background: #f8d7e5; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(worksheet.name)}</h1>
        <table>${rows.join('')}</table>
      </body>
    </html>`;
};

// Updates the iframe with the selected worksheet preview.
const renderSheetPreview = (frame, worksheet) => {
  if (!frame) {
    return;
  }

  const html = buildWorksheetHtml(worksheet);
  frame.srcdoc = html;
};

// Marks the active tab button for the selected worksheet.
const updateActiveTab = (tabList, activeName) => {
  if (!tabList) {
    return;
  }

  const tabButtons = tabList.querySelectorAll('.export-tab-button');
  tabButtons.forEach((button) => {
    const isActive = button.dataset?.sheetName === activeName;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', isActive);
    button.tabIndex = isActive ? 0 : -1;
  });
};

// Builds the tab strip for the available worksheets.
const renderExcelTabs = (tabList, sheets, onSelect, activeName) => {
  if (!tabList) {
    return;
  }

  tabList.innerHTML = '';

  sheets.forEach((sheet, index) => {
    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'export-tab-button';
    tabButton.id = `excel-tab-${index}`;
    tabButton.role = 'tab';
    tabButton.textContent = sheet?.name || `Sheet ${index + 1}`;
    tabButton.dataset.sheetName = sheet?.name || '';
    tabButton.setAttribute('aria-controls', 'excel-preview-frame');
    tabButton.addEventListener('click', () => onSelect?.(sheet?.name));
    tabList.append(tabButton);
  });

  updateActiveTab(tabList, activeName);
};

// Presents a modal that lists worksheets and captures exclusion selections.
const openExcludeSheetModal = async (sheetNames = [], excluded = new Set()) => {
  const backdropId = 'excel-exclude-backdrop';
  const modalId = 'excel-exclude-modal';
  let backdrop = document.getElementById(backdropId);
  let modal = document.getElementById(modalId);

  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = backdropId;
    backdrop.className = 'modal-backdrop';
    backdrop.hidden = true;
    document.body.append(backdrop);
  }

  if (!modal) {
    modal = document.createElement('section');
    modal.id = modalId;
    modal.className = 'modal excel-exclude-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'excel-exclude-modal-title');
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-content" id="excel-exclude-modal-content">
        <div class="modal-header" id="excel-exclude-modal-header">
          <div>
            <p class="eyebrow">Preview</p>
            <h2 class="modal-title" id="excel-exclude-modal-title">Exclude sheets</h2>
            <p class="section-hint" id="excel-exclude-modal-hint">Uncheck any sheets to hide them from the preview and download.</p>
          </div>
          <button type="button" class="close-btn" id="excel-exclude-close-button" aria-label="Close exclude modal" data-dismiss-exclude-modal>&times;</button>
        </div>
        <div class="modal-body" id="excel-exclude-modal-body">
          <div class="checkbox-list" id="excel-exclude-checkbox-list"></div>
        </div>
        <div class="modal-actions" id="excel-exclude-modal-actions">
          <button type="button" class="secondary-btn" id="excel-exclude-cancel-button" data-dismiss-exclude-modal>Cancel</button>
          <button type="button" class="primary-btn" id="excel-exclude-apply-button">Apply</button>
        </div>
      </div>`;
    document.body.append(modal);
  }

  const checkboxList = modal.querySelector('#excel-exclude-checkbox-list');
  const applyButton = modal.querySelector('#excel-exclude-apply-button');
  const dismissButtons = modal.querySelectorAll('[data-dismiss-exclude-modal]');

  if (!checkboxList || !applyButton) {
    return excluded;
  }

  checkboxList.innerHTML = '';
  sheetNames.forEach((sheetName, index) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'checkbox';
    wrapper.id = `excel-exclude-option-${index}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = sheetName;
    checkbox.checked = excluded.has(sheetName);

    const label = document.createElement('span');
    label.textContent = sheetName;

    wrapper.append(checkbox, label);
    checkboxList.append(wrapper);
  });

  return new Promise((resolve) => {
    const cleanup = [];

    const closeModal = (nextValue = excluded) => {
      modal.classList.remove('is-visible');
      backdrop.classList.remove('is-visible');
      modal.hidden = true;
      backdrop.hidden = true;
      cleanup.forEach((fn) => fn?.());
      resolve(nextValue);
    };

    const handleApply = () => {
      const nextExcluded = new Set();
      checkboxList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
        if (input.checked) {
          nextExcluded.add(input.name);
        }
      });
      closeModal(nextExcluded);
    };

    const handleCancel = () => closeModal(excluded);

    modal.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      modal.classList.add('is-visible');
      backdrop.classList.add('is-visible');
      applyButton.focus();
    });

    applyButton.addEventListener('click', handleApply);
    cleanup.push(() => applyButton.removeEventListener('click', handleApply));

    dismissButtons.forEach((button) => {
      button.addEventListener('click', handleCancel);
      cleanup.push(() => button.removeEventListener('click', handleCancel));
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        handleCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    cleanup.push(() => document.removeEventListener('keydown', handleKeyDown));
    backdrop.addEventListener('click', handleCancel);
    cleanup.push(() => backdrop.removeEventListener('click', handleCancel));
  });
};

// Clones a workbook and removes any excluded worksheets.
const filterWorkbookForDownload = async (workbook, excluded = new Set()) => {
  const clone = new window.ExcelJS.Workbook();
  const buffer = await workbook.xlsx.writeBuffer();
  await clone.xlsx.load(buffer);

  excluded.forEach((sheetName) => {
    const worksheet = clone.getWorksheet(sheetName);
    if (worksheet) {
      clone.removeWorksheet(worksheet.id);
    }
  });

  return clone;
};

// Refreshes the worksheet tabs and iframe preview based on the current selection.
const refreshWorkbookPreview = (previewFrame, tabList) => {
  const sheets = getIncludedSheets(workbookCache, excludedSheetNames);
  activeSheetName = resolveActiveSheetName(sheets, activeSheetName);
  const activeSheet = sheets.find((sheet) => sheet?.name === activeSheetName);

  renderExcelTabs(tabList, sheets, (sheetName) => {
    activeSheetName = sheetName;
    updateActiveTab(tabList, sheetName);
    const nextSheet = sheets.find((sheet) => sheet?.name === sheetName);
    renderSheetPreview(previewFrame, nextSheet);
  }, activeSheetName);

  renderSheetPreview(previewFrame, activeSheet);
};

// Initialize the Excel preview experience for the SPA page five view.
export async function initSection(sectionElement) {
  const previewFrame = sectionElement?.querySelector('#excel-preview-frame');
  const tabList = sectionElement?.querySelector('#excel-tab-strip');
  const excludeTabsButton = sectionElement?.querySelector('#excel-exclude-tabs-button');
  const downloadButton = sectionElement?.querySelector('#excel-download-button');

  if (!sectionElement || !previewFrame) {
    return;
  }

  renderSheetPreview(previewFrame, null);

  try {
    const workbookResult = await buildMetadataWorkbook();
    workbookCache = workbookResult.workbook;
    defaultWorkbookName = workbookResult.defaultFileName;
    excludedSheetNames = new Set();
    activeSheetName = '';
    refreshWorkbookPreview(previewFrame, tabList);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Unable to build preview workbook.', error);
    renderSheetPreview(previewFrame, null);
  }

  excludeTabsButton?.addEventListener('click', async () => {
    if (!workbookCache) {
      return;
    }

    const sheets = getIncludedSheets(workbookCache);
    const nextExcluded = await openExcludeSheetModal(
      sheets.map((sheet) => sheet?.name || ''),
      excludedSheetNames,
    );

    excludedSheetNames = nextExcluded instanceof Set ? nextExcluded : excludedSheetNames;
    refreshWorkbookPreview(previewFrame, tabList);
  });

  downloadButton?.addEventListener('click', async () => {
    if (!workbookCache) {
      return;
    }

    const desiredName = await openNamingModal(
      () => defaultWorkbookName,
      (value) => sanitizeFileName(value, defaultWorkbookName),
    );

    if (desiredName === null) {
      return;
    }

    try {
      const filteredWorkbook = await filterWorkbookForDownload(workbookCache, excludedSheetNames);
      await downloadWorkbook(filteredWorkbook, desiredName || defaultWorkbookName);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Unable to download filtered workbook.', error);
    }
  });
}
