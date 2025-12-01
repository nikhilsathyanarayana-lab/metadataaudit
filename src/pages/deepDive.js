import { loadTemplate } from '../controllers/modalLoader.js';
import { buildMetaEventsPayload, postAggregationWithIntegrationKey } from '../services/requests.js';
import {
  applyManualAppNames,
  loadManualAppNames,
  setManualAppName,
} from '../services/appNames.js';

const deepDiveGlobalKey = 'deepDiveMetaEvents';
const metadataFieldGlobalKey = 'metadataFieldRecords';
const appSelectionGlobalKey = 'appSelectionResponses';
const LOOKBACK_OPTIONS = [7, 30, 180];
const TARGET_LOOKBACK = 7;
const DEEP_DIVE_CONCURRENCY = 2;
const MAX_DEEP_DIVE_CALLS = 1;
const DEEP_DIVE_AGGREGATION_BATCH_SIZE = 25;
const DEBUG_DEEP_DIVE =
  (typeof window !== 'undefined' && Boolean(window.DEBUG_DEEP_DIVE)) || false;
const logDeepDive = (level, ...messages) => {
  const logger = typeof console?.[level] === 'function' ? console[level] : console.log;

  if (!DEBUG_DEEP_DIVE && level === 'debug') {
    return;
  }

  logger('[DeepDive]', ...messages);
};

const dedupeAndSortFields = (fields) => {
  if (fields instanceof Set) {
    return Array.from(fields).sort();
  }

  if (Array.isArray(fields)) {
    return Array.from(new Set(fields)).sort();
  }

  return [];
};

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));
const scheduleDomUpdate = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback());
    return;
  }

  setTimeout(() => callback(), 0);
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


const getGlobalCollection = (key) => {
  if (!key) {
    return [];
  }

  const fromNamespace = window?.deepDiveData?.[key];
  const direct = window?.[key];
  const candidate = fromNamespace ?? direct;

  if (Array.isArray(candidate)) {
    return candidate;
  }

  if (candidate && typeof candidate === 'object' && Array.isArray(candidate.records)) {
    return candidate.records;
  }

  return [];
};

const loadAppSelections = () =>
  getGlobalCollection(appSelectionGlobalKey)
    .filter((entry) => entry?.subId)
    .flatMap((entry) => {
      const appIds = extractAppIds(entry.response);

      if (!appIds.length) {
        return [];
      }

      return appIds.map((appId) => ({ subId: entry.subId, appId }));
    });

const normalizeMetadataRecords = (records) =>
  (Array.isArray(records) ? records : []).filter(
    (record) => record?.appId && Number.isFinite(record?.windowDays),
  );

const loadMetadataRecordsFromStorage = () => {
  try {
    const raw = localStorage.getItem(metadataFieldGlobalKey);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return normalizeMetadataRecords(parsed);
    }

    return normalizeMetadataRecords(parsed?.records);
  } catch (error) {
    console.error('Unable to parse stored metadata fields:', error);
    return [];
  }
};

const dedupeMetadataRecords = (...recordSets) => {
  const deduped = new Map();

  recordSets
    .flat()
    .filter(Boolean)
    .forEach((record) => {
      const key = `${record.appId}::${record.windowDays}`;
      deduped.set(key, record);
    });

  return Array.from(deduped.values());
};

const loadMetadataRecords = () =>
  dedupeMetadataRecords(
    normalizeMetadataRecords(getGlobalCollection(metadataFieldGlobalKey)),
    loadMetadataRecordsFromStorage(),
  );

let metadata_visitors = [];
let metadata_accounts = [];
let metadata_api_calls = [];
const metadataVisitorAggregation = new Map();
const metadataAccountAggregation = new Map();

if (typeof window !== 'undefined') {
  window.metadata_visitors = metadata_visitors;
  window.metadata_accounts = metadata_accounts;
  window.metadata_api_calls = metadata_api_calls;
}

const downloadDeepDiveJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
};

export const exportDeepDiveJson = () => {
  downloadDeepDiveJson(metadata_visitors, 'metadata-deep-dive-visitors.json');
  downloadDeepDiveJson(metadata_accounts, 'metadata-deep-dive-accounts.json');
  downloadDeepDiveJson(metadata_api_calls, 'metadata-deep-dive-api-calls.json');
};

const clearDeepDiveCollections = () => {
  metadata_visitors.splice(0, metadata_visitors.length);
  metadata_accounts.splice(0, metadata_accounts.length);
  metadata_api_calls.splice(0, metadata_api_calls.length);
  metadataVisitorAggregation.clear();
  metadataAccountAggregation.clear();
};

const ensureDeepDiveAccumulatorEntry = (accumulator, entry) => {
  if (!entry?.appId) {
    return null;
  }

  const existing = accumulator.get(entry.appId) || {
    appId: entry.appId,
    appName: entry.appName || '',
    subId: entry.subId || '',
    domain: entry.domain || '',
    integrationKey: entry.integrationKey || '',
    visitorFields: new Set(),
    accountFields: new Set(),
  };

  if (!accumulator.has(entry.appId)) {
    accumulator.set(entry.appId, existing);
  }

  return existing;
};

const appendFieldsFromMetadataObject = (metadataObject, targetSet) => {
  if (!metadataObject || typeof metadataObject !== 'object' || Array.isArray(metadataObject)) {
    return;
  }

  Object.keys(metadataObject).forEach((field) => targetSet.add(field));
};

const processDeepDiveResponseItems = async (response, onItem) => {
  if (!onItem) {
    return;
  }

  const candidateArrays = [];

  if (Array.isArray(response?.results)) {
    candidateArrays.push(response.results);
  }

  if (Array.isArray(response?.data)) {
    candidateArrays.push(response.data);
  }

  if (Array.isArray(response)) {
    candidateArrays.push(response);
  }

  let processedCount = 0;

  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const item of candidate) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      await onItem(item);
      processedCount += 1;

      if (processedCount % DEEP_DIVE_AGGREGATION_BATCH_SIZE === 0) {
        await yieldToBrowser();
      }
    }
  }
};

const updateMetadataCollections = async (response, entry) => {
  if (!entry?.appId) {
    return;
  }

  await processDeepDiveResponseItems(response, async (item) => {
    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const visitorMetadata = metadata.visitor || item.visitor;
    const accountMetadata = metadata.account || item.account;

    if (visitorMetadata && typeof visitorMetadata === 'object' && !Array.isArray(visitorMetadata)) {
      const visitorId = item.visitorId || metadata.visitorId || '';
      updateVisitorAggregation(visitorMetadata, entry, visitorId, metadataVisitorAggregation);
    }

    if (accountMetadata && typeof accountMetadata === 'object' && !Array.isArray(accountMetadata)) {
      updateAccountAggregation(accountMetadata, entry, metadataAccountAggregation);
    }
  });
};

const updateMetadataApiCalls = (entry, payload, response, error = '') => {
  if (!entry?.appId) {
    return;
  }

  const callRecord = {
    appId: entry.appId,
    subId: entry.subId || '',
    payload,
    response: response || null,
    error: error || '',
  };

  metadata_api_calls.push(callRecord);
};

const collectDeepDiveMetadataFields = async (response, accumulator, entry) => {
  const target = ensureDeepDiveAccumulatorEntry(accumulator, entry);

  if (!target) {
    return null;
  }

  await processDeepDiveResponseItems(response, async (item) => {
    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const visitorMetadata = metadata.visitor || item.visitor;
    const accountMetadata = metadata.account || item.account;

    appendFieldsFromMetadataObject(visitorMetadata, target.visitorFields);
    appendFieldsFromMetadataObject(accountMetadata, target.accountFields);

    if (Array.isArray(item.visitorMetadata)) {
      item.visitorMetadata.forEach((field) => target.visitorFields.add(field));
    }

    if (Array.isArray(item.accountMetadata)) {
      item.accountMetadata.forEach((field) => target.accountFields.add(field));
    }
  });

  return target;
};

let deepDiveRecords = [];

const loadDeepDiveRecords = () => {
  deepDiveRecords = getGlobalCollection(deepDiveGlobalKey)
    .filter((record) => record?.appId)
    .map((record) => ({
      ...record,
      visitorFields: Array.isArray(record.visitorFields) ? record.visitorFields : [],
      accountFields: Array.isArray(record.accountFields) ? record.accountFields : [],
    }));

  return deepDiveRecords;
};

const upsertDeepDiveRecord = (
  entry,
  response,
  normalizedFields,
  errorMessage = '',
  lookback = TARGET_LOOKBACK,
) => {
  if (!entry?.appId) {
    return;
  }

  const visitorFields = dedupeAndSortFields(normalizedFields?.visitorFields);
  const accountFields = dedupeAndSortFields(normalizedFields?.accountFields);

  const record = {
    windowDays: LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK,
    updatedAt: new Date().toISOString(),
    appId: entry.appId,
    appName: entry.appName || '',
    subId: entry.subId || '',
    domain: entry.domain || '',
    integrationKey: entry.integrationKey || '',
    visitorFields,
    accountFields,
    response: response || null,
    error: errorMessage,
  };

  deepDiveRecords = deepDiveRecords.filter(
    (existing) => existing.appId !== record.appId || existing.windowDays !== record.windowDays,
  );
  deepDiveRecords.push(record);
};

const syncDeepDiveRecordsAppName = (appId, appName) => {
  if (!appId) {
    return;
  }

  deepDiveRecords = deepDiveRecords.map((record) => {
    if (record.appId !== appId) {
      return record;
    }

    return {
      ...record,
      appName,
      updatedAt: new Date().toISOString(),
    };
  });
};

const syncMetadataRecordsAppName = (appId, appName, metadataRecords) => {
  if (!appId || !Array.isArray(metadataRecords)) {
    return metadataRecords;
  }

  return metadataRecords.map((record) => {
    if (record?.appId !== appId) {
      return record;
    }

    return {
      ...record,
      appName,
      updatedAt: new Date().toISOString(),
    };
  });
};

const groupMetadataByApp = (records, targetLookback = TARGET_LOOKBACK) => {
  const grouped = new Map();

  records.forEach((record) => {
    if (record.windowDays !== targetLookback) {
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

const replaceRows = (target, nextRows = []) => {
  if (!Array.isArray(target) || !Array.isArray(nextRows)) {
    return;
  }

  target.splice(0, target.length, ...nextRows);
};

const ensureVisitorAggregationEntry = (aggregation, entry) => {
  if (!entry?.appId) {
    return null;
  }

  const subId = entry.subId || '';
  const subEntry = aggregation.get(subId) || { subId, apps: new Map() };

  if (!aggregation.has(subId)) {
    aggregation.set(subId, subEntry);
  }

  const appEntry = subEntry.apps.get(entry.appId) || { appId: entry.appId, fields: new Map() };

  if (!subEntry.apps.has(entry.appId)) {
    subEntry.apps.set(entry.appId, appEntry);
  }

  return appEntry;
};

const ensureAccountAggregationEntry = (aggregation, entry) => {
  if (!entry?.appId) {
    return null;
  }

  const subId = entry.subId || '';
  const subEntry = aggregation.get(subId) || { subId, apps: new Map() };

  if (!aggregation.has(subId)) {
    aggregation.set(subId, subEntry);
  }

  const appEntry = subEntry.apps.get(entry.appId) || { appId: entry.appId, fields: new Map() };

  if (!subEntry.apps.has(entry.appId)) {
    subEntry.apps.set(entry.appId, appEntry);
  }

  return appEntry;
};

const normalizeMetadataValue = (value) => {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'undefined') {
    return 'undefined';
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '[object Object]';
    }
  }

  return String(value);
};

const buildVisitorExportRows = (aggregation) =>
  Array.from(aggregation.values())
    .map((subEntry) => ({
      subId: subEntry.subId,
      apps: Array.from(subEntry.apps.values())
        .map((appEntry) => ({
          appId: appEntry.appId,
          metadataFields: Array.from(appEntry.fields.entries())
            .map(([field, values]) => ({
              field,
              values: Array.from(values.entries())
                .map(([value, count]) => ({ value, count }))
                .sort((first, second) => first.value.localeCompare(second.value)),
            }))
            .sort((first, second) => first.field.localeCompare(second.field)),
        }))
        .sort((first, second) => first.appId.localeCompare(second.appId)),
    }))
    .sort((first, second) => first.subId.localeCompare(second.subId));

const buildAccountExportRows = (aggregation) =>
  Array.from(aggregation.values())
    .flatMap((subEntry) =>
      Array.from(subEntry.apps.values()).flatMap((appEntry) =>
        Array.from(appEntry.fields.entries()).flatMap(([field, values]) =>
          Array.from(values.entries()).map(([value, count]) => ({
            subId: subEntry.subId,
            appId: appEntry.appId,
            field,
            value,
            count,
          })),
        ),
      ),
    )
    .sort((first, second) => {
      const subComparison = first.subId.localeCompare(second.subId);

      if (subComparison) {
        return subComparison;
      }

      const appComparison = String(first.appId).localeCompare(String(second.appId));

      if (appComparison) {
        return appComparison;
      }

      const fieldComparison = first.field.localeCompare(second.field);

      if (fieldComparison) {
        return fieldComparison;
      }

      return first.value.localeCompare(second.value);
    });

const updateAccountAggregation = (accountMetadata, entry, aggregation) => {
  const target = ensureAccountAggregationEntry(aggregation, entry);

  if (!target) {
    return;
  }

  Object.entries(accountMetadata).forEach(([field, value]) => {
    const existingValues = target.fields.get(field) || new Map();
    const normalizedValue = normalizeMetadataValue(value);
    existingValues.set(normalizedValue, (existingValues.get(normalizedValue) || 0) + 1);
    target.fields.set(field, existingValues);
  });

  replaceRows(metadata_accounts, buildAccountExportRows(aggregation));
};

function updateVisitorAggregation(visitorMetadata, entry, visitorId, aggregation) {
  const target = ensureVisitorAggregationEntry(aggregation, entry);

  if (!target) {
    return;
  }

  const updateFieldCount = (field, value) => {
    const existingValues = target.fields.get(field) || new Map();
    const normalizedValue = normalizeMetadataValue(value);
    existingValues.set(normalizedValue, (existingValues.get(normalizedValue) || 0) + 1);
    target.fields.set(field, existingValues);
  };

  Object.entries(visitorMetadata).forEach(([field, value]) => {
    updateFieldCount(field, value);
  });

  updateFieldCount('visitorId', visitorId || '');

  replaceRows(metadata_visitors, buildVisitorExportRows(aggregation));
}

const buildRowsForLookback = (metadataRecords, lookback) => {
  const groupedRecords = groupMetadataByApp(metadataRecords, lookback);

  if (groupedRecords.length) {
    return groupedRecords;
  }

  const selections = loadAppSelections();
  return selections.map((entry) => ({
    appId: entry.appId,
    subId: entry.subId,
    visitorFields: [],
    accountFields: [],
    appName: entry.appName || '',
  }));
};

const ensureMessageRegion = () => {
  const existing = document.getElementById('deep-dive-messages');
  if (existing) {
    return existing;
  }

  const region = document.createElement('div');
  region.id = 'deep-dive-messages';
  region.className = 'page-messages';

  const mainContent = document.querySelector('main.content');
  if (mainContent?.parentNode) {
    mainContent.parentNode.insertBefore(region, mainContent);
  } else if (document.body) {
    document.body.insertBefore(region, document.body.firstChild);
  }
  return region;
};

const showMessage = (region, message, tone = 'info') => {
  if (!region) {
    return;
  }

  region.innerHTML = '';

  if (!message) {
    return;
  }

  const alert = document.createElement('p');
  alert.className = tone === 'error' ? 'alert' : 'status-banner';
  alert.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  alert.textContent = message;

  region.appendChild(alert);
};

export const reportDeepDiveError = (message, error) => {
  console.error(message, error);
  const region = ensureMessageRegion();
  showMessage(region, message, 'error');
};

let deepDiveGlobalErrorHandlersInstalled = false;
export const installDeepDiveGlobalErrorHandlers = () => {
  if (deepDiveGlobalErrorHandlersInstalled || typeof window === 'undefined') {
    return;
  }

  const handleError = (error) => {
    reportDeepDiveError(
      'An unexpected error occurred while loading the deep dive page. Please refresh and try again.',
      error,
    );
  };

  window.addEventListener('error', (event) => {
    handleError(event?.error ?? event?.message ?? event);
  });

  window.addEventListener('unhandledrejection', (event) => {
    handleError(event?.reason ?? event);
  });

  deepDiveGlobalErrorHandlersInstalled = true;
};

const setExportAvailability = (enabled) => {
  const exportButton = document.getElementById('export-button');

  if (!exportButton) {
    return;
  }

  exportButton.disabled = !enabled;
  exportButton.setAttribute('aria-disabled', String(!enabled));
};

const buildScanEntries = (records, manualAppNames, targetLookback = TARGET_LOOKBACK) => {
  const mapped = new Map();

  records
    .filter((record) => record.windowDays === targetLookback)
    .forEach((record) => {
      if (!record?.appId || !record?.domain || !record?.integrationKey) {
        return;
      }

      const appName = manualAppNames?.get(record.appId) || record.appName || '';

      mapped.set(record.appId, {
        appId: record.appId,
        appName,
        subId: record.subId || '',
        domain: record.domain,
        integrationKey: record.integrationKey,
      });
    });

  const entries = Array.from(mapped.values());

  logDeepDive('info', 'Built deep dive scan entries', {
    targetLookback,
    sourceRecords: records?.length || 0,
    entryCount: entries.length,
  });

  return entries;
};

const setupProgressTracker = () => {
  const progressText = document.getElementById('deep-dive-progress-text');

  const updateText = (completed, total) => {
    if (!progressText) {
      return;
    }

    if (!total) {
      progressText.textContent = 'No API calls queued.';
      return;
    }

    const boundedCompleted = Math.min(completed, total);
    const remaining = Math.max(total - boundedCompleted, 0);
    progressText.textContent = `API calls: ${boundedCompleted}/${total} (${remaining} left)`;
  };

  return { updateText };
};

const createEmptyRow = (tableBody, message) => {
  const row = document.createElement('tr');
  const emptyCell = document.createElement('td');
  emptyCell.colSpan = 5;
  emptyCell.textContent = message;
  row.appendChild(emptyCell);
  tableBody.appendChild(row);
};

const updateMetadataFieldHeaders = (lookback) => {
  const label = `Metadata field (${lookback} days)`;

  document.querySelectorAll('.metadata-field-header').forEach((header) => {
    header.textContent = label;
  });
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

const REGEX_FORMAT_OPTION = 'regex';
const DEFAULT_FORMAT_OPTION = 'unknown';
const FORMAT_OPTIONS = ['email', 'text', REGEX_FORMAT_OPTION, 'number', DEFAULT_FORMAT_OPTION];

const buildFormatSelect = (appId, subId, appName, fieldName, onRegexSelected) => {
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

  FORMAT_OPTIONS.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    select.appendChild(option);
  });

  select.value = DEFAULT_FORMAT_OPTION;
  select.dataset.previousValue = DEFAULT_FORMAT_OPTION;

  select.addEventListener('change', () => {
    const selectedValue = select.value;

    if (selectedValue === REGEX_FORMAT_OPTION) {
      const previousValue = select.dataset.previousValue || DEFAULT_FORMAT_OPTION;
      select.value = previousValue;

      if (typeof onRegexSelected === 'function') {
        onRegexSelected({
          appId,
          appName,
          fieldName,
          select,
          subId,
          previousValue,
        });
      }

      return;
    }

    select.dataset.regexPattern = '';
    select.dataset.previousValue = selectedValue;
    select.title = '';
  });

  return select;
};

const runDeepDiveScan = async (
  entries,
  lookback,
  updateProgress,
  messageRegion,
  rows,
  onSuccessfulCall,
  onComplete,
) => {
  clearDeepDiveCollections();

  const limitedEntries = entries.slice(0, MAX_DEEP_DIVE_CALLS);
  const targetLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;
  const totalCalls = limitedEntries.length;
  const queue = limitedEntries.slice();
  let completedCalls = 0;
  let successCount = 0;
  const deepDiveAccumulator = new Map();

  const updateProgressAsync = () =>
    scheduleDomUpdate(() => {
      updateProgress?.(completedCalls, totalCalls);
      logDeepDive('info', 'Deep dive progress update', {
        completedCalls,
        totalCalls,
      });
    });

  const sendMessageAsync = (message, tone = 'info') =>
    scheduleDomUpdate(() => showMessage(messageRegion, message, tone));

  logDeepDive('info', 'Starting deep dive scan', {
    requestedEntries: entries.length,
    limitedEntries: totalCalls,
    targetLookback,
  });

  if (!totalCalls) {
    updateProgressAsync();
    sendMessageAsync(
      'No metadata selections found. Run the Metadata Fields page first to capture app details.',
      'error',
    );
    return;
  }

  updateProgressAsync();

  if (entries.length > totalCalls) {
    sendMessageAsync('Limiting deep dive scan to 1 request to keep exports manageable.', 'info');
  }

  const processEntry = async (entry) => {
    logDeepDive('info', 'Processing deep dive entry', {
      appId: entry.appId,
      subId: entry.subId,
      targetLookback,
    });

    await yieldToBrowser();
    let payload;
    try {
      payload = buildMetaEventsPayload(entry.appId, targetLookback);
      logDeepDive('info', 'Built metadata events payload', {
        appId: entry.appId,
        subId: entry.subId,
        targetLookback,
        payload,
      });

      logDeepDive('info', 'Dispatching deep dive request', {
        appId: entry.appId,
        subId: entry.subId,
        integrationKey: entry.integrationKey,
      });

      const response = await postAggregationWithIntegrationKey(entry, payload);
      const normalizedFields = await collectDeepDiveMetadataFields(
        response,
        deepDiveAccumulator,
        entry,
      );

      upsertDeepDiveRecord(entry, response, normalizedFields, '', targetLookback);
      updateMetadataApiCalls(entry, payload, response, '');
      await updateMetadataCollections(response, entry);
      successCount += 1;
      if (onSuccessfulCall) {
        scheduleDomUpdate(() => onSuccessfulCall());
      }
    } catch (error) {
      const detail = error?.message || 'Unable to fetch metadata events.';
      const normalizedFields = ensureDeepDiveAccumulatorEntry(deepDiveAccumulator, entry);

      upsertDeepDiveRecord(entry, null, normalizedFields, detail, targetLookback);
      updateMetadataApiCalls(entry, payload, null, detail);

      console.error('Deep dive request failed', {
        appId: entry.appId,
        subId: entry.subId,
        integrationKey: entry.integrationKey,
        error: detail,
      });

      sendMessageAsync(`Deep dive request failed for app ${entry.appId}: ${detail}`, 'error');
    }
  };

  const workerCount = Math.min(Math.max(DEEP_DIVE_CONCURRENCY, 1), totalCalls);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const entry = queue.shift();

      if (!entry) {
        continue;
      }

      await processEntry(entry);
      completedCalls += 1;
      updateProgressAsync();
      await yieldToBrowser();
    }
  });

  await Promise.all(workers);

  if (successCount) {
    sendMessageAsync(
      `Completed ${successCount} deep dive request${successCount === 1 ? '' : 's'}.`,
      'info',
    );
  }

  logDeepDive('info', 'Deep dive scan completed', {
    completedCalls,
    successCount,
    totalCalls,
  });

  if (onComplete) {
    scheduleDomUpdate(() => onComplete());
  }
};

const renderTable = (tableBody, rows, type, openModal, openRegexModal, lookback) => {
  tableBody.innerHTML = '';

  if (!rows.length) {
    createEmptyRow(tableBody, 'No deep-dive data available. Run metadata requests first.');
    return [];
  }

  const renderedRows = [];

  rows.forEach((rowData) => {
    const fields = type === 'visitor' ? rowData.visitorFields : rowData.accountFields;
    const hasFields = Array.isArray(fields) && fields.length;
    const fieldsToRender = hasFields
      ? fields
      : [`No metadata fields captured for ${lookback} days`];

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
      fieldsCell.dataset.label = `Metadata field (${lookback} days)`;
      fieldsCell.textContent = fieldName;
      row.appendChild(fieldsCell);

      const formatCell = document.createElement('td');
      formatCell.dataset.label = 'Expected format';

      if (hasFields) {
        formatCell.appendChild(
          buildFormatSelect(
            rowData.appId,
            rowData.subId,
            rowData.appName,
            fieldName,
            openRegexModal,
          ),
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

const setupLookbackControls = (onChange, initialLookback = TARGET_LOOKBACK) => {
  const controls = document.getElementById('deep-dive-lookback-controls');
  const buttons = controls?.querySelectorAll('[data-lookback-button]') || [];
  let activeLookback = LOOKBACK_OPTIONS.includes(initialLookback)
    ? initialLookback
    : TARGET_LOOKBACK;

  const applyState = (nextLookback) => {
    buttons.forEach((button) => {
      const buttonLookback = Number.parseInt(button.dataset.lookback, 10);
      const isActive = buttonLookback === nextLookback;

      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
      button.disabled = isActive;
    });
  };

  applyState(activeLookback);

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextLookback = Number.parseInt(button.dataset.lookback, 10);

      if (!LOOKBACK_OPTIONS.includes(nextLookback) || nextLookback === activeLookback) {
        return;
      }

      activeLookback = nextLookback;
      applyState(activeLookback);
      onChange?.(activeLookback);
    });
  });

  return activeLookback;
};

const updateRegexFeedback = (tone, message) => {
  const feedback = document.getElementById('regex-format-modal-feedback');

  if (!feedback) {
    return;
  }

  feedback.textContent = message;
  feedback.className = tone === 'error' ? 'alert' : 'status-banner';
  feedback.setAttribute('role', tone === 'error' ? 'alert' : 'status');
};

const setupRegexFormatModal = async () => {
  if (!document.getElementById('regex-format-modal')) {
    await loadTemplate('Modals/regex-format-modal.html');
  }

  const modal = document.getElementById('regex-format-modal');
  const backdrop = document.getElementById('regex-format-backdrop');
  const form = document.getElementById('regex-format-modal-form');
  const fieldTarget = document.getElementById('regex-format-field');
  const appIdTarget = document.getElementById('regex-format-app-id');
  const subIdTarget = document.getElementById('regex-format-sub-id');
  const regexInput = document.getElementById('regex-format-input');
  const closeButtons = modal?.querySelectorAll('[data-close-regex-format-modal]') || [];

  if (!modal || !backdrop || !form || !regexInput) {
    return () => {};
  }

  let activeContext = null;

  const closeModal = (shouldRevertSelection = true) => {
    if (shouldRevertSelection && activeContext?.select) {
      activeContext.select.value = activeContext.previousValue || DEFAULT_FORMAT_OPTION;
    }

    modal.classList.remove('is-visible');
    backdrop.classList.remove('is-visible');
    modal.hidden = true;
    backdrop.hidden = true;
    form.reset();
    activeContext = null;
    updateRegexFeedback('info', '');
  };

  const openRegexModal = (context) => {
    activeContext = context;

    if (fieldTarget) {
      fieldTarget.textContent = context?.fieldName || 'metadata field';
    }

    if (appIdTarget) {
      appIdTarget.textContent = context?.appId || 'Unknown App ID';
    }

    if (subIdTarget) {
      subIdTarget.textContent = context?.subId || 'Unknown Sub ID';
    }

    regexInput.value = context?.select?.dataset?.regexPattern || '';

    updateRegexFeedback('info', 'Enter a JavaScript regular expression for this field.');
    modal.hidden = false;
    backdrop.hidden = false;
    modal.classList.add('is-visible');
    backdrop.classList.add('is-visible');
    regexInput.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!activeContext) {
      updateRegexFeedback('error', 'Select an expected format to configure regex.');
      return;
    }

    const pattern = regexInput.value.trim();

    if (!pattern) {
      updateRegexFeedback('error', 'Provide a regex pattern.');
      return;
    }

    try {
      // Validate the regex pattern without executing it.
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch (error) {
      updateRegexFeedback('error', 'Enter a valid regular expression.');
      return;
    }

    activeContext.select.dataset.regexPattern = pattern;
    activeContext.select.value = REGEX_FORMAT_OPTION;
    activeContext.select.dataset.previousValue = REGEX_FORMAT_OPTION;
    activeContext.select.title = `Regex pattern: ${pattern}`;

    closeModal(false);
  };

  const handleCancel = () => closeModal(true);

  form.addEventListener('submit', handleSubmit);
  backdrop.addEventListener('click', handleCancel);
  closeButtons.forEach((button) => button.addEventListener('click', handleCancel));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-visible')) {
      closeModal();
    }
  });

  return openRegexModal;
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

const setupManualAppNameModal = async (manualAppNames, rows, getRenderedRows, syncAppName) => {
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

  const handleSubmit = async (event) => {
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

    if (typeof syncAppName === 'function') {
      await syncAppName(activeRow.appId, appName);
    }

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
  try {
    logDeepDive('info', 'Initializing deep dive experience');
    const visitorTableBody = document.getElementById('visitor-deep-dive-table-body');
    const accountTableBody = document.getElementById('account-deep-dive-table-body');

    if (!visitorTableBody || !accountTableBody) {
      return;
    }

    const messageRegion = ensureMessageRegion();
    const { updateText: updateProgress } = setupProgressTracker();
    const startButton = document.getElementById('deep-dive-start');

    const manualAppNames = loadManualAppNames();
    let metadataRecords = loadMetadataRecords();
    deepDiveRecords = loadDeepDiveRecords();
    let hasSuccessfulScan = deepDiveRecords.some((record) => !record.error);
    const rows = [];
    const renderedRows = [];
    const getRenderedRows = () => renderedRows;
    const openAppNameModal = await setupManualAppNameModal(
      manualAppNames,
      rows,
      getRenderedRows,
      (appId, appName) => {
        metadataRecords = syncMetadataRecordsAppName(appId, appName, metadataRecords);
        syncDeepDiveRecordsAppName(appId, appName);
      },
    );
    const openRegexModal = await setupRegexFormatModal();

    let selectedLookback = TARGET_LOOKBACK;

    const updateExportAvailability = () => {
      setExportAvailability(hasSuccessfulScan && (rows.length > 0 || deepDiveRecords.length > 0));
    };

    const refreshTables = (lookback = selectedLookback) => {
      selectedLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;

      logDeepDive('info', 'Refreshing deep dive tables', {
        requestedLookback: lookback,
        selectedLookback,
      });

      const nextRows = applyManualAppNames(
        buildRowsForLookback(metadataRecords, selectedLookback),
        manualAppNames,
      );

      replaceRows(rows, nextRows);
      updateMetadataFieldHeaders(selectedLookback);

      renderedRows.length = 0;
      renderedRows.push(
        ...renderTable(
          visitorTableBody,
          rows,
          'visitor',
          openAppNameModal,
          openRegexModal,
          selectedLookback,
        ),
      );
      renderedRows.push(
        ...renderTable(
          accountTableBody,
          rows,
          'account',
          openAppNameModal,
          openRegexModal,
          selectedLookback,
        ),
      );

      logDeepDive('info', 'Updated deep dive tables', {
        selectedLookback,
        totalRows: rows.length,
        renderedRowCount: renderedRows.length,
      });

      updateExportAvailability();
      updateProgress(0, buildScanEntries(metadataRecords, manualAppNames, selectedLookback).length);
    };

    selectedLookback = setupLookbackControls(refreshTables, selectedLookback);
    refreshTables(selectedLookback);

    if (startButton) {
      startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        startButton.textContent = 'Scanning…';
        showMessage(messageRegion, 'Starting deep dive scan…', 'info');

        await runDeepDiveScan(
          buildScanEntries(metadataRecords, manualAppNames, selectedLookback),
          selectedLookback,
          updateProgress,
          messageRegion,
          rows,
          () => {
            hasSuccessfulScan = true;
            updateExportAvailability();
          },
          updateExportAvailability,
        );

        startButton.disabled = false;
        startButton.textContent = 'Start scan';
      });
    }
  } catch (error) {
    reportDeepDiveError(
      'Unable to initialize the deep dive experience. Please refresh and try again.',
      error,
    );
  }
};
