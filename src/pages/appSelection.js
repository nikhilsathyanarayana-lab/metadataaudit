import { extractAppIds } from '../services/appUtils.js';
import { fetchAppsForEntry } from '../services/requests.js';

export const initAppSelection = () => {
  const proceedButton = document.getElementById('app-selection-continue');
  const tableBody = document.getElementById('app-selection-table-body') || document.querySelector('.data-table tbody');
  const headerCheckbox = document.getElementById('app-selection-header-checkbox');
  const messageRegion = document.getElementById('app-selection-messages');
  const progressBanner = document.getElementById('app-selection-progress');

  if (!proceedButton || !tableBody) {
    return;
  }

  const storageKey = 'subidLaunchData';
  const responseStorageKey = 'appSelectionResponses';

  const showError = (message) => {
    if (!messageRegion) {
      return;
    }

    messageRegion.innerHTML = '';
    const alert = document.createElement('p');
    alert.className = 'alert';
    alert.textContent = message;
    messageRegion.appendChild(alert);
  };

  const clearError = () => {
    if (messageRegion) {
      messageRegion.innerHTML = '';
    }
  };

  const updateProgress = (completed, total) => {
    if (!progressBanner) {
      return;
    }

    if (!total) {
      progressBanner.textContent = '';
      return;
    }

    progressBanner.textContent = `Fetched ${completed} of ${total}`;
  };

  const parseStoredLaunchData = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((entry) => entry?.subId && entry?.domain && entry?.integrationKey);
    } catch (error) {
      console.error('Unable to load stored SubID data:', error);
      return [];
    }
  };

  const buildCheckbox = (subId, index) => {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('aria-label', `Select app for Sub ID ${subId}`);
    checkbox.id = `stored-app-${index}`;

    return checkbox;
  };

  const getBodyCheckboxes = () => tableBody.querySelectorAll('input[type="checkbox"]');

  const updateHeaderCheckboxState = (checkboxes) => {
    if (!headerCheckbox) {
      return;
    }

    const bodyCheckboxes = checkboxes || getBodyCheckboxes();

    if (!bodyCheckboxes.length) {
      headerCheckbox.checked = false;
      headerCheckbox.indeterminate = false;
      headerCheckbox.disabled = true;
      return;
    }

    const checkedCount = Array.from(bodyCheckboxes).filter((box) => box.checked).length;
    headerCheckbox.disabled = false;
    headerCheckbox.checked = checkedCount === bodyCheckboxes.length;
    headerCheckbox.indeterminate = checkedCount > 0 && checkedCount < bodyCheckboxes.length;
  };

  const handleProceedState = () => {
    const checkboxes = getBodyCheckboxes();
    const hasSelection = Array.from(checkboxes).some((box) => box.checked);
    proceedButton.disabled = !hasSelection;
    proceedButton.setAttribute('aria-disabled', String(!hasSelection));
    updateHeaderCheckboxState(checkboxes);
  };

  const attachCheckboxListeners = () => {
    const checkboxes = getBodyCheckboxes();
    checkboxes.forEach((box) => box.addEventListener('change', handleProceedState));
    handleProceedState();
  };

  headerCheckbox?.addEventListener('change', () => {
    const checkboxes = getBodyCheckboxes();
    checkboxes.forEach((box) => {
      box.checked = headerCheckbox.checked;
    });
    handleProceedState();
  });

  const populateTableFromResponses = (responses) => {
    tableBody.innerHTML = '';

    const rows = [];

    responses.forEach(({ subId, response }) => {
      const appIds = extractAppIds(response);

      if (!appIds.length) {
        rows.push({ subId, appId: 'No apps returned' });
        return;
      }

      appIds.forEach((appId) => rows.push({ subId, appId }));
    });

    if (!rows.length) {
      const row = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 3;
      emptyCell.textContent = 'No app data available.';
      row.appendChild(emptyCell);
      tableBody.appendChild(row);
      proceedButton.disabled = true;
      proceedButton.setAttribute('aria-disabled', 'true');
      updateHeaderCheckboxState();
      return;
    }

    rows.forEach(({ subId, appId }, index) => {
      const row = document.createElement('tr');

      const subIdCell = document.createElement('td');
      subIdCell.dataset.label = 'Sub ID';
      subIdCell.textContent = subId;

      const appIdCell = document.createElement('td');
      appIdCell.dataset.label = 'App ID';
      appIdCell.textContent = appId;

      const checkboxCell = document.createElement('td');
      checkboxCell.className = 'checkbox-cell';
      checkboxCell.appendChild(buildCheckbox(subId, index));

      row.append(subIdCell, appIdCell, checkboxCell);
      tableBody.appendChild(row);
    });

    attachCheckboxListeners();
  };

  const renderLaunchDataRows = (rows) => {
    tableBody.innerHTML = '';

    if (!rows.length) {
      updateHeaderCheckboxState();
      proceedButton.disabled = true;
      proceedButton.setAttribute('aria-disabled', 'true');
      return;
    }

    rows.forEach(({ subId }) => {
      const row = document.createElement('tr');

      const subIdCell = document.createElement('td');
      subIdCell.dataset.label = 'Sub ID';
      subIdCell.textContent = subId;

      const loadingCell = document.createElement('td');
      loadingCell.dataset.label = 'App ID';
      loadingCell.textContent = 'Loading apps…';

      const placeholderCheckboxCell = document.createElement('td');
      placeholderCheckboxCell.className = 'checkbox-cell';
      placeholderCheckboxCell.textContent = '—';

      row.append(subIdCell, loadingCell, placeholderCheckboxCell);
      tableBody.appendChild(row);
    });

    proceedButton.disabled = true;
    proceedButton.setAttribute('aria-disabled', 'true');
    updateHeaderCheckboxState();
  };

  const fetchAndPopulate = async () => {
    const storedRows = parseStoredLaunchData();

    renderLaunchDataRows(storedRows);

    if (!storedRows.length) {
      showError('API information not found.');
      if (progressBanner) {
        progressBanner.textContent = 'Unable to load apps: missing SubID launch data.';
      }
      proceedButton.disabled = true;
      proceedButton.setAttribute('aria-disabled', 'true');
      updateProgress(0, 0);
      return;
    }

    clearError();
    updateProgress(0, storedRows.length);

    let completed = 0;
    const responses = [];

    for (const entry of storedRows) {
      const response = await fetchAppsForEntry(entry);
      completed += 1;
      updateProgress(completed, storedRows.length);

      responses.push({ ...entry, response });
    }

    const successfulResponses = responses.filter(({ response }) => Boolean(response));

    if (successfulResponses.length) {
      localStorage.setItem(responseStorageKey, JSON.stringify(successfulResponses));
    } else {
      localStorage.removeItem(responseStorageKey);
    }

    populateTableFromResponses(successfulResponses);
  };

  proceedButton.addEventListener('click', () => {
    window.location.href = 'metadata_fields.html';
  });

  attachCheckboxListeners();
  fetchAndPopulate();
};
