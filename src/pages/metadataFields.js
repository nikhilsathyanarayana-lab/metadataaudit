import {
  buildMetadataFieldsForAppPayload,
  postAggregationWithIntegrationKey,
} from '../services/requests.js';

const LOOKBACK_WINDOWS = [180, 30, 7];
const RESPONSE_TOO_LARGE_MESSAGE = /too many data files/i;
const storageKey = 'appSelectionResponses';

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
    const appIds = extractAppIds(record.response);
    appIds.forEach((appId) => {
      entries.push({
        subId: record.subId,
        appId,
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
    emptyCell.colSpan = 5;
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

    const appIdCell = document.createElement('td');
    appIdCell.dataset.label = 'App ID';
    appIdCell.textContent = entry.appId;

    const windowCells = LOOKBACK_WINDOWS.reduce((acc, windowDays) => {
      const cell = buildLoadingCell(`${windowDays} days`);
      acc[windowDays] = cell;
      return acc;
    }, {});

    row.append(subIdCell, appIdCell, ...LOOKBACK_WINDOWS.map((windowDays) => windowCells[windowDays]));
    tableBody.appendChild(row);

    return { entry, cells: windowCells };
  });
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

const fetchAndPopulate = async (entries, visitorRows, accountRows, messageRegion) => {
  for (const entry of entries) {
    const visitorCells = visitorRows.find((row) => row.entry === entry)?.cells;
    const accountCells = accountRows.find((row) => row.entry === entry)?.cells;

    if (!visitorCells || !accountCells) {
      continue;
    }

    for (const windowDays of LOOKBACK_WINDOWS) {
      try {
        const payload = buildMetadataFieldsForAppPayload(entry.appId, windowDays);
        const response = await postAggregationWithIntegrationKey(entry, payload);
        const { visitorFields, accountFields } = parseMetadataFields(response);

        updateCellContent(visitorCells[windowDays], visitorFields, 'visitor');
        updateCellContent(accountCells[windowDays], accountFields, 'account');
      } catch (error) {
        const errorMessage = error?.message || 'Unable to fetch metadata fields.';
        const tooMuchData = RESPONSE_TOO_LARGE_MESSAGE.test(errorMessage || '');
        const cellMessage = tooMuchData ? 'too much data' : 'Error fetching data';

        if (!tooMuchData) {
          console.error('Metadata field request failed:', error);
          showMessage(
            messageRegion,
            `Metadata request failed for app ${entry.appId} (${windowDays}d): ${errorMessage}`,
            'error',
          );
        }

        updateCellContent(visitorCells[windowDays], [], 'visitor');
        updateCellContent(accountCells[windowDays], [], 'account');
        visitorCells[windowDays].textContent = cellMessage;
        accountCells[windowDays].textContent = cellMessage;
      }
    }
  }
};

export const initMetadataFields = () => {
  const visitorTableBody = document.getElementById('visitor-metadata-table-body');
  const accountTableBody = document.getElementById('account-metadata-table-body');

  if (!visitorTableBody || !accountTableBody) {
    return;
  }

  const messageRegion = createMessageRegion();
  const entries = buildAppEntries();

  if (!entries.length) {
    showMessage(messageRegion, 'No application data available. Start from the SubID form.', 'error');
    renderTableRows(visitorTableBody, []);
    renderTableRows(accountTableBody, []);
    return;
  }

  const visitorRows = renderTableRows(visitorTableBody, entries);
  const accountRows = renderTableRows(accountTableBody, entries);

  fetchAndPopulate(entries, visitorRows, accountRows, messageRegion);
};
