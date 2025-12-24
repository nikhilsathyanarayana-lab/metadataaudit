import { app_names } from '../API/app_names.js';

let appSelections = [];

// Persist the latest app selection snapshot for reuse across SPA views.
export const setAppSelections = (entries = []) => {
  appSelections = entries
    .filter((entry) => entry && (entry.subId || entry.appId || entry.appName))
    .map((entry) => ({
      subId: entry.subId || '',
      appId: entry.appId || '',
      appName: entry.appName || '',
      isSelected: Boolean(entry.isSelected),
    }));
};

// Retrieve a copy of the stored app selections.
export const getAppSelections = () => [...appSelections];

// Clear any saved app selection data.
export const clearAppSelections = () => {
  appSelections = [];
};

// Build a single row summarizing status or errors across columns.
const createStatusRow = (message, columnCount = 4, subId = '') => {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.textContent = subId ? `${message} (${subId})` : message;
  row.appendChild(cell);
  return row;
};

// Build a selectable app entry row for the preview table.
const createAppRow = ({ subId, appId, appName }) => {
  const row = document.createElement('tr');

  const subIdCell = document.createElement('td');
  subIdCell.textContent = subId || 'Unknown SubID';

  const nameCell = document.createElement('td');
  nameCell.textContent = appName || appId || 'Unknown app';

  const appIdCell = document.createElement('td');
  appIdCell.textContent = appId || '';

  const checkboxCell = document.createElement('td');
  checkboxCell.className = 'checkbox-cell';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.disabled = true;
  checkbox.dataset.subId = subId || '';
  checkbox.dataset.appId = appId || '';
  checkbox.dataset.appName = appName || appId || '';
  checkbox.setAttribute('aria-label', `Select app ${appId || 'unknown'} for ${subId || 'unknown SubID'}`);
  checkboxCell.appendChild(checkbox);

  row.append(subIdCell, nameCell, appIdCell, checkboxCell);
  return row;
};

// Determine how many columns the app table has.
const getColumnCount = (tableBody) => {
  const headerCells = tableBody?.closest('table')?.querySelectorAll('thead th');
  return headerCells?.length || 4;
};

// Populate the preview table with apps for each credential.
const renderAppTable = async (tableBody) => {
  const columnCount = getColumnCount(tableBody);
  tableBody.innerHTML = '';

  const credentialResults = await app_names();

  if (!credentialResults.length) {
    tableBody.appendChild(createStatusRow('No credentials available for app discovery.', columnCount));
    return;
  }

  credentialResults.forEach((result) => {
    const subId = result?.credential?.subId;

    if (result?.errorType || !Array.isArray(result?.results)) {
      const errorHint = result?.errorHint ? `: ${result.errorHint}` : '';
      tableBody.appendChild(createStatusRow(
        `Unable to load apps for ${subId || 'unknown SubID'}${errorHint}`,
        columnCount,
      ));
      return;
    }

    if (!result.results.length) {
      tableBody.appendChild(createStatusRow('No apps returned for SubID.', columnCount, subId));
      return;
    }

    result.results.forEach((app) => {
      tableBody.appendChild(createAppRow({
        subId,
        appId: app?.appId,
        appName: app?.appName,
      }));
    });
  });
};

// Initialize the app discovery section with available credentials.
export async function initSection(sectionRoot) {
  // eslint-disable-next-line no-console
  console.log('Initializing app selection preview');

  if (!sectionRoot) {
    return;
  }

  const tableBody = sectionRoot.querySelector('tbody');

  if (!tableBody) {
    return;
  }

  await renderAppTable(tableBody);

  const tableCheckboxes = sectionRoot.querySelectorAll('tbody input[type="checkbox"]');
  const headerToggle = sectionRoot.querySelector('#app-selection-toggle-all-preview');
  const continueButton = sectionRoot.querySelector('#app-selection-continue-btn');
  const pageThreeButton = document.querySelector('#page-switcher-btn-3');
  let selectedAppCount = 0;

  if (!headerToggle || !tableCheckboxes.length) {
    return;
  }

  // Enable or disable the continue button based on selection.
  const updateContinueButtonState = () => {
    if (!continueButton) {
      return;
    }

    const hasSelection = selectedAppCount > 0;
    continueButton.disabled = !hasSelection;
    continueButton.setAttribute('aria-disabled', hasSelection ? 'false' : 'true');
  };

  // Track selected app total and update UI messaging.
  const updateSelectionCount = () => {
    selectedAppCount = Array.from(tableCheckboxes).filter((checkbox) => checkbox.checked).length;
    const selectionCount = sectionRoot.querySelector('.selection-count');

    if (selectionCount) {
      const appLabel = selectedAppCount === 1 ? 'app' : 'apps';
      selectionCount.textContent = `${selectedAppCount} ${appLabel} selected`;
    }

    updateContinueButtonState();
  };

  // Keep the header checkbox in sync with row selections.
  const syncHeaderState = () => {
    const areAllChecked = Array.from(tableCheckboxes).every((checkbox) => checkbox.checked);
    headerToggle.checked = areAllChecked;
    headerToggle.setAttribute('aria-checked', areAllChecked ? 'true' : 'false');
  };

  const buildSelectionSnapshot = () =>
    Array.from(tableCheckboxes).map((checkbox) => ({
      subId: checkbox.dataset.subId || '',
      appId: checkbox.dataset.appId || '',
      appName: checkbox.dataset.appName || '',
      isSelected: Boolean(checkbox.checked),
    }));

  // Apply the same selection state to every row.
  const setRowSelection = (isChecked) => {
    tableCheckboxes.forEach((checkbox) => {
      checkbox.checked = isChecked;
      checkbox.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    });
  };

  headerToggle.disabled = false;
  headerToggle.removeAttribute('disabled');
  headerToggle.setAttribute('aria-disabled', 'false');
  headerToggle.setAttribute('aria-checked', 'false');
  setRowSelection(false);
  updateSelectionCount();

  tableCheckboxes.forEach((checkbox) => {
    checkbox.disabled = false;
    checkbox.removeAttribute('aria-disabled');
    checkbox.addEventListener('change', () => {
      syncHeaderState();
      updateSelectionCount();
    });
  });

  headerToggle.addEventListener('change', () => {
    const isChecked = headerToggle.checked;
    headerToggle.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    setRowSelection(isChecked);
    updateSelectionCount();
  });

  continueButton?.addEventListener('click', () => {
    setAppSelections(buildSelectionSnapshot());
    pageThreeButton?.click();
  });
}
