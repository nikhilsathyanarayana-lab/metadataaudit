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
  let cachedResponses = [];

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

    const isComplete = completed >= total;
    progressBanner.textContent = isComplete ? 'Fetched' : `Fetching ${completed} / ${total}`;
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

  const normalizeAppId = (value) => (value === undefined || value === null ? '' : String(value));

  const buildSelectionState = (responses) =>
    responses.map((entry) => {
      const appIds = extractAppIds(entry.response);
      const existingSelection = entry.selectionState || {};
      const selectionState = {};

      appIds.forEach((appId) => {
        const normalizedAppId = normalizeAppId(appId);
        const previous = existingSelection[normalizedAppId];
        selectionState[normalizedAppId] = {
          appId: normalizedAppId,
          appName: previous?.appName || normalizedAppId,
          selected: previous?.selected === 1 ? 1 : 0,
        };
      });

      return { ...entry, selectionState };
    });

  const persistResponses = (responses) => {
    localStorage.setItem(responseStorageKey, JSON.stringify(responses));
  };

  const filterResponseList = (list, allowedAppIds) => {
    if (!Array.isArray(list)) {
      return [];
    }

    return list.filter((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        return allowedAppIds.has(normalizeAppId(entry));
      }

      if (entry?.appId !== undefined) {
        return allowedAppIds.has(normalizeAppId(entry.appId));
      }

      return false;
    });
  };

  const filterResponseByAppIds = (response, appIds) => {
    if (!response || !appIds?.size) {
      return null;
    }

    if (Array.isArray(response)) {
      const filteredList = filterResponseList(response, appIds);
      return filteredList.length ? filteredList : null;
    }

    const filtered = { ...response };
    ['results', 'data', 'apps'].forEach((key) => {
      if (key in filtered) {
        const pruned = filterResponseList(filtered[key], appIds);
        filtered[key] = pruned;
      }
    });

    const filteredAppIds = extractAppIds(filtered);
    return filteredAppIds.length ? filtered : null;
  };

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
    checkboxes.forEach((box) =>
      box.addEventListener('change', (event) => {
        const { appId, subId } = event.target.dataset;
        handleProceedState();

        if (appId && subId) {
          const normalizedAppId = normalizeAppId(appId);
          const isSelected = event.target.checked;

          cachedResponses = cachedResponses.map((entry) => {
            if (entry.subId !== subId) {
              return entry;
            }

            const selectionState = {
              ...(entry.selectionState || {}),
              [normalizedAppId]: {
                appId: normalizedAppId,
                appName: entry.selectionState?.[normalizedAppId]?.appName || normalizedAppId,
                selected: isSelected ? 1 : 0,
              },
            };

            return { ...entry, selectionState };
          });

          persistResponses(cachedResponses);
        }
      }),
    );

    handleProceedState();
  };

  headerCheckbox?.addEventListener('change', () => {
    const checkboxes = getBodyCheckboxes();
    checkboxes.forEach((box) => {
      box.checked = headerCheckbox.checked;
      box.dispatchEvent(new Event('change'));
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
      const checkbox = buildCheckbox(subId, index);
      checkbox.dataset.appId = appId;
      checkbox.dataset.subId = subId;

      const matchingEntry = cachedResponses.find((entry) => entry.subId === subId);
      const isSelected = matchingEntry?.selectionState?.[normalizeAppId(appId)]?.selected === 1;
      checkbox.checked = isSelected;

      checkboxCell.appendChild(checkbox);

      row.append(subIdCell, appIdCell, checkboxCell);
      tableBody.appendChild(row);
    });

    attachCheckboxListeners();

    if (headerCheckbox?.checked) {
      headerCheckbox.dispatchEvent(new Event('change'));
    }
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

    cachedResponses = buildSelectionState(successfulResponses);

    if (cachedResponses.length) {
      persistResponses(cachedResponses);
    } else {
      localStorage.removeItem(responseStorageKey);
    }

    populateTableFromResponses(successfulResponses);
  };

  proceedButton.addEventListener('click', () => {
    const selectedRows = Array.from(getBodyCheckboxes()).filter((box) => box.checked);

    if (!selectedRows.length) {
      showError('Select at least one app to continue.');
      return;
    }

    const selections = [];
    selectedRows.forEach((box) => {
      const row = box.closest('tr');
      const subIdCell = row?.querySelector('td[data-label="Sub ID"]');
      const appIdCell = row?.querySelector('td[data-label="App ID"]');

      const subId = subIdCell?.textContent?.trim();
      const appId = appIdCell?.textContent?.trim();

      if (!subId || !appId) {
        return;
      }

      const sourceEntry = cachedResponses.find((entry) => entry.subId === subId);
      const filteredResponse = filterResponseByAppIds(sourceEntry?.response, new Set([appId]));
      const normalizedAppId = normalizeAppId(appId);

      if (sourceEntry && filteredResponse) {
        const updatedSelectionState = {
          ...(sourceEntry.selectionState || {}),
          [normalizedAppId]: {
            appId: normalizedAppId,
            appName: sourceEntry.selectionState?.[normalizedAppId]?.appName || normalizedAppId,
            selected: 1,
          },
        };

        selections.push({ ...sourceEntry, response: filteredResponse, selectionState: updatedSelectionState });
      }
    });

    if (!selections.length) {
      showError('Unable to load the selected app data. Please try again.');
      return;
    }

    persistResponses(selections);
    clearError();
    window.location.href = 'metadata_fields.html';
  });

  attachCheckboxListeners();
  fetchAndPopulate();
};
