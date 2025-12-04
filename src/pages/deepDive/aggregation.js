// Aggregation helpers for metadata visitors/accounts and field collection.
import { DEEP_DIVE_AGGREGATION_BATCH_SIZE, TARGET_LOOKBACK } from './constants.js';
import { dedupeAndSortFields, yieldToBrowser } from './dataHelpers.js';

export const metadata_visitors = [];
export const metadata_accounts = [];
export const metadata_api_calls = [];
export const metadata_pending_api_calls = [];
const metadataVisitorAggregation = new Map();
const metadataAccountAggregation = new Map();

if (typeof window !== 'undefined') {
  window.metadata_visitors = metadata_visitors;
  window.metadata_accounts = metadata_accounts;
  window.metadata_api_calls = metadata_api_calls;
  window.metadata_pending_api_calls = metadata_pending_api_calls;
}

export const clearDeepDiveCollections = () => {
  metadata_visitors.splice(0, metadata_visitors.length);
  metadata_accounts.splice(0, metadata_accounts.length);
  metadata_api_calls.splice(0, metadata_api_calls.length);
  metadata_pending_api_calls.splice(0, metadata_pending_api_calls.length);
  metadataVisitorAggregation.clear();
  metadataAccountAggregation.clear();
};

export const ensureDeepDiveAccumulatorEntry = (accumulator, entry) => {
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
    datasetCount: 0,
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

export const processDeepDiveResponseItems = async (response, onItem) => {
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

const findPendingCallIndex = (appId) =>
  metadata_pending_api_calls.findIndex((entry) => entry?.appId === appId);

const normalizeRequestCount = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
};

const upsertPendingCall = (entry, overrides = {}) => {
  if (!entry?.appId) {
    return null;
  }

  const nextRecord = {
    appId: entry.appId,
    subId: entry.subId || '',
    status: 'queued',
    queuedAt: new Date().toISOString(),
    startedAt: '',
    completedAt: '',
    error: '',
    requestCount: normalizeRequestCount(overrides.requestCount ?? entry.requestCount ?? 1),
    ...overrides,
  };

  const existingIndex = findPendingCallIndex(entry.appId);

  if (existingIndex === -1) {
    metadata_pending_api_calls.push(nextRecord);
    return nextRecord;
  }

  metadata_pending_api_calls[existingIndex] = {
    ...metadata_pending_api_calls[existingIndex],
    ...nextRecord,
  };

  return metadata_pending_api_calls[existingIndex];
};

export const registerPendingMetadataCall = (entry) => upsertPendingCall(entry);

export const markPendingMetadataCallStarted = (entry) =>
  upsertPendingCall(entry, { status: 'in-flight', startedAt: new Date().toISOString() });

export const resolvePendingMetadataCall = (entry, status = 'completed', error = '') => {
  if (!entry?.appId) {
    return null;
  }

  const existingIndex = findPendingCallIndex(entry.appId);

  if (existingIndex === -1) {
    return null;
  }

  metadata_pending_api_calls[existingIndex] = {
    ...metadata_pending_api_calls[existingIndex],
    status: status || 'completed',
    error: error || '',
    completedAt: new Date().toISOString(),
  };

  return metadata_pending_api_calls[existingIndex];
};

export const getOutstandingMetadataCalls = () =>
  metadata_pending_api_calls.filter((call) => call?.status === 'queued' || call?.status === 'in-flight');

const isResolvedCall = (call) => call?.status === 'completed' || call?.status === 'failed';

export const summarizePendingMetadataCallProgress = () =>
  metadata_pending_api_calls.reduce(
    (totals, call) => {
      const requestCount = normalizeRequestCount(call?.requestCount);
      totals.total += requestCount;

      if (isResolvedCall(call)) {
        totals.completed += requestCount;
      }

      return totals;
    },
    { total: 0, completed: 0 },
  );

export const updateMetadataApiCalls = (entry, status, error = '', datasetCount = 0) => {
  if (!entry?.appId) {
    return;
  }

  const callRecord = {
    appId: entry.appId,
    subId: entry.subId || '',
    datasetCount: Number.isFinite(datasetCount) ? datasetCount : 0,
    status: status || 'unknown',
    error: error || '',
    recordedAt: new Date().toISOString(),
  };

  metadata_api_calls.push(callRecord);
};

export const collectDeepDiveMetadataFields = async (response, accumulator, entry) => {
  const target = ensureDeepDiveAccumulatorEntry(accumulator, entry);
  let datasetCount = 0;

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

    datasetCount += 1;
  });

  target.datasetCount = datasetCount;

  return target;
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
        .sort((first, second) => String(first.appId).localeCompare(String(second.appId))),
    }))
    .sort((first, second) => String(first.subId).localeCompare(String(second.subId)));

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

export const updateMetadataCollections = async (response, entry) => {
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


