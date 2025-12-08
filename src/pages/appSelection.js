// App Selection page: renders selectable apps per SubID and gates debug logs behind the DEBUG_LOGGING toggle.
import { createLogger } from '../utils/logger.js';
import { extractAppIds } from '../services/appUtils.js';
import { fetchAppsForEntry } from '../services/requests/network.js';
import { getManualAppName, loadManualAppNames } from '../services/appNames.js';
import { setupManualAppNameModal } from './deepDive/ui/modals.js';
import { buildAppNameCell } from './deepDive/ui/render.js';
import { createSharedApiStatusBanner } from '../ui/pendingQueueBanner.js';
import {
  clearPendingCallQueue,
  markPendingCallStarted,
  registerPendingCall,
  resolvePendingCall,
  updatePendingCallRequestCount,
} from './deepDive/aggregation.js';

const appSelectionLogger = createLogger('AppSelection');

export const initAppSelection = async () => {
  const proceedButton = document.getElementById('app-selection-continue');
  const tableBody = document.getElementById('app-selection-table-body') || document.querySelector('.data-table tbody');
  const headerCheckbox = document.getElementById('app-selection-toggle-all');
  const selectionCount = document.getElementById('app-selection-selection-count');
  const messageRegion = document.getElementById('app-selection-messages');
  const windowSelect = document.getElementById('app-selection-window');
  const defaultWindowDays = 7;
  let currentWindowDays = Number(windowSelect?.value) || defaultWindowDays;
  let isFetching = false;
  let activeRequestToken = 0;
  let headerToggleBound = false;
  const manualAppNames = loadManualAppNames();
  const rows = [];
  const renderedRows = [];
  const getRenderedRows = () => renderedRows;
  let openAppNameModal = () => {};
  const statusBanner = createSharedApiStatusBanner();

  if (!proceedButton || !tableBody) {
    return;
  }

  statusBanner.render();

  const storageKey = 'subidLaunchData';
  const responseStorageKey = 'appSelectionResponses';
  let cachedResponses = [];

  const resetCachedResponses = () => {
    cachedResponses = [];
    sessionStorage.removeItem(responseStorageKey);
  };

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

  const refreshProgressFromQueue = () => {
    statusBanner.render();
  };

  const clearError = () => {
    if (messageRegion) {
      messageRegion.innerHTML = '';
    }
  };

  const parseStoredLaunchData = () => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((entry) => entry?.subId && entry?.domain && entry?.integrationKey);
    } catch (error) {
      appSelectionLogger.error('Unable to load stored SubID data:', error);
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

  const updateCachedSelectionState = (subId, appId, isSelected) => {
    if (!subId || appId === undefined) {
      return;
    }

    const normalizedAppId = normalizeAppId(appId);
    const manualAppName = getManualAppName(manualAppNames, subId, normalizedAppId);

    cachedResponses = cachedResponses.map((entry) => {
      if (entry.subId !== subId) {
        return entry;
      }

      const previousSelection = entry.selectionState?.[normalizedAppId];
      const selectionState = {
        ...(entry.selectionState || {}),
        [normalizedAppId]: {
          appId: normalizedAppId,
          appName: manualAppName || previousSelection?.appName || normalizedAppId,
          selected: isSelected ? 1 : 0,
        },
      };

      return { ...entry, selectionState };
    });
  };

  const buildSelectionState = (responses, manualAppNamesMap = manualAppNames) =>
    responses.map((entry) => {
      const appIds = extractAppIds(entry.response);
      const existingSelection = entry.selectionState || {};
      const selectionState = {};

      appIds.forEach((appId) => {
        const normalizedAppId = normalizeAppId(appId);
        const previous = existingSelection[normalizedAppId];
        selectionState[normalizedAppId] = {
          appId: normalizedAppId,
          appName:
            getManualAppName(manualAppNamesMap, entry.subId, normalizedAppId) ||
            previous?.appName ||
            normalizedAppId,
          selected: previous?.selected === 1 ? 1 : 0,
        };
      });

      return { ...entry, selectionState };
    });

  const mergeAppResponsesBySubId = (responses) => {
    const merged = new Map();

    responses.forEach((entry) => {
      const key = entry?.subId || entry?.domain || entry?.integrationKey || 'unknown';
      const appIds = new Set(extractAppIds(entry.response).map((appId) => normalizeAppId(appId)));
      const existing = merged.get(key);

      if (existing) {
        appIds.forEach((appId) => existing.appIds.add(appId));
        existing.selectionState = { ...(existing.selectionState || {}), ...(entry.selectionState || {}) };
      } else {
        merged.set(key, {
          ...entry,
          appIds,
          selectionState: { ...(entry.selectionState || {}) },
        });
      }
    });

    return Array.from(merged.values()).map((entry) => {
      const mergedAppIds = Array.from(entry.appIds || []);
      const response = mergedAppIds.length
        ? { results: mergedAppIds.map((appId) => ({ appId })) }
        : entry.response;

      const normalizedEntry = { ...entry, response };
      delete normalizedEntry.appIds;
      return normalizedEntry;
    });
  };

  const syncCachedAppName = (appId, appName, subId) => {
    if (!appId || !appName) {
      return;
    }

    const normalizedAppId = normalizeAppId(appId);
    cachedResponses = cachedResponses.map((entry) => {
      if (subId && entry.subId !== subId) {
        return entry;
      }

      const selection = entry.selectionState?.[normalizedAppId];

      if (!selection) {
        return entry;
      }

      const selectionState = { ...(entry.selectionState || {}) };
      selectionState[normalizedAppId] = { ...selection, appName };
      return { ...entry, selectionState };
    });

    persistResponses(cachedResponses);
  };

  const persistResponses = (responses) => {
    sessionStorage.setItem(responseStorageKey, JSON.stringify(responses));
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

  const updateSelectionCount = () => {
    if (!selectionCount) {
      return;
    }

    const selectedCount = Array.from(getBodyCheckboxes()).filter((box) => box.checked).length;
    const label = selectedCount === 1 ? 'app' : 'apps';
    selectionCount.textContent = `${selectedCount} ${label} selected`;
  };

  const handleProceedState = () => {
    const checkboxes = getBodyCheckboxes();
    const hasSelection = Array.from(checkboxes).some((box) => box.checked);
    proceedButton.disabled = !hasSelection;
    proceedButton.setAttribute('aria-disabled', String(!hasSelection));
    updateSelectionCount();
  };

  const syncSelectAllState = () => {
    if (!headerCheckbox) {
      return;
    }

    const bodyCheckboxes = Array.from(getBodyCheckboxes());
    const allChecked = bodyCheckboxes.length > 0 && bodyCheckboxes.every((box) => box.checked);
    const someChecked = bodyCheckboxes.some((box) => box.checked);

    headerCheckbox.checked = allChecked;
    headerCheckbox.indeterminate = !allChecked && someChecked;
  };

  const handleHeaderToggle = (event) => {
    const bodyCheckboxes = getBodyCheckboxes();
    const shouldSelectAll = event.target.checked;

    bodyCheckboxes.forEach((box) => {
      box.checked = shouldSelectAll;
      const { appId, subId } = box.dataset;
      updateCachedSelectionState(subId, appId, shouldSelectAll);
    });

    persistResponses(cachedResponses);
    handleProceedState();
    syncSelectAllState();
  };

  const attachCheckboxListeners = () => {
    const checkboxes = getBodyCheckboxes();
    checkboxes.forEach((box) =>
      box.addEventListener('change', (event) => {
        const { appId, subId } = event.target.dataset;
        const isSelected = event.target.checked;

        updateCachedSelectionState(subId, appId, isSelected);
        persistResponses(cachedResponses);
        handleProceedState();
        syncSelectAllState();
      }),
    );

    if (headerCheckbox && !headerToggleBound) {
      headerCheckbox.addEventListener('change', handleHeaderToggle);
      headerToggleBound = true;
    }

    handleProceedState();
    syncSelectAllState();
  };

  const populateTableFromResponses = (responses, emptyStateMessage = 'No app data available.') => {
    tableBody.innerHTML = '';
    rows.length = 0;
    renderedRows.length = 0;

    responses.forEach(({ subId, response, selectionState }) => {
      const appIds = extractAppIds(response);

      if (!appIds.length) {
        rows.push({ subId, appId: 'No apps returned', appName: '' });
        return;
      }

      appIds.forEach((appId) => {
        const normalizedAppId = normalizeAppId(appId);
        const previousSelection = selectionState?.[normalizedAppId];
        const appName =
          getManualAppName(manualAppNames, subId, normalizedAppId) || previousSelection?.appName || '';

        rows.push({ subId, appId: normalizedAppId, appName });
      });
    });

    if (!rows.length) {
      const row = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 4;
      emptyCell.textContent = emptyStateMessage;
      row.appendChild(emptyCell);
      tableBody.appendChild(row);
      proceedButton.disabled = true;
      proceedButton.setAttribute('aria-disabled', 'true');
      updateSelectionCount();
      return;
    }

    rows.forEach((rowData, index) => {
      const row = document.createElement('tr');

      const subIdCell = document.createElement('td');
      subIdCell.dataset.label = 'Sub ID';
      subIdCell.textContent = rowData.subId;

      const { cell: appNameCell, appNameButton } = buildAppNameCell(rowData, openAppNameModal);

      const appIdCell = document.createElement('td');
      appIdCell.dataset.label = 'App ID';
      appIdCell.textContent = rowData.appId;
      appIdCell.title = rowData.appName ? `App name: ${rowData.appName}` : '';

      const checkboxCell = document.createElement('td');
      checkboxCell.className = 'checkbox-cell';
      const checkbox = buildCheckbox(rowData.subId, index);
      checkbox.dataset.appId = rowData.appId;
      checkbox.dataset.subId = rowData.subId;

      const matchingEntry = cachedResponses.find((entry) => entry.subId === rowData.subId);
      const isSelected = matchingEntry?.selectionState?.[rowData.appId]?.selected === 1;
      checkbox.checked = isSelected;

      checkboxCell.appendChild(checkbox);

      row.append(subIdCell, appNameCell, appIdCell, checkboxCell);
      tableBody.appendChild(row);
      renderedRows.push({ rowData, appNameButton, appIdCell });
    });

    attachCheckboxListeners();
    syncSelectAllState();
  };

  const renderLaunchDataRows = (rows) => {
    tableBody.innerHTML = '';

    if (!rows.length) {
      proceedButton.disabled = true;
      proceedButton.setAttribute('aria-disabled', 'true');
      updateSelectionCount();
      return;
    }

    rows.forEach(({ subId }) => {
      const row = document.createElement('tr');

      const subIdCell = document.createElement('td');
      subIdCell.dataset.label = 'Sub ID';
      subIdCell.textContent = subId;

      const appNameCell = document.createElement('td');
      appNameCell.dataset.label = 'App Name';
      appNameCell.textContent = 'Loading…';

      const loadingCell = document.createElement('td');
      loadingCell.dataset.label = 'App ID';
      loadingCell.textContent = 'Loading apps…';

      const placeholderCheckboxCell = document.createElement('td');
      placeholderCheckboxCell.className = 'checkbox-cell';
      placeholderCheckboxCell.textContent = '—';

      row.append(subIdCell, appNameCell, loadingCell, placeholderCheckboxCell);
      tableBody.appendChild(row);
    });

    proceedButton.disabled = true;
    proceedButton.setAttribute('aria-disabled', 'true');
    updateSelectionCount();
  };

  const fetchAndPopulate = async (windowDays = currentWindowDays) => {
    const requestToken = ++activeRequestToken;
    const isActiveRequest = () => requestToken === activeRequestToken;
    isFetching = true;

    try {
      clearPendingCallQueue();
      resetCachedResponses();
      currentWindowDays = Number(windowDays) || defaultWindowDays;

      if (windowSelect && windowSelect.value !== String(currentWindowDays)) {
        windowSelect.value = String(currentWindowDays);
      }

      const storedRows = parseStoredLaunchData();

      if (!isActiveRequest()) {
        return;
      }

      renderLaunchDataRows(storedRows);

      if (!storedRows.length) {
        showError('API information not found.');
        statusBanner.render({ message: 'Unable to load apps: missing SubID launch data.', tone: 'warning' });
        proceedButton.disabled = true;
        proceedButton.setAttribute('aria-disabled', 'true');
        return;
      }

      clearError();
      refreshProgressFromQueue();

      const responses = [];
      const failedSubIds = [];
      const timeoutSubIds = [];
      let emptyStateMessage = 'No app data available.';
      let errorMessage = '';

      for (const entry of storedRows) {
        const queueEntry = registerPendingCall({
          ...entry,
          queueKey: `app-selection::${entry.subId || entry.domain || entry.integrationKey || 'unknown'}`,
          operation: 'appSelection',
        });

        const updatePendingQueue = (plannedCount) => {
          if (!isActiveRequest()) {
            return;
          }

          const previousCount = Math.max(1, Number(queueEntry?.requestCount) || 1);
          const normalizedCount = Math.max(previousCount, Number(plannedCount) || 0, 1);
          updatePendingCallRequestCount(queueEntry, normalizedCount);
          refreshProgressFromQueue();
        };

        const handleRequestsPlanned = () => {
          if (!isActiveRequest()) {
            return;
          }

          refreshProgressFromQueue();
        };

        const handleRequestsSettled = (settledCount) => {
          if (!isActiveRequest()) {
            return;
          }

          if (settledCount) {
            updatePendingQueue(settledCount);
          }
          refreshProgressFromQueue();
        };

        markPendingCallStarted(queueEntry);
        let response;
        try {
          response = await fetchAppsForEntry(entry, currentWindowDays, undefined, {
            onRequestsPlanned: handleRequestsPlanned,
            onRequestsSettled: handleRequestsSettled,
            updatePendingQueue,
          });
        } catch (error) {
          response = { errorType: 'failed', errorHint: error?.message, requestCount: 1 };
        }

        const finalizePendingCall = (status, errorHint = '', requestCount = response?.requestCount) => {
          const normalizedCount = Math.max(1, requestCount || queueEntry?.requestCount || 1);
          updatePendingCallRequestCount(queueEntry, normalizedCount);
          resolvePendingCall(queueEntry, status, errorHint || '');
          refreshProgressFromQueue();
        };

        if (!isActiveRequest()) {
          finalizePendingCall('failed', 'Request superseded by a newer fetch.');
          return;
        }

        const subIdLabel = entry?.subId || 'unknown SubID';

        if (!response || response.errorType) {
          const targetList = response?.errorType === 'timeout' ? timeoutSubIds : failedSubIds;
          finalizePendingCall('failed', response?.errorHint || response?.errorType);
          targetList.push({ label: subIdLabel, hint: response?.errorHint });
          continue;
        }

        finalizePendingCall('completed', '', response?.requestCount);
        responses.push({ ...entry, response, windowDays: currentWindowDays });
      }

      refreshProgressFromQueue();

      if (!isActiveRequest()) {
        return;
      }

      const successfulResponses = responses.filter(({ response }) => Boolean(response));
      const mergedResponses = mergeAppResponsesBySubId(successfulResponses);

      cachedResponses = buildSelectionState(mergedResponses, manualAppNames);

      if (cachedResponses.length) {
        persistResponses(cachedResponses);
      } else {
        sessionStorage.removeItem(responseStorageKey);
      }

      if (!isActiveRequest()) {
        return;
      }

      const messages = [];

      if (timeoutSubIds.length) {
        const uniqueTimeouts = Array.from(new Set(timeoutSubIds.map(({ label }) => label)));
        const timeoutList = uniqueTimeouts.join(', ');
        messages.push(`Unable to load apps for ${timeoutList}, due to a timeout error.`);
      }

      if (failedSubIds.length) {
        const corsFailures = failedSubIds.filter(({ hint }) =>
          typeof hint === 'string' && hint.toLowerCase().includes('cors/preflight blocked'),
        );
        const otherFailures = failedSubIds.filter((item) => !corsFailures.includes(item));

        if (corsFailures.length) {
          const uniqueCorsSubIds = Array.from(new Set(corsFailures.map(({ label }) => label)));
          const corsList = uniqueCorsSubIds.join(', ');
          messages.push(
            `Unable to load apps for ${corsList}. CORS/preflight blocked—check browser permissions or proxy configuration.`,
          );
        }

        if (otherFailures.length) {
          const uniqueSubIds = Array.from(new Set(otherFailures.map(({ label }) => label)));
          const errorList = uniqueSubIds.join(', ');
          messages.push(`Unable to load apps for ${errorList}. Check your integration key or retry.`);
        }
      }

      if (messages.length) {
        const combinedMessage = messages.join(' ');

        statusBanner.render({ message: combinedMessage, tone: 'warning' });

        if (!successfulResponses.length) {
          errorMessage = combinedMessage;
          emptyStateMessage = 'No app data available due to request errors.';
        }
      }

      if (errorMessage) {
        showError(errorMessage);
      }

      populateTableFromResponses(cachedResponses, emptyStateMessage);
    } finally {
      if (isActiveRequest()) {
        isFetching = false;
      }
    }
  };

  openAppNameModal = await setupManualAppNameModal(
    manualAppNames,
    rows,
    getRenderedRows,
    syncCachedAppName,
  );

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
      const appName =
        getManualAppName(manualAppNames, subId, normalizedAppId) ||
        sourceEntry.selectionState?.[normalizedAppId]?.appName ||
        normalizedAppId;

      if (sourceEntry && filteredResponse) {
        const updatedSelectionState = {
          ...(sourceEntry.selectionState || {}),
          [normalizedAppId]: {
            appId: normalizedAppId,
            appName,
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

  if (windowSelect) {
    windowSelect.addEventListener('change', () => {
      fetchAndPopulate(Number(windowSelect.value) || defaultWindowDays);
    });
  }

  attachCheckboxListeners();
  fetchAndPopulate(currentWindowDays);
};
