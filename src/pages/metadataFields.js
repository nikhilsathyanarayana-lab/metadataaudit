import {
  buildMetadataFieldsForAppPayload,
  postAggregationWithIntegrationKey,
  fetchAppNameById,
} from '../services/requests.js';

const LOOKBACK_WINDOWS = [180, 30, 7];
const RESPONSE_TOO_LARGE_MESSAGE = /too many data files/i;
const OVER_LIMIT_CLASS = 'metadata-limit-exceeded';
const storageKey = 'appSelectionResponses';
let metadataFieldsReadyPromise = Promise.resolve();

const setupProgressTracker = (totalCalls) => {
  const progressText = document.getElementById('metadata-fields-progress-text');

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

  updateText(0);

  return updateText;
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

const buildAppEntries = () => {
  const storedResponses = parseStoredSelection();
  const entries = [];

  storedResponses.forEach((record) => {
    const appNames = extractAppNames(record.response);
    const appIds = extractAppIds(record.response);
    appIds.forEach((appId) => {
      entries.push({
        subId: record.subId,
        appId,
        appName: appNames.get(appId),
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
    appNameCell.textContent = entry.appName || 'Loading app name…';

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

    return { entry, cells: windowCells, appNameCell };
  });
};

const populateAppNameCells = (rows, entry, appName) => {
  const label = appName || '';
  rows
    .filter((row) => row.entry === entry)
    .forEach(({ appNameCell }) => {
      if (appNameCell) {
        appNameCell.textContent = label;
      }
    });
};

const populateAppNames = async (entries, visitorRows, accountRows, messageRegion) => {
  const appNamePromises = new Map();
  const allRows = [...visitorRows, ...accountRows];

  entries.forEach((entry) => {
    if (entry.appName) {
      populateAppNameCells(allRows, entry, entry.appName);
    }
  });

  const pendingLookups = entries
    .filter((entry) => !entry.appName)
    .map((entry) => {
      if (!appNamePromises.has(entry.appId)) {
        appNamePromises.set(entry.appId, fetchAppNameById(entry, entry.appId));
      }

      return appNamePromises.get(entry.appId).then((resolvedName) => {
        if (!resolvedName) {
          return populateAppNameCells(allRows, entry, entry.appName || '');
        }

        entry.appName = resolvedName;
        populateAppNameCells(allRows, entry, resolvedName);
        return resolvedName;
      });
    });

  try {
    await Promise.all(pendingLookups);
  } catch (error) {
    console.error('Unable to populate app names:', error);
    showMessage(messageRegion, 'Unable to fetch app names for some entries.', 'error');
  }
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

const fetchAndPopulate = async (entries, visitorRows, accountRows, messageRegion, updateProgress) => {
  let completedCalls = 0;

  for (const entry of entries) {
    const visitorCells = visitorRows.find((row) => row.entry === entry)?.cells;
    const accountCells = accountRows.find((row) => row.entry === entry)?.cells;

    if (!visitorCells || !accountCells) {
      continue;
    }

    for (const windowDays of LOOKBACK_WINDOWS) {
      const sliceOffsets = windowDays === 180 ? [0, 30, 60, 90, 120, 150] : [0];
      const sliceWindow = windowDays === 180 ? 30 : windowDays;
      const aggregatedVisitorFields = new Set();
      const aggregatedAccountFields = new Set();
      let tooMuchData = false;
      let encounteredError = false;

      const slicePayloads = sliceOffsets.map((offset) => ({
        offset,
        payload: buildMetadataFieldsForAppPayload(entry.appId, sliceWindow, offset),
      }));

      for (const { offset, payload } of slicePayloads) {
        try {
          const response = await postAggregationWithIntegrationKey(entry, payload);
          const { visitorFields, accountFields } = parseMetadataFields(response);

          visitorFields.forEach((field) => aggregatedVisitorFields.add(field));
          accountFields.forEach((field) => aggregatedAccountFields.add(field));

          visitorCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
          accountCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
        } catch (error) {
          const errorMessage = error?.message || 'Unable to fetch metadata fields.';
          const sliceTooMuchData = RESPONSE_TOO_LARGE_MESSAGE.test(errorMessage || '');

          tooMuchData = tooMuchData || sliceTooMuchData;
          encounteredError = true;

          if (!sliceTooMuchData) {
            console.error('Metadata field request failed:', error);
            showMessage(
              messageRegion,
              `Metadata request failed for app ${entry.appId} (${windowDays}d): ${errorMessage}`,
              'error',
            );
          }
        }

        completedCalls += 1;
        updateProgress(completedCalls);
      }

      if (encounteredError) {
        const cellMessage = tooMuchData ? 'too much data' : 'Error fetching data';
        updateCellContent(visitorCells[windowDays], [], 'visitor');
        updateCellContent(accountCells[windowDays], [], 'account');
        visitorCells[windowDays].textContent = cellMessage;
        accountCells[windowDays].textContent = cellMessage;
        visitorCells[windowDays].classList.toggle(OVER_LIMIT_CLASS, tooMuchData);
        accountCells[windowDays].classList.toggle(OVER_LIMIT_CLASS, tooMuchData);
        continue;
      }

      updateCellContent(
        visitorCells[windowDays],
        Array.from(aggregatedVisitorFields),
        'visitor',
      );
      updateCellContent(
        accountCells[windowDays],
        Array.from(aggregatedAccountFields),
        'account',
      );
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
    const entries = buildAppEntries();

    const callsPerEntry = LOOKBACK_WINDOWS.reduce(
      (total, windowDays) => total + (windowDays === 180 ? 6 : 1),
      0,
    );
    const totalCalls = entries.length * callsPerEntry;
    const updateProgress = setupProgressTracker(totalCalls);

    if (!entries.length) {
      showMessage(messageRegion, 'No application data available. Start from the SubID form.', 'error');
      renderTableRows(visitorTableBody, []);
      renderTableRows(accountTableBody, []);
      updateProgress(0);
      return;
    }

    const visitorRows = renderTableRows(visitorTableBody, entries);
    const accountRows = renderTableRows(accountTableBody, entries);

    const appNamePromise = populateAppNames(entries, visitorRows, accountRows, messageRegion);

    await fetchAndPopulate(entries, visitorRows, accountRows, messageRegion, updateProgress);
    await appNamePromise;
  })();

  return metadataFieldsReadyPromise;
};

export const waitForMetadataFields = () => metadataFieldsReadyPromise;
