import { postAggregationWithIntegrationKey } from '../../src/services/requests/network.js';

const APP_LISTING_PAYLOAD = Object.freeze({
  response: {
    location: 'request',
    mimeType: 'application/json',
  },
  request: {
    pipeline: [
      {
        source: {
          apps: {},
        },
      },
      {
        select: {
          appId: 'appId',
          appName: 'name',
        },
      },
      {
        sort: ['appId'],
      },
    ],
  },
});

let credentialEntries = Array.isArray(window?.appCredentials) ? window.appCredentials : [];

// Clean up credential inputs and drop empty entries.
const normalizeCredentials = (entries = []) =>
  entries
    .filter((entry) => entry && (entry.subId || entry.domain || entry.integrationKey))
    .map((entry) => ({
      subId: entry.subId || '',
      domain: entry.domain || '',
      integrationKey: entry.integrationKey || '',
    }));

// Persist normalized credentials for later API calls.
export const setAppCredentials = (entries = []) => {
  credentialEntries = normalizeCredentials(entries);
};

// Return normalized credentials using overrides or window defaults.
const getCredentials = (override) => {
  const normalized = normalizeCredentials(override ?? credentialEntries);

  if (normalized.length) {
    return normalized;
  }

  const windowCredentials = normalizeCredentials(window?.appCredentials || []);
  return windowCredentials;
};

// Create a table row describing a loading or error state.
const createStatusRow = (message, subId = '') => {
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 4;
  cell.textContent = subId ? `${message} (${subId})` : message;
  row.appendChild(cell);
  return row;
};

// Build a table row for a single app listing.
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
  checkbox.setAttribute('aria-label', `Select app ${appId || 'unknown'} for ${subId || 'unknown SubID'}`);
  checkboxCell.appendChild(checkbox);

  row.append(subIdCell, nameCell, appIdCell, checkboxCell);
  return row;
};

// Load app listings for each credential set and render them into the table.
export async function app_names(entries) {
  const tableBody = document.querySelector('[data-page-section="2"] tbody');

  if (!tableBody) {
    return;
  }

  tableBody.innerHTML = '';
  const credentials = getCredentials(entries);

  if (!credentials.length) {
    tableBody.appendChild(createStatusRow('No credentials available for app discovery.'));
    return;
  }

  for (const credential of credentials) {
    const loadingRow = createStatusRow('Loading apps...', credential.subId);
    tableBody.appendChild(loadingRow);

    let response;
    try {
      response = await postAggregationWithIntegrationKey(
        credential,
        JSON.parse(JSON.stringify(APP_LISTING_PAYLOAD)),
      );
    } catch (error) {
      response = { errorType: 'failed', errorHint: error?.message };
    }

    loadingRow.remove();

    const results = response?.results
      || response?.response?.results
      || response?.data?.results
      || response?.response?.data?.results;

    if (!response || response.errorType || !Array.isArray(results)) {
      const hint = response?.errorHint ? `: ${response.errorHint}` : '';
      tableBody.appendChild(
        createStatusRow(`Unable to load apps for ${credential.subId || 'unknown SubID'}${hint}`),
      );
      continue;
    }

    if (!results.length) {
      tableBody.appendChild(createStatusRow('No apps returned for SubID.', credential.subId));
      continue;
    }

    results.forEach((app) => {
      tableBody.appendChild(
        createAppRow({
          subId: credential.subId,
          appId: app?.appId || '',
          appName: app?.appName || app?.appId || '',
        }),
      );
    });
  }
}
