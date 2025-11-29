import { loadTemplate } from '../controllers/modalLoader.js';
import {
  applyManualAppNames,
  loadManualAppNames,
  setManualAppName,
} from '../services/appNames.js';

const metadataFieldStorageKey = 'metadataFieldRecords';
const metadataFieldStorageVersion = 1;
const appSelectionStorageKey = 'appSelectionResponses';
const TARGET_LOOKBACK = 180;

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

const syncMetadataRecordsAppName = (appId, appName) => {
  if (!appId) {
    return;
  }

  try {
    const raw = localStorage.getItem(metadataFieldStorageKey);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);

    if (parsed?.version !== metadataFieldStorageVersion || !Array.isArray(parsed?.records)) {
      return;
    }

    let updated = false;
    const updatedRecords = parsed.records.map((record) => {
      if (record?.appId !== appId) {
        return record;
      }

      updated = true;
      return {
        ...record,
        appName,
        updatedAt: new Date().toISOString(),
      };
    });

    if (updated) {
      localStorage.setItem(
        metadataFieldStorageKey,
        JSON.stringify({ ...parsed, records: updatedRecords }),
      );
    }
  } catch (error) {
    console.error('Unable to sync app name to metadata records:', error);
  }
};

const groupMetadataByApp = (records) => {
  const grouped = new Map();

  records.forEach((record) => {
    if (record.windowDays !== TARGET_LOOKBACK) {
      return;
    }

    const appId = record.appId;
    const existing = grouped.get(appId) || {
      appId,
      appName: record.appName || '',
      subId: record.subId || '',
      visitorFields: [],
      accountFields: [],
    };

    existing.appName = existing.appName || record.appName || '';
    existing.subId = existing.subId || record.subId || '';

    if (Array.isArray(record.visitorFields)) {
      existing.visitorFields = record.visitorFields;
    }

    if (Array.isArray(record.accountFields)) {
      existing.accountFields = record.accountFields;
    }

    grouped.set(appId, existing);
  });

  return Array.from(grouped.values());
};

const createEmptyRow = (tableBody, message) => {
  const row = document.createElement('tr');
  const emptyCell = document.createElement('td');
  emptyCell.colSpan = 5;
  emptyCell.textContent = message;
  row.appendChild(emptyCell);
  tableBody.appendChild(row);
};

const buildAppNameCell = (rowData, openModal) => {
  const cell = document.createElement('td');
  cell.dataset.label = 'App Name';

  const appNameButton = document.createElement('button');
  appNameButton.type = 'button';
  appNameButton.className = 'app-name-button';
  appNameButton.dataset.appId = rowData.appId;
  appNameButton.textContent = rowData.appName || 'Not set';
  appNameButton.setAttribute('aria-label', `Set app name for ${rowData.appId}`);

  if (typeof openModal === 'function') {
    appNameButton.addEventListener('click', () => openModal(rowData));
  }

  cell.appendChild(appNameButton);
  return { cell, appNameButton };
};

const buildFormatSelect = (appId, subId, appName, fieldName) => {
  const select = document.createElement('select');
  select.className = 'format-select';
  const labelParts = [`Sub ID ${subId || 'unknown'}`, `App ID ${appId}`];
  if (appName) {
    labelParts.push(`(${appName})`);
  }
  if (fieldName) {
    labelParts.push(`Field ${fieldName}`);
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

const renderTable = (tableBody, rows, type, openModal) => {
  tableBody.innerHTML = '';

  if (!rows.length) {
    createEmptyRow(tableBody, 'No deep-dive data available. Run metadata requests first.');
    return [];
  }

  const renderedRows = [];

  rows.forEach((rowData) => {
    const fields = type === 'visitor' ? rowData.visitorFields : rowData.accountFields;
    const hasFields = Array.isArray(fields) && fields.length;
    const fieldsToRender = hasFields ? fields : ['No metadata fields captured for 180 days'];

    fieldsToRender.forEach((fieldName, index) => {
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

      const { cell: appNameCell, appNameButton } = buildAppNameCell(rowData, openModal);

      row.appendChild(subIdCell);
      row.appendChild(appNameCell);
      row.appendChild(appIdCell);

      const fieldsCell = document.createElement('td');
      fieldsCell.dataset.label = 'Metadata field (180 days)';
      fieldsCell.textContent = fieldName;
      row.appendChild(fieldsCell);

      const formatCell = document.createElement('td');
      formatCell.dataset.label = 'Expected format';

      if (hasFields) {
        formatCell.appendChild(
          buildFormatSelect(rowData.appId, rowData.subId, rowData.appName, fieldName),
        );
      } else {
        formatCell.textContent = index === 0 ? 'N/A' : '';
      }

      row.appendChild(formatCell);

      tableBody.appendChild(row);

      renderedRows.push({ rowData, appNameButton, appIdCell });
    });
  });

  return renderedRows;
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

const setupManualAppNameModal = async (manualAppNames, rows, getRenderedRows) => {
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

  let activeRow = null;

  const closeModal = () => {
    modal.classList.remove('is-visible');
    backdrop.classList.remove('is-visible');
    modal.hidden = true;
    backdrop.hidden = true;
    form.reset();
    activeRow = null;
    updateManualAppNameFeedback('info', '');
  };

  const openModal = (rowData) => {
    activeRow = rowData;
    appIdTarget.textContent = rowData?.appId || '';
    const existingName = rowData?.appName || manualAppNames.get(rowData?.appId) || '';
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

    if (!activeRow) {
      updateManualAppNameFeedback('error', 'Select a row to set an app name.');
      return;
    }

    const appName = appNameInput.value.trim();

    if (!appName) {
      updateManualAppNameFeedback('error', 'Provide an App Name.');
      return;
    }

    setManualAppName(manualAppNames, activeRow.appId, appName);
    syncMetadataRecordsAppName(activeRow.appId, appName);

    rows
      .filter((row) => row.appId === activeRow.appId)
      .forEach((row) => {
        row.appName = appName;
      });

    const renderedRows = typeof getRenderedRows === 'function' ? getRenderedRows() : [];
    renderedRows
      .filter(({ rowData }) => rowData.appId === activeRow.appId)
      .forEach(({ rowData, appNameButton, appIdCell }) => {
        rowData.appName = appName;

        if (appNameButton) {
          appNameButton.textContent = appName || 'Not set';
        }

        if (appIdCell) {
          appIdCell.title = appName ? `App name: ${appName}` : '';
        }
      });

    updateManualAppNameFeedback('info', `Saved app name for ${activeRow.appId}.`);
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

export const initDeepDive = async () => {
  const visitorTableBody = document.getElementById('visitor-deep-dive-table-body');
  const accountTableBody = document.getElementById('account-deep-dive-table-body');

  if (!visitorTableBody || !accountTableBody) {
    return;
  }

  const manualAppNames = loadManualAppNames();
  const metadataRecords = loadMetadataRecords();
  const groupedRecords = groupMetadataByApp(metadataRecords);

  let rows = groupedRecords;

  if (!rows.length) {
    const selections = loadAppSelections();
    const selectionRows = selections.map((entry) => ({
      appId: entry.appId,
      subId: entry.subId,
      visitorFields: [],
      accountFields: [],
    }));

    rows = selectionRows;
  }

  rows = applyManualAppNames(rows, manualAppNames);

  const renderedRows = [];
  const getRenderedRows = () => renderedRows;
  const openAppNameModal = await setupManualAppNameModal(manualAppNames, rows, getRenderedRows);

  renderedRows.push(...renderTable(visitorTableBody, rows, 'visitor', openAppNameModal));
  renderedRows.push(...renderTable(accountTableBody, rows, 'account', openAppNameModal));
};
