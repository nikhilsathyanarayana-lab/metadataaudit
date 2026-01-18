import { app_names } from '../API/app_names.js';

// Share the latest app selection snapshot between SPA views.
export const appSelectionState = { entries: [] };

// Resolve app listing results from the API layer.
const resolveAppListingResults = async () => {
  return app_names();
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

  const credentialResults = await resolveAppListingResults();

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

// Reapply any saved selections to the freshly rendered checkboxes.
const applySavedSelections = (tableCheckboxes, savedSelections = []) => {
  let restoredCount = 0;

  const findMatchingSelection = (checkbox) => savedSelections.find(
    (entry) => entry.subId === checkbox.dataset.subId
      && entry.appId === checkbox.dataset.appId
      && entry.appName === checkbox.dataset.appName,
  );

  tableCheckboxes.forEach((checkbox) => {
    const matchedSelection = findMatchingSelection(checkbox);
    const isSelected = Boolean(matchedSelection?.isSelected);

    checkbox.checked = isSelected;
    checkbox.setAttribute('aria-checked', isSelected ? 'true' : 'false');

    if (isSelected) {
      restoredCount += 1;
    }
  });

  return restoredCount;
};

// Capture the current selection state for persistence between renders.
const buildSelectionSnapshot = (tableCheckboxes) => Array.from(tableCheckboxes).map((checkbox) => ({
  subId: checkbox.dataset.subId || '',
  appId: checkbox.dataset.appId || '',
  appName: checkbox.dataset.appName || '',
  isSelected: Boolean(checkbox.checked),
}));

// Temporarily disable selection toggles when the preview cannot be interacted with.
const disableSelectionControls = (headerToggle, continueButton) => {
  if (headerToggle) {
    headerToggle.checked = false;
    headerToggle.disabled = true;
    headerToggle.setAttribute('aria-disabled', 'true');
    headerToggle.setAttribute('aria-checked', 'false');
  }

  if (continueButton) {
    continueButton.disabled = true;
    continueButton.setAttribute('aria-disabled', 'true');
  }
};

// Restore selection controls and keep header toggle, counts, and actions in sync.
const enableSelectionControls = (
  sectionRoot,
  tableCheckboxes,
  headerToggle,
  continueButton,
  pageThreeButton,
) => {
  let selectedAppCount = Array.from(tableCheckboxes).filter((checkbox) => checkbox.checked).length;

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

  tableCheckboxes.forEach((checkbox) => {
    checkbox.disabled = false;
    checkbox.removeAttribute('aria-disabled');
    checkbox.onchange = () => {
      syncHeaderState();
      updateSelectionCount();
    };
  });

  headerToggle.onchange = () => {
    const isChecked = headerToggle.checked;
    headerToggle.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    setRowSelection(isChecked);
    updateSelectionCount();
  };

  if (continueButton) {
    continueButton.onclick = () => {
      appSelectionState.entries = buildSelectionSnapshot(tableCheckboxes);
      pageThreeButton?.click();
    };
  }

  syncHeaderState();
  updateSelectionCount();
};

// Render the app selection preview, restoring saved choices and wiring UI controls.
const renderAppPreview = async (sectionRoot) => {
  const tableBody = sectionRoot?.querySelector('tbody');
  const headerToggle = sectionRoot?.querySelector('#app-selection-toggle-all-preview');
  const continueButton = sectionRoot?.querySelector('#app-selection-continue-btn');
  const pageThreeButton = document.querySelector('#page-switcher-btn-3');
  const savedSelections = appSelectionState.entries;

  if (!sectionRoot || !tableBody) {
    return;
  }

  await renderAppTable(tableBody);

  const tableCheckboxes = sectionRoot.querySelectorAll('tbody input[type="checkbox"]');
  applySavedSelections(tableCheckboxes, savedSelections);

  if (!headerToggle || !tableCheckboxes.length) {
    disableSelectionControls(headerToggle, continueButton);
    return;
  }

  enableSelectionControls(sectionRoot, tableCheckboxes, headerToggle, continueButton, pageThreeButton);
};

// Initialize the app discovery section with available credentials.
export async function initSection(sectionRoot) {
  // eslint-disable-next-line no-console
  console.log('Initializing app selection preview');

  await renderAppPreview(sectionRoot);
}

// Refresh the app preview when the tab is reopened so updated credentials are respected.
export async function onShow(sectionRoot) {
  await renderAppPreview(sectionRoot);
}
