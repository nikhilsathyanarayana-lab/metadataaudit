import {
  buildChunkedMetadataFieldPayloads,
  buildMetadataFieldsForAppPayload,
  postAggregationWithIntegrationKey,
} from '../services/requests.js';
import { loadTemplate } from '../controllers/modalLoader.js';

const LOOKBACK_WINDOWS = [180, 30, 7];
const RESPONSE_TOO_LARGE_MESSAGE = /too many data files/i;
const OVER_LIMIT_CLASS = 'metadata-limit-exceeded';
const storageKey = 'appSelectionResponses';
const manualAppNameStorageKey = 'manualAppNames';
let manualAppNameCache = null;
let metadataFieldsReadyPromise = Promise.resolve();

const setupProgressTracker = (initialTotalCalls) => {
  const progressText = document.getElementById('metadata-fields-progress-text');
  let totalCalls = initialTotalCalls;

  const updateText = (completed) => {
    if (!progressText) {
      return;
    }

    if (!totalCalls) {
      progressText.textContent = 'No API calls to make.';
      return;
    }

    const boundedCompleted = Math.min(completed, totalCalls);
    progressText.textContent = `API calls: ${boundedCompleted}/${totalCalls}`;
  };

  const addCalls = (additionalCalls) => {
    if (!Number.isFinite(additionalCalls) || additionalCalls <= 0) {
      return;
    }

    totalCalls += additionalCalls;
  };

  updateText(0);

  return { updateText, addCalls, getTotalCalls: () => totalCalls };
};

const createMessageRegion = () => {
  const existing = document.getElementById('metadata-fields-messages');
  if (existing) {
    return existing;
  }

  const region = document.createElement('div');
  region.id = 'metadata-fields-messages';
  region.className = 'page-messages';

  const mainContent = document.querySelector('main.content');
  mainContent?.parentNode?.insertBefore(region, mainContent);
  return region;
};

const showMessage = (region, message, tone = 'info') => {
  if (!region) {
    return;
  }

  const alert = document.createElement('p');
  alert.className = tone === 'error' ? 'alert' : 'status-banner';
  alert.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  alert.textContent = message;

  region.innerHTML = '';
  region.appendChild(alert);
};

const parseStoredSelection = () => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry?.subId && entry?.domain && entry?.integrationKey)
      : [];
  } catch (error) {
    console.error('Unable to parse stored app selection data:', error);
    return [];
  }
};

const loadManualAppNames = () => {
  if (manualAppNameCache instanceof Map) {
    return manualAppNameCache;
  }

  try {
    const raw = localStorage.getItem(manualAppNameStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    const entries = parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
    manualAppNameCache = new Map(entries);
  } catch (error) {
    console.error('Unable to parse manual app names:', error);
    manualAppNameCache = new Map();
  }

  return manualAppNameCache;
};

const persistManualAppNames = (appNameMap) => {
  if (!(appNameMap instanceof Map)) {
    return;
  }

  const serialized = Object.fromEntries(appNameMap.entries());
  localStorage.setItem(manualAppNameStorageKey, JSON.stringify(serialized));
};

const extractAppNames = (apiResponse) => {
  if (!apiResponse) {
    return new Map();
  }

  const candidateLists = [apiResponse?.results, apiResponse?.data, apiResponse?.apps];

  if (Array.isArray(apiResponse)) {
    candidateLists.push(apiResponse);
  }

  const flattened = candidateLists.filter(Array.isArray).flat();
  const appNameMap = new Map();

  flattened.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || !entry.appId) {
      return;
    }

    const candidateName = entry.appName || entry.name || entry.label || entry.title;
    if (candidateName) {
      appNameMap.set(entry.appId, candidateName);
    }
  });

  return appNameMap;
};

const extractAppIds = (apiResponse) => {
  if (!apiResponse) {
    return [];
  }

  const candidateLists = [apiResponse?.results, apiResponse?.data, apiResponse?.apps];

  if (Array.isArray(apiResponse)) {
    candidateLists.push(apiResponse);
  }

  const flattened = candidateLists.filter(Array.isArray).flat();

  const appIds = flattened
    .map((entry) => {
      if (typeof entry === 'string' || typeof entry === 'number') {
        return entry;
      }

      if (entry?.appId) {
        return entry.appId;
      }

      return null;
    })
    .filter(Boolean);

  return Array.from(new Set(appIds));
};

const buildAppEntries = (manualAppNames) => {
  const storedResponses = parseStoredSelection();
  const entries = [];

  storedResponses.forEach((record) => {
    const appNames = extractAppNames(record.response);
    const appIds = extractAppIds(record.response);
    appIds.forEach((appId) => {
      const manualAppName = manualAppNames?.get(appId);
      const resolvedAppName = manualAppName || appNames.get(appId);
      entries.push({
        subId: record.subId,
        appId,
        appName: resolvedAppName,
        domain: record.domain,
        integrationKey: record.integrationKey,
      });
    });
  });

  return entries;
};

const buildLoadingCell = (label) => {
  const cell = document.createElement('td');
  cell.dataset.label = label;
  cell.textContent = 'Loading…';
  return cell;
};

const renderTableRows = (tableBody, entries) => {
  tableBody.innerHTML = '';

  if (!entries.length) {
    const row = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 6;
    emptyCell.textContent = 'No app selections available.';
    row.appendChild(emptyCell);
    tableBody.appendChild(row);
    return [];
  }

  return entries.map((entry) => {
    const row = document.createElement('tr');

    const subIdCell = document.createElement('td');
    subIdCell.dataset.label = 'Sub ID';
    subIdCell.textContent = entry.subId;

    const appNameCell = document.createElement('td');
    appNameCell.dataset.label = 'App Name';

    const appNameButton = document.createElement('button');
    appNameButton.type = 'button';
    appNameButton.className = 'app-name-button';
    appNameButton.textContent = entry.appName || 'Not set';

    appNameCell.appendChild(appNameButton);

    const appIdCell = document.createElement('td');
    appIdCell.dataset.label = 'App ID';
    appIdCell.textContent = entry.appId;

    const windowCells = LOOKBACK_WINDOWS.reduce((acc, windowDays) => {
      const cell = buildLoadingCell(`${windowDays} days`);
      acc[windowDays] = cell;
      return acc;
    }, {});

    row.append(
      subIdCell,
      appNameCell,
      appIdCell,
      ...LOOKBACK_WINDOWS.map((windowDays) => windowCells[windowDays]),
    );
    tableBody.appendChild(row);

    return { entry, cells: windowCells, appNameButton };
  });
};

const populateAppNameCells = (rows, entry, appName) => {
  const label = appName || 'Not set';
  rows
    .filter((row) => row.entry === entry)
    .forEach(({ appNameButton }) => {
      if (appNameButton) {
        appNameButton.textContent = label;
      }
    });
};

const updateManualAppNameFeedback = (tone, message) => {
  const feedback = document.getElementById('app-name-modal-feedback');

  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = tone === 'error' ? 'alert' : 'status-banner';
  feedback.setAttribute('role', tone === 'error' ? 'alert' : 'status');
};

const setupManualAppNameModal = async (manualAppNames, entries, allRows) => {
  if (!document.getElementById('app-name-modal')) {
    await loadTemplate('Modals/app-name-modal.html');
  }

  const modal = document.getElementById('app-name-modal');
  const backdrop = document.getElementById('app-name-backdrop');
  const form = document.getElementById('app-name-modal-form');
  const appIdTarget = document.getElementById('app-name-modal-app-id');
  const appNameInput = document.getElementById('app-name-modal-input');
  const closeButtons = modal?.querySelectorAll('[data-close-app-name-modal]') || [];

  if (!modal || !backdrop || !form || !appIdTarget || !appNameInput) {
    return () => {};
  }

  let activeEntry = null;

  const closeModal = () => {
    modal.classList.remove('is-visible');
    backdrop.classList.remove('is-visible');
    modal.hidden = true;
    backdrop.hidden = true;
    form.reset();
    activeEntry = null;
    updateManualAppNameFeedback('info', '');
  };

  const openModal = (entry) => {
    activeEntry = entry;
    appIdTarget.textContent = entry?.appId || '';
    const existingName = entry?.appName || manualAppNames.get(entry?.appId) || '';
    appNameInput.value = existingName;
    updateManualAppNameFeedback('info', existingName ? 'Update the app name if needed.' : 'Enter an app name.');

    modal.hidden = false;
    backdrop.hidden = false;
    modal.classList.add('is-visible');
    backdrop.classList.add('is-visible');
    appNameInput.focus();
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!activeEntry) {
      updateManualAppNameFeedback('error', 'Select a row to set an app name.');
      return;
    }

    const appName = appNameInput.value.trim();

    if (!appName) {
      updateManualAppNameFeedback('error', 'Provide an App Name.');
      return;
    }

    manualAppNames.set(activeEntry.appId, appName);
    persistManualAppNames(manualAppNames);

    entries
      .filter((entry) => entry.appId === activeEntry.appId)
      .forEach((entry) => {
        entry.appName = appName;
        populateAppNameCells(allRows, entry, appName);
      });

    updateManualAppNameFeedback('info', `Saved app name for ${activeEntry.appId}.`);
    closeModal();
  };

  form.addEventListener('submit', handleSubmit);
  backdrop.addEventListener('click', closeModal);
  closeButtons.forEach((button) => button.addEventListener('click', closeModal));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-visible')) {
      closeModal();
    }
  });

  return openModal;
};

const parseMetadataFields = (apiResponse) => {
  const candidateArrays = [apiResponse?.results, apiResponse?.data];
  if (Array.isArray(apiResponse)) {
    candidateArrays.push(apiResponse);
  }

  const flattened = candidateArrays.filter(Array.isArray).flat();
  const visitorFields = new Set();
  const accountFields = new Set();

  flattened.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const visitorList = Array.isArray(item.visitorMetadata) ? item.visitorMetadata : [];
    const accountList = Array.isArray(item.accountMetadata) ? item.accountMetadata : [];

    visitorList.forEach((field) => visitorFields.add(field));
    accountList.forEach((field) => accountFields.add(field));
  });

  return {
    visitorFields: Array.from(visitorFields),
    accountFields: Array.from(accountFields),
  };
};

const updateCellContent = (cell, fields, label) => {
  if (!cell) {
    return;
  }

  if (!fields?.length) {
    cell.textContent = `No ${label} metadata`;
    return;
  }

  cell.textContent = fields.join(', ');
};

const fetchAndPopulate = async (
  entries,
  visitorRows,
  accountRows,
  messageRegion,
  updateProgress,
  addTotalCalls,
) => {
  let completedCalls = 0;

  for (const entry of entries) {
    const visitorCells = visitorRows.find((row) => row.entry === entry)?.cells;
    const accountCells = accountRows.find((row) => row.entry === entry)?.cells;

    if (!visitorCells || !accountCells) {
      continue;
    }

    let abortRemainingWindows = false;

    for (const windowDays of LOOKBACK_WINDOWS) {
      if (abortRemainingWindows) {
        break;
      }

      let baseRequestAttempted = false;

      try {
        const payload = buildMetadataFieldsForAppPayload(entry.appId, windowDays);
        const response = await postAggregationWithIntegrationKey(entry, payload);
        const { visitorFields, accountFields } = parseMetadataFields(response);

        baseRequestAttempted = true;
        updateCellContent(visitorCells[windowDays], visitorFields, 'visitor');
        updateCellContent(accountCells[windowDays], accountFields, 'account');

        visitorCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
        accountCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
      } catch (error) {
        baseRequestAttempted = true;
        const errorMessage = error?.message || 'Unable to fetch metadata fields.';
        const statusMatch = errorMessage.match(/\((\d{3})\)/);
        const statusCode = Number(statusMatch?.[1]) || null;
        const tooMuchData = statusCode === 413 || RESPONSE_TOO_LARGE_MESSAGE.test(errorMessage || '');
        const clientErrorWithoutRecovery = !tooMuchData && statusCode >= 400 && statusCode < 500;
        const cellMessage = tooMuchData ? 'too much data' : 'Error fetching data';
        let handledByChunks = false;

        if (tooMuchData) {
          const chunkedPayloads = buildChunkedMetadataFieldPayloads(entry.appId, windowDays);
          const aggregatedResults = [];

          addTotalCalls(chunkedPayloads.length);
          updateProgress(completedCalls);

          try {
            for (const chunkedPayload of chunkedPayloads) {
              const chunkResponse = await postAggregationWithIntegrationKey(entry, chunkedPayload);

              if (Array.isArray(chunkResponse?.results)) {
                aggregatedResults.push(...chunkResponse.results);
              } else if (Array.isArray(chunkResponse?.data)) {
                aggregatedResults.push(...chunkResponse.data);
              } else if (Array.isArray(chunkResponse)) {
                aggregatedResults.push(...chunkResponse);
              }

              completedCalls += 1;
              updateProgress(completedCalls);
            }

            const { visitorFields, accountFields } = parseMetadataFields(aggregatedResults);

            updateCellContent(visitorCells[windowDays], visitorFields, 'visitor');
            updateCellContent(accountCells[windowDays], accountFields, 'account');

            visitorCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
            accountCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
            handledByChunks = true;
          } catch (chunkError) {
            console.error('Chunked metadata field request failed:', chunkError);
          }
        } else {
          console.error('Metadata field request failed:', error);
        }

        if (!handledByChunks) {
          if (tooMuchData) {
            showMessage(
              messageRegion,
              `Metadata request too large for app ${entry.appId} (${windowDays}d). Try a smaller window.`,
              'error',
            );
          } else {
            const generalMessage = errorMessage?.trim() || 'Unable to fetch metadata fields.';
            showMessage(
              messageRegion,
              `Metadata request failed for app ${entry.appId} (${windowDays}d): ${generalMessage}`,
              'error',
            );
          }

          updateCellContent(visitorCells[windowDays], [], 'visitor');
          updateCellContent(accountCells[windowDays], [], 'account');
          visitorCells[windowDays].textContent = cellMessage;
          accountCells[windowDays].textContent = cellMessage;
          visitorCells[windowDays].classList.toggle(OVER_LIMIT_CLASS, tooMuchData);
          accountCells[windowDays].classList.toggle(OVER_LIMIT_CLASS, tooMuchData);
        }

        if (clientErrorWithoutRecovery) {
          abortRemainingWindows = true;
        }
      }

      if (baseRequestAttempted) {
        completedCalls += 1;
        updateProgress(completedCalls);
      }
    }
  }
};

export const initMetadataFields = () => {
  metadataFieldsReadyPromise = (async () => {
    const visitorTableBody = document.getElementById('visitor-metadata-table-body');
    const accountTableBody = document.getElementById('account-metadata-table-body');

    if (!visitorTableBody || !accountTableBody) {
      return;
    }

    const messageRegion = createMessageRegion();
    const manualAppNames = loadManualAppNames();
    const entries = buildAppEntries(manualAppNames);

    const totalCalls = entries.length * LOOKBACK_WINDOWS.length;
    const { updateText: updateProgress, addCalls: addTotalCalls } = setupProgressTracker(totalCalls);

    if (!entries.length) {
      showMessage(messageRegion, 'No application data available. Start from the SubID form.', 'error');
      renderTableRows(visitorTableBody, []);
      renderTableRows(accountTableBody, []);
      updateProgress(0);
      return;
    }

    const visitorRows = renderTableRows(visitorTableBody, entries);
    const accountRows = renderTableRows(accountTableBody, entries);
    const allRows = [...visitorRows, ...accountRows];

    entries.forEach((entry) => {
      if (entry.appName) {
        populateAppNameCells(allRows, entry, entry.appName);
      }
    });

    const openAppNameModal = await setupManualAppNameModal(manualAppNames, entries, allRows);

    if (typeof openAppNameModal === 'function') {
      allRows.forEach(({ entry, appNameButton }) => {
        if (appNameButton) {
          appNameButton.addEventListener('click', () => openAppNameModal(entry));
          appNameButton.setAttribute('aria-label', `Set app name for ${entry.appId}`);
        }
      });
    }

    await fetchAndPopulate(
      entries,
      visitorRows,
      accountRows,
      messageRegion,
      updateProgress,
      addTotalCalls,
    );
  })();

  return metadataFieldsReadyPromise;
};

export const waitForMetadataFields = () => metadataFieldsReadyPromise;
