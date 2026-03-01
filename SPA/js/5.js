import { buildSpaMetadataWorkbook } from './export/buildSpaMetadataWorkbook.js';
import {
  downloadWorkbook,
  openNamingModal,
  sanitizeFileName,
} from '../../src/controllers/exports/excel_shared.js';

let workbookCache = null;
let defaultWorkbookName = '';
let excludedSheetNames = new Set();
let activeSheetName = '';
const coreSheetNames = new Set(['Overview', 'Visitor', 'Account']);

// Escapes HTML characters for safe preview rendering.
const escapeHtml = (value) => {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// Convert an Excel ARGB color value into a browser-ready hex color.
const excelColorToHex = (color) => {
  const argb = String(color?.argb || '').trim();

  if (argb.length === 8) {
    return `#${argb.slice(2)}`;
  }

  if (argb.length === 6) {
    return `#${argb}`;
  }

  return '';
};

// Convert an Excel column address (A, AA) into a 1-indexed column number.
const columnAddressToNumber = (columnAddress = '') => {
  return String(columnAddress)
    .toUpperCase()
    .split('')
    .reduce((value, character) => (value * 26) + (character.charCodeAt(0) - 64), 0);
};

// Parse a workbook cell reference (A1) into row and column numbers.
const parseCellReference = (reference = '') => {
  const match = String(reference).match(/^([A-Z]+)(\d+)$/i);

  if (!match) {
    return null;
  }

  return {
    column: columnAddressToNumber(match[1]),
    row: Number.parseInt(match[2], 10),
  };
};

// Parse a merge range (A1:C1) into start and end boundaries.
const parseMergeRange = (range = '') => {
  const [startReference, endReference] = String(range).split(':');
  const start = parseCellReference(startReference);
  const end = parseCellReference(endReference || startReference);

  if (!start || !end) {
    return null;
  }

  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column),
  };
};

// Build fast merge lookups for worksheet preview rendering.
const buildMergeLookup = (worksheet) => {
  const merges = Array.isArray(worksheet?.model?.merges) ? worksheet.model.merges : [];
  const masterCells = new Map();
  const coveredCells = new Set();
  let maxMergedColumn = 0;
  let maxMergedRow = 0;

  merges.forEach((mergeRange) => {
    const parsedRange = parseMergeRange(mergeRange);

    if (!parsedRange) {
      return;
    }

    maxMergedColumn = Math.max(maxMergedColumn, parsedRange.endColumn);
    maxMergedRow = Math.max(maxMergedRow, parsedRange.endRow);

    const key = `${parsedRange.startRow}:${parsedRange.startColumn}`;
    masterCells.set(key, {
      colspan: Math.max(1, (parsedRange.endColumn - parsedRange.startColumn) + 1),
      rowspan: Math.max(1, (parsedRange.endRow - parsedRange.startRow) + 1),
    });

    for (let row = parsedRange.startRow; row <= parsedRange.endRow; row += 1) {
      for (let column = parsedRange.startColumn; column <= parsedRange.endColumn; column += 1) {
        if (row === parsedRange.startRow && column === parsedRange.startColumn) {
          continue;
        }

        coveredCells.add(`${row}:${column}`);
      }
    }
  });

  return {
    masterCells,
    coveredCells,
    maxMergedColumn,
    maxMergedRow,
  };
};

// Register a dynamic CSS class once and return its class name.
const registerRuleClass = (styleRegistry, cacheKey, cssProperty, cssValue, prefix) => {
  if (!cssValue) {
    return '';
  }

  const existingClass = styleRegistry.classByKey.get(cacheKey);
  if (existingClass) {
    return existingClass;
  }

  styleRegistry.counter += 1;
  const className = `${prefix}-${styleRegistry.counter}`;
  styleRegistry.classByKey.set(cacheKey, className);
  styleRegistry.rules.push(`.${className} { ${cssProperty}: ${cssValue}; }`);
  return className;
};

// Collect CSS classes for one preview cell from ExcelJS style metadata.
const getCellStyleClasses = (cell, styleRegistry) => {
  const classes = ['preview-cell'];
  const font = cell?.font || {};
  const fill = cell?.fill || {};
  const alignment = cell?.alignment || {};

  if (font.bold) {
    classes.push('preview-font-bold');
  }

  if (font.italic) {
    classes.push('preview-font-italic');
  }

  if (font.underline) {
    classes.push('preview-font-underline');
  }

  const fontColor = excelColorToHex(font.color);
  if (fontColor) {
    classes.push(registerRuleClass(styleRegistry, `font-color:${fontColor}`, 'color', fontColor, 'preview-fc'));
  }

  const fillColor = excelColorToHex(fill?.fgColor || fill?.bgColor);
  if (fillColor) {
    classes.push(registerRuleClass(styleRegistry, `fill-color:${fillColor}`, 'background-color', fillColor, 'preview-bg'));
  } else {
    classes.push('preview-fill-default');
  }

  if (font.size) {
    classes.push(registerRuleClass(styleRegistry, `font-size:${font.size}`, 'font-size', `${font.size}px`, 'preview-fs'));
  }

  if (alignment.horizontal) {
    classes.push(`preview-align-${alignment.horizontal}`);
  } else {
    classes.push('preview-align-left');
  }

  if (alignment.vertical) {
    classes.push(`preview-valign-${alignment.vertical}`);
  }

  if (alignment.wrapText) {
    classes.push('preview-wrap-text');
  }

  return classes.filter(Boolean);
};

// Build CSS classes for row-level metadata like explicit row height.
const getRowStyleClasses = (row, styleRegistry) => {
  const classes = [];

  if (row?.height) {
    classes.push(registerRuleClass(styleRegistry, `row-height:${row.height}`, 'height', `${row.height}px`, 'preview-rh'));
  }

  return classes.filter(Boolean);
};

// Build CSS classes for column-level metadata like explicit column width.
const getColumnStyleClasses = (worksheet, columnNumber, styleRegistry) => {
  const classes = [];
  const width = worksheet?.getColumn(columnNumber)?.width;

  if (width) {
    classes.push(registerRuleClass(styleRegistry, `column-width:${width}`, 'width', `${Math.round(width * 7)}px`, 'preview-cw'));
  }

  return classes.filter(Boolean);
};

// Determine if a row should be rendered as a semantic table header row.
const isHeaderLikeRow = (rowCells = []) => {
  const visibleCells = rowCells.filter((cell) => !cell.isCovered);
  const nonEmptyCells = visibleCells.filter((cell) => cell.text.trim());

  if (!visibleCells.length || !nonEmptyCells.length) {
    return false;
  }

  const styledCells = nonEmptyCells.filter((cell) => cell.isHeaderLike || cell.colspan > 1);
  return styledCells.length === nonEmptyCells.length;
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

// Returns true when the worksheet belongs to the fixed overview/visitor/account set.
const isCoreSheet = (sheetName) => coreSheetNames.has(String(sheetName || '').trim());

// Creates HTML markup representing a worksheet for iframe preview.
const buildWorksheetHtml = (worksheet) => {
  if (!worksheet) {
    return '<p>Workbook preview is unavailable.</p>';
  }

  const mergeLookup = buildMergeLookup(worksheet);
  const columnCount = Math.max(
    worksheet.metadataColumnCount || 0,
    worksheet.columnCount || 0,
    worksheet.actualColumnCount || 0,
    mergeLookup.maxMergedColumn || 0,
    1,
  );
  const rowCount = Math.max(worksheet.rowCount || 0, worksheet.actualRowCount || 0, mergeLookup.maxMergedRow || 0, 1);
  const styleRegistry = {
    classByKey: new Map(),
    rules: [],
    counter: 0,
  };

  const colgroup = [];
  for (let column = 1; column <= columnCount; column += 1) {
    const columnClasses = getColumnStyleClasses(worksheet, column, styleRegistry);
    colgroup.push(`<col class="${columnClasses.join(' ')}" />`);
  }

  const rows = [];

  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const cells = [];

    for (let column = 1; column <= columnCount; column += 1) {
      const cellKey = `${rowNumber}:${column}`;

      if (mergeLookup.coveredCells.has(cellKey)) {
        continue;
      }

      const cell = row.getCell(column);
      const rawValue = cell?.text ?? cell?.value ?? '';
      const mergeMeta = mergeLookup.masterCells.get(cellKey) || { colspan: 1, rowspan: 1 };
      const cellClasses = getCellStyleClasses(cell, styleRegistry);
      const isHeaderLike = Boolean(cell?.font?.bold || excelColorToHex(cell?.fill?.fgColor || cell?.fill?.bgColor));

      cells.push({
        text: escapeHtml(rawValue),
        classes: cellClasses,
        colspan: mergeMeta.colspan,
        rowspan: mergeMeta.rowspan,
        isCovered: false,
        isHeaderLike,
      });
    }

    const rowTag = isHeaderLikeRow(cells) ? 'th' : 'td';
    const rowClasses = ['preview-row', ...getRowStyleClasses(row, styleRegistry)].filter(Boolean).join(' ');
    const renderedCells = cells.map((cell) => {
      const spans = [
        cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '',
        cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : '',
      ].join('');

      return `<${rowTag}${spans} class="${cell.classes.join(' ')}">${cell.text}</${rowTag}>`;
    });

    rows.push(`<tr class="${rowClasses}">${renderedCells.join('')}</tr>`);
  }

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: Arial, sans-serif; padding: 12px; }
          h1 { font-size: 18px; margin: 0 0 12px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; font-size: 12px; text-align: left; vertical-align: middle; }
          .preview-row { height: auto; }
          .preview-cell { background: #fff; }
          .preview-fill-default { background: #fff; }
          .preview-font-bold { font-weight: 700; }
          .preview-font-italic { font-style: italic; }
          .preview-font-underline { text-decoration: underline; }
          .preview-align-left { text-align: left; }
          .preview-align-center { text-align: center; }
          .preview-align-right { text-align: right; }
          .preview-align-fill,
          .preview-align-distributed,
          .preview-align-justify { text-align: justify; }
          .preview-valign-top { vertical-align: top; }
          .preview-valign-middle,
          .preview-valign-center { vertical-align: middle; }
          .preview-valign-bottom { vertical-align: bottom; }
          .preview-wrap-text { white-space: pre-wrap; }
          ${styleRegistry.rules.join('\n          ')}
        </style>
      </head>
      <body>
        <h1>${escapeHtml(worksheet.name)}</h1>
        <table>
          <colgroup>${colgroup.join('')}</colgroup>
          <tbody>${rows.join('')}</tbody>
        </table>
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
    if (button.dataset?.role === 'app-selector') {
      return;
    }

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

  const coreSheets = sheets.filter((sheet) => isCoreSheet(sheet?.name));
  const appSheets = sheets.filter((sheet) => !isCoreSheet(sheet?.name));

  coreSheets.forEach((sheet, index) => {
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

  if (appSheets.length) {
    const appSelectorButton = document.createElement('button');
    appSelectorButton.type = 'button';
    appSelectorButton.className = 'export-tab-button export-app-selector-button';
    appSelectorButton.id = 'excel-app-selector-button';
    appSelectorButton.dataset.role = 'app-selector';
    appSelectorButton.setAttribute('aria-label', 'Select app worksheet preview');

    const activeAppSheet = appSheets.find((sheet) => sheet?.name === activeName);
    appSelectorButton.textContent = activeAppSheet?.name || 'Select App';
    if (activeAppSheet) {
      appSelectorButton.classList.add('is-active');
    }

    appSelectorButton.addEventListener('click', async () => {
      const selectedName = await openAppSheetModal(
        appSheets.map((sheet) => sheet?.name || ''),
        activeName,
      );

      if (selectedName) {
        onSelect?.(selectedName);
      }
    });

    tabList.append(appSelectorButton);
  }

  updateActiveTab(tabList, activeName);
};

// Presents a modal that allows selecting one app worksheet for preview.
const openAppSheetModal = async (sheetNames = [], activeName = '') => {
  const backdropId = 'excel-app-selector-backdrop';
  const modalId = 'excel-app-selector-modal';
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
    modal.className = 'modal excel-app-selector-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'excel-app-selector-title');
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-content" id="excel-app-selector-content">
        <div class="modal-header" id="excel-app-selector-header">
          <div id="excel-app-selector-heading" class="excel-app-selector-heading">
            <p class="eyebrow" id="excel-app-selector-eyebrow">Preview</p>
            <h2 class="modal-title" id="excel-app-selector-title">Choose an app tab</h2>
            <p class="section-hint" id="excel-app-selector-hint">Select the app worksheet you want to preview.</p>
          </div>
          <button type="button" class="close-btn" id="excel-app-selector-close-button" aria-label="Close app selector modal" data-dismiss-app-selector>&times;</button>
        </div>
        <div class="modal-body" id="excel-app-selector-body">
          <div class="excel-app-option-list" id="excel-app-option-list"></div>
        </div>
      </div>`;
    document.body.append(modal);
  }

  const appOptionList = modal.querySelector('#excel-app-option-list');
  const dismissButtons = modal.querySelectorAll('[data-dismiss-app-selector]');

  if (!appOptionList) {
    return null;
  }

  appOptionList.innerHTML = '';
  sheetNames.forEach((sheetName, index) => {
    const appButton = document.createElement('button');
    appButton.type = 'button';
    appButton.className = 'secondary-btn excel-app-option-button';
    appButton.id = `excel-app-option-${index}`;
    appButton.textContent = sheetName;
    appButton.dataset.sheetName = sheetName;
    if (sheetName === activeName) {
      appButton.classList.add('is-active');
    }
    appOptionList.append(appButton);
  });

  return new Promise((resolve) => {
    const cleanup = [];

    const closeModal = (nextValue = null) => {
      modal.classList.remove('is-visible');
      backdrop.classList.remove('is-visible');
      modal.hidden = true;
      backdrop.hidden = true;
      cleanup.forEach((fn) => fn?.());
      resolve(nextValue);
    };

    const handleCancel = () => closeModal(null);

    modal.hidden = false;
    backdrop.hidden = false;
    requestAnimationFrame(() => {
      modal.classList.add('is-visible');
      backdrop.classList.add('is-visible');
      appOptionList.querySelector('.excel-app-option-button')?.focus();
    });

    appOptionList.querySelectorAll('.excel-app-option-button').forEach((button) => {
      const handleSelect = () => closeModal(button.dataset?.sheetName || null);
      button.addEventListener('click', handleSelect);
      cleanup.push(() => button.removeEventListener('click', handleSelect));
    });

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
    const workbookResult = await buildSpaMetadataWorkbook();
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
