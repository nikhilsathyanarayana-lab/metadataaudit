const metadataFieldStorageKey = 'metadataFieldRecords';
const metadataFieldStorageVersion = 1;
const appSelectionStorageKey = 'appSelectionResponses';
const LOOKBACK_WINDOWS = [180, 30, 7];

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

const loadAppSelections = () => {
  try {
    const raw = localStorage.getItem(appSelectionStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : [];

    return entries
      .filter((entry) => entry?.subId)
      .flatMap((entry) => {
        const appIds = extractAppIds(entry.response);

        if (!appIds.length) {
          return [];
        }

        return appIds.map((appId) => ({ subId: entry.subId, appId }));
      });
  } catch (error) {
    console.error('Unable to parse stored app selection data:', error);
    return [];
  }
};

const loadMetadataRecords = () => {
  try {
    const raw = localStorage.getItem(metadataFieldStorageKey);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    const records = parsed?.records;

    if (parsed?.version !== metadataFieldStorageVersion || !Array.isArray(records)) {
      return [];
    }

    return records.filter((record) => record?.appId && Number.isFinite(record?.windowDays));
  } catch (error) {
    console.error('Unable to parse stored metadata records:', error);
    return [];
  }
};

const groupMetadataByApp = (records) => {
  const grouped = new Map();

  records.forEach((record) => {
    const appId = record.appId;
    const existing = grouped.get(appId) || {
      appId,
      appName: record.appName || '',
      subId: record.subId || '',
      visitorCounts: {},
      accountCounts: {},
    };

    existing.appName = existing.appName || record.appName || '';
    existing.subId = existing.subId || record.subId || '';

    if (Array.isArray(record.visitorFields)) {
      existing.visitorCounts[record.windowDays] = record.visitorFields.length;
    }

    if (Array.isArray(record.accountFields)) {
      existing.accountCounts[record.windowDays] = record.accountFields.length;
    }

    grouped.set(appId, existing);
  });

  return Array.from(grouped.values());
};

const createEmptyRow = (tableBody, message) => {
  const row = document.createElement('tr');
  const emptyCell = document.createElement('td');
  emptyCell.colSpan = 6;
  emptyCell.textContent = message;
  row.appendChild(emptyCell);
  tableBody.appendChild(row);
};

const buildFormatSelect = (appId, subId, appName) => {
  const select = document.createElement('select');
  select.className = 'format-select';
  const labelParts = [`Sub ID ${subId || 'unknown'}`, `App ID ${appId}`];
  if (appName) {
    labelParts.push(`(${appName})`);
  }
  select.setAttribute('aria-label', `Expected format for ${labelParts.join(' ')}`);

  ['email', 'name', 'full name', 'phone number', 'unknown'].forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    if (value === 'unknown') {
      option.selected = true;
    }
    select.appendChild(option);
  });

  return select;
};

const renderTable = (tableBody, rows, type) => {
  tableBody.innerHTML = '';

  if (!rows.length) {
    createEmptyRow(tableBody, 'No deep-dive data available. Run metadata requests first.');
    return;
  }

  rows.forEach((rowData) => {
    const row = document.createElement('tr');
    const subIdCell = document.createElement('td');
    subIdCell.dataset.label = 'Sub ID';
    subIdCell.textContent = rowData.subId || 'Unknown';

    const appIdCell = document.createElement('td');
    appIdCell.dataset.label = 'App ID';
    appIdCell.textContent = rowData.appId;
    if (rowData.appName) {
      appIdCell.title = `App name: ${rowData.appName}`;
    }

    row.appendChild(subIdCell);
    row.appendChild(appIdCell);

    LOOKBACK_WINDOWS.forEach((windowDays) => {
      const countCell = document.createElement('td');
      countCell.dataset.label = `${windowDays} days`;
      const counts = type === 'visitor' ? rowData.visitorCounts : rowData.accountCounts;
      const value = counts?.[windowDays];
      countCell.textContent = Number.isFinite(value) ? value : '—';
      row.appendChild(countCell);
    });

    const formatCell = document.createElement('td');
    formatCell.dataset.label = 'Expected format';
    formatCell.appendChild(buildFormatSelect(rowData.appId, rowData.subId, rowData.appName));
    row.appendChild(formatCell);

    tableBody.appendChild(row);
  });
};

export const initDeepDive = () => {
  const visitorTableBody = document.getElementById('visitor-deep-dive-table-body');
  const accountTableBody = document.getElementById('account-deep-dive-table-body');

  if (!visitorTableBody || !accountTableBody) {
    return;
  }

  const metadataRecords = loadMetadataRecords();
  const groupedRecords = groupMetadataByApp(metadataRecords);

  let rows = groupedRecords;

  if (!rows.length) {
    const selections = loadAppSelections();
    const selectionRows = selections.map((entry) => ({
      appId: entry.appId,
      subId: entry.subId,
      visitorCounts: {},
      accountCounts: {},
    }));

    rows = selectionRows;
  }

  renderTable(visitorTableBody, rows, 'visitor');
  renderTable(accountTableBody, rows, 'account');
};
