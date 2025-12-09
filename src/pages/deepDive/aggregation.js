// Aggregation helpers for metadata visitors/accounts and field collection.
import { DEEP_DIVE_AGGREGATION_BATCH_SIZE, TARGET_LOOKBACK, logDeepDive } from './constants.js';
import { dedupeAndSortFields, yieldToBrowser } from './dataHelpers.js';

export const metadata_visitors = [];
export const metadata_accounts = [];
export const metadata_api_calls = [];
export const metadata_pending_api_calls = [];
export const pending_api_calls = metadata_pending_api_calls;
const pendingWindowDispatches = new Map();
const metadataVisitorAggregation = new Map();
const metadataAccountAggregation = new Map();
const metadataShapeSamples = { visitor: new Map(), account: new Map() };

const dispatchGlobalEvent = (name, detail = {}) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(name, { detail }));
};

const notifyPendingCallObservers = () =>
  dispatchGlobalEvent('pending-calls-updated', { calls: metadata_pending_api_calls });

const getPendingQueueSnapshot = () =>
  metadata_pending_api_calls.filter(
    (call) => call?.status === 'queued' || call?.status === 'in-flight' || call?.status === 'failed',
  );

const notifyRecordedCallObservers = () =>
  dispatchGlobalEvent('api-calls-updated', { calls: metadata_api_calls });

const isDebugLoggingEnabled = () =>
  typeof window !== 'undefined' && (window.DEBUG_LOGGING === true || window.DEBUG_DEEP_DIVE === true);

const PENDING_HEARTBEAT_INTERVAL_MS = 60_000;
let lastPendingSummarySignature = '';
let lastPendingSummaryCount = 0;
let lastPendingSummaryUpdatedAt = 0;
let pendingQueueHeartbeatCount = 0;
let lastPendingQueueHeartbeatAt = 0;

if (typeof window !== 'undefined') {
  window.metadata_visitors = metadata_visitors;
  window.metadata_accounts = metadata_accounts;
  window.metadata_api_calls = metadata_api_calls;
  window.metadata_pending_api_calls = metadata_pending_api_calls;
  window.pending_api_calls = pending_api_calls;
}

export const clearDeepDiveCollections = () => {
  metadata_visitors.splice(0, metadata_visitors.length);
  metadata_accounts.splice(0, metadata_accounts.length);
  metadata_api_calls.splice(0, metadata_api_calls.length);
  metadata_pending_api_calls.splice(0, metadata_pending_api_calls.length);
  pendingWindowDispatches.clear();
  metadataVisitorAggregation.clear();
  metadataAccountAggregation.clear();
  metadataShapeSamples.visitor.clear();
  metadataShapeSamples.account.clear();
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

const isPlainObject = (candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate);

const describeMetadataShape = (candidate) => {
  if (Array.isArray(candidate)) {
    const first = candidate.find((entry) => entry !== null && typeof entry !== 'undefined');

    if (!first) {
      return 'array(empty)';
    }

    if (typeof first === 'object') {
      const keys = Object.keys(first);
      return `array<object{${keys.join(',')}}>`;
    }

    return `array<${typeof first}>`;
  }

  if (candidate === null) {
    return 'null';
  }

  if (typeof candidate === 'object') {
    return 'object';
  }

  return typeof candidate;
};

const summarizeShapeSample = (candidate) => {
  if (Array.isArray(candidate)) {
    const firstEntry = candidate.find((entry) => entry !== null && typeof entry !== 'undefined');
    const keys = firstEntry && typeof firstEntry === 'object' ? Object.keys(firstEntry) : null;
    return { length: candidate.length, sample: firstEntry ?? null, keys };
  }

  if (candidate && typeof candidate === 'object') {
    const keys = Object.keys(candidate);
    const preview = keys.slice(0, 3).reduce((acc, key) => ({ ...acc, [key]: candidate[key] }), {});
    return { keys, preview };
  }

  return candidate ?? null;
};

const recordUnexpectedMetadataShape = (type, candidate, context = {}) => {
  const bucket = metadataShapeSamples[type];

  if (!bucket) {
    return;
  }

  const shape = describeMetadataShape(candidate);
  const shapeKey = `${context.appId || 'unknown'}::${context.source || 'unknown'}::${shape}`;

  if (bucket.has(shapeKey)) {
    return;
  }

  const sample = summarizeShapeSample(candidate);
  bucket.set(shapeKey, {
    appId: context.appId || '',
    subId: context.subId || '',
    source: context.source || '',
    shape,
    sample,
  });

  logDeepDive('warn', 'Unexpected deep dive metadata shape detected', {
    type,
    appId: context.appId,
    subId: context.subId,
    source: context.source,
    shape,
    sample,
  });
};

export const getMetadataShapeAnomalies = () => ({
  visitor: Array.from(metadataShapeSamples.visitor.values()),
  account: Array.from(metadataShapeSamples.account.values()),
});

const extractMetadataObject = (metadata = {}, item = {}, type, entry = {}) => {
  const paths = [
    { value: metadata[type], source: `metadata.${type}` },
    { value: item[type], source: type },
    { value: metadata[`${type}Metadata`], source: `metadata.${type}Metadata` },
    { value: item[`${type}Metadata`], source: `${type}Metadata` },
  ];

  for (const { value, source } of paths) {
    if (isPlainObject(value)) {
      return value;
    }

    if (typeof value !== 'undefined') {
      recordUnexpectedMetadataShape(type, value, { ...entry, source });
    }
  }

  return null;
};

const appendFieldsFromMetadataObject = (metadataObject, targetSet) => {
  if (!isPlainObject(metadataObject)) {
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

const normalizePendingKey = (entry) => {
  if (typeof entry === 'string' || typeof entry === 'number') {
    return String(entry);
  }

  if (!entry || typeof entry !== 'object') {
    return '';
  }

  const { queueKey, appId, subId, requestId } = entry;
  const candidate = queueKey || appId || subId || requestId;

  return candidate ? String(candidate) : '';
};

const getDispatchKey = (entry, windowSize) => {
  const baseKey = normalizePendingKey(entry);
  if (!baseKey) {
    return '';
  }
  const normalizedWindow = Number(windowSize) || 'unknown';

  return `${baseKey}::${normalizedWindow}`;
};

const findPendingCallIndex = (entry) => {
  const key = normalizePendingKey(entry);

  if (!key) {
    return -1;
  }

  return metadata_pending_api_calls.findIndex((record) => record?.queueKey === key);
};

const normalizeRequestCount = (value) => {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 1;
};

const normalizeWindowSize = (value, fallback) => {
  const normalized = Number(value);

  if (Number.isFinite(normalized) && normalized > 0) {
    return normalized;
  }

  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
};

const upsertPendingCall = (entry, overrides = {}) => {
  const key = normalizePendingKey(entry);

  if (!key) {
    return null;
  }

  const lookbackDays = normalizeWindowSize(overrides.lookbackDays ?? entry?.lookbackDays, null);

  const nextRecord = {
    queueKey: key,
    appId: entry?.appId || key,
    subId: entry?.subId || '',
    operation: entry?.operation || '',
    lookbackDays,
    status: 'queued',
    queuedAt: new Date().toISOString(),
    startedAt: '',
    completedAt: '',
    error: '',
    requestCount: normalizeRequestCount(overrides.requestCount ?? entry?.requestCount ?? 1),
    plannedWindows: lookbackDays ? [{ windowSize: lookbackDays, planned: 1, settled: 0, reason: 'initial' }] : [],
    ...overrides,
  };

  const existingIndex = findPendingCallIndex(key);

  if (existingIndex === -1) {
    metadata_pending_api_calls.push(nextRecord);
    notifyPendingCallObservers();
    return nextRecord;
  }

  metadata_pending_api_calls[existingIndex] = {
    ...metadata_pending_api_calls[existingIndex],
    ...nextRecord,
  };

  notifyPendingCallObservers();

  return metadata_pending_api_calls[existingIndex];
};

export const clearPendingCallQueue = () => {
  metadata_pending_api_calls.splice(0, metadata_pending_api_calls.length);
  pendingWindowDispatches.clear();
  notifyPendingCallObservers();
};

const upsertPendingDispatch = (entry, plannedCount = 0, windowSize = null, reason = '') => {
  const key = getDispatchKey(entry, windowSize);
  const normalizedPlanned = Math.max(Number(plannedCount) || 0, 0);
  const normalizedWindow = normalizeWindowSize(windowSize, null);

  if (!key) {
    return null;
  }

  const existing = pendingWindowDispatches.get(key) || {
    queueKey: normalizePendingKey(entry),
    appId: entry?.appId || '',
    subId: entry?.subId || '',
    windowSize: normalizedWindow,
    planned: 0,
    settled: 0,
    pendingSplit: false,
    reason: '',
    updatedAt: '',
  };

  const nextRecord = {
    ...existing,
    planned: Math.max(existing.planned, normalizedPlanned),
    pendingSplit: existing.pendingSplit || reason === 'split',
    reason: reason || existing.reason || '',
    updatedAt: new Date().toISOString(),
  };

  pendingWindowDispatches.set(key, nextRecord);

  return nextRecord;
};

const settlePendingDispatch = (entry, settledCount = 0, windowSize = null) => {
  const key = getDispatchKey(entry, windowSize);
  const existing = pendingWindowDispatches.get(key);
  const normalizedSettled = Math.max(Number(settledCount) || 0, 0);

  if (!existing) {
    return null;
  }

  const nextRecord = {
    ...existing,
    settled: Math.max(existing.settled || 0, normalizedSettled),
    pendingSplit: existing.pendingSplit && normalizedSettled < (existing.planned || 0),
    updatedAt: new Date().toISOString(),
  };

  if (nextRecord.settled >= nextRecord.planned) {
    pendingWindowDispatches.delete(key);
    return null;
  }

  pendingWindowDispatches.set(key, nextRecord);
  return nextRecord;
};

export const registerPendingCall = (entry, overrides = {}) => upsertPendingCall(entry, overrides);

export const stagePendingCallTable = (entries, lookbackDays, operation = '') => {
  clearPendingCallQueue();

  entries.forEach((entry) => {
    const operationLabel = entry?.operation || operation || '';

    registerPendingCall(
      { ...entry, lookbackDays, operation: operationLabel },
      { status: 'queued', lookbackDays, operation: operationLabel },
    );
  });

  return metadata_pending_api_calls;
};

export const updatePendingCallRequestCount = (entry, requestCount = 1) =>
  upsertPendingCall(entry, { requestCount: normalizeRequestCount(requestCount) });

export const updatePendingCallWindowPlan = (entry, plannedCount = 1, windowSize = null, reason = '') => {
  const key = normalizePendingKey(entry);
  const existingIndex = findPendingCallIndex(key);

  if (existingIndex === -1) {
    return null;
  }

  const normalizedPlanned = normalizeRequestCount(plannedCount);
  const normalizedWindow = normalizeWindowSize(windowSize, metadata_pending_api_calls[existingIndex].lookbackDays);
  const existing = metadata_pending_api_calls[existingIndex];
  const plannedWindows = Array.isArray(existing.plannedWindows) ? [...existing.plannedWindows] : [];

  if (normalizedWindow) {
    const existingWindow = plannedWindows.find((plan) => plan.windowSize === normalizedWindow);

    if (existingWindow) {
      existingWindow.planned = Math.max(existingWindow.planned, normalizedPlanned);
      existingWindow.reason = reason || existingWindow.reason || 'updated';
    } else {
      plannedWindows.push({
        windowSize: normalizedWindow,
        planned: normalizedPlanned,
        settled: 0,
        reason: reason || 'planned',
      });
    }
  }

  metadata_pending_api_calls[existingIndex] = {
    ...existing,
    requestCount: Math.max(existing.requestCount || 1, normalizedPlanned),
    plannedWindows,
  };

  notifyPendingCallObservers();

  return metadata_pending_api_calls[existingIndex];
};

export const markPendingCallStarted = (entry) =>
  upsertPendingCall(entry, { status: 'in-flight', startedAt: new Date().toISOString() });

export const resolvePendingCall = (entry, status = 'completed', error = '') => {
  const existingIndex = findPendingCallIndex(entry);

  if (existingIndex === -1) {
    return null;
  }

  metadata_pending_api_calls[existingIndex] = {
    ...metadata_pending_api_calls[existingIndex],
    status: status || 'completed',
    error: error || '',
    completedAt: new Date().toISOString(),
  };

  notifyPendingCallObservers();

  return metadata_pending_api_calls[existingIndex];
};

export const settlePendingWindowPlan = (entry, settledCount = 0, windowSize = null) => {
  const existingIndex = findPendingCallIndex(entry);

  if (existingIndex === -1) {
    return null;
  }

  const normalizedSettled = Math.max(Number(settledCount) || 0, 0);
  const normalizedWindow = normalizeWindowSize(windowSize, metadata_pending_api_calls[existingIndex].lookbackDays);
  const existing = metadata_pending_api_calls[existingIndex];
  const plannedWindows = Array.isArray(existing.plannedWindows) ? [...existing.plannedWindows] : [];

  if (normalizedWindow) {
    const existingWindow = plannedWindows.find((plan) => plan.windowSize === normalizedWindow);

    if (existingWindow) {
      existingWindow.settled = Math.max(existingWindow.settled || 0, normalizedSettled);
    } else {
      plannedWindows.push({ windowSize: normalizedWindow, planned: normalizedSettled || 1, settled: normalizedSettled });
    }
  }

  metadata_pending_api_calls[existingIndex] = { ...existing, plannedWindows };
  notifyPendingCallObservers();
  return metadata_pending_api_calls[existingIndex];
};

export const trackPendingWindowDispatch = (entry, plannedCount = 0, windowSize = null, reason = '') =>
  upsertPendingDispatch(entry, plannedCount, windowSize, reason);

export const settlePendingWindowDispatch = (entry, settledCount = 0, windowSize = null) =>
  settlePendingDispatch(entry, settledCount, windowSize);

export const getPendingWindowDispatches = () =>
  Array.from(pendingWindowDispatches.values()).filter(
    (record) => (record?.planned || 0) > (record?.settled || 0) || record?.pendingSplit,
  );

export const getOutstandingPendingCalls = () => {
  if (typeof window !== 'undefined' && typeof window.showPendingApiQueue === 'function') {
    const outstanding = window.showPendingApiQueue();

    if (Array.isArray(outstanding)) {
      return outstanding;
    }
  }

  return getPendingQueueSnapshot();
};

export const hasQueuedPendingCalls = () =>
  metadata_pending_api_calls.some((call) => call?.status === 'queued');

export const getNextQueuedPendingCall = () =>
  metadata_pending_api_calls.find((call) => call?.status === 'queued') || null;

export const registerApiQueueInspector = () => {
  if (typeof window === 'undefined' || window.showPendingApiQueue) {
    return;
  }

  const inspector = () => {
    const debugEnabled = isDebugLoggingEnabled();
    const outstanding = getPendingQueueSnapshot();

    const summarized = outstanding.map((call) => {
      const queuedAtMs = Date.parse(call.queuedAt);
      const ageMs = Number.isFinite(queuedAtMs) ? Date.now() - queuedAtMs : 0;

      return {
        appId: call.appId,
        subId: call.subId,
        status: call.status,
        lookbackDays: call.lookbackDays,
        plannedWindows: call.plannedWindows,
        queuedAt: call.queuedAt,
        startedAt: call.startedAt,
        ageMs: Math.round(ageMs),
      };
    });

    const signature = JSON.stringify(summarized);
    const hasChanges = signature !== lastPendingSummarySignature;
    const isFirstRun = lastPendingSummarySignature === '';
    const shouldLogUpdate = debugEnabled && (isFirstRun || hasChanges);
    const now = Date.now();

    if (hasChanges) {
      lastPendingSummarySignature = signature;
      lastPendingSummaryCount = summarized.length;
      lastPendingSummaryUpdatedAt = now;
    }

    if (shouldLogUpdate) {
      logDeepDive(
        'debug',
        'Pending API queue snapshot',
        hasChanges ? '(updated)' : '(initial)',
        `(${summarized.length} call${summarized.length === 1 ? '' : 's'})`,
      );

      logDeepDive('debug', 'Pending API queue details', summarized);
    } else if (debugEnabled) {
      const heartbeatDue =
        lastPendingQueueHeartbeatAt === 0 || now - lastPendingQueueHeartbeatAt >= PENDING_HEARTBEAT_INTERVAL_MS;

      if (heartbeatDue) {
        pendingQueueHeartbeatCount += 1;
        lastPendingQueueHeartbeatAt = now;
        logDeepDive('debug', 'Pending API queue heartbeat', {
          heartbeat: pendingQueueHeartbeatCount,
          calls: summarized.length,
          lastChangeAt: lastPendingSummaryUpdatedAt ? new Date(lastPendingSummaryUpdatedAt).toISOString() : null,
        });
      }
    }

    if (typeof window !== 'undefined') {
      window.pendingApiQueueSummary = summarized;
    }

    return outstanding;
  };

  window.showPendingApiQueue = inspector;
  window.showDeepDiveRequestTable = inspector;
};

registerApiQueueInspector();

const isResolvedCall = (call) => call?.status === 'Completed';

export const summarizePendingCallProgress = () =>
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

// Metadata-specific aliases maintained for backwards compatibility.
export const registerPendingMetadataCall = (entry) => registerPendingCall(entry);

export const updatePendingMetadataCallRequestCount = (entry, requestCount = 1) =>
  updatePendingCallRequestCount(entry, requestCount);

export const markPendingMetadataCallStarted = (entry) => markPendingCallStarted(entry);

export const resolvePendingMetadataCall = (entry, status = 'completed', error = '') =>
  resolvePendingCall(entry, status, error);

export const getOutstandingMetadataCalls = () => getOutstandingPendingCalls();

export const summarizePendingMetadataCallProgress = () => summarizePendingCallProgress();

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
  notifyRecordedCallObservers();
};

export const collectDeepDiveMetadataFields = async (response, accumulator, entry) => {
  const target = ensureDeepDiveAccumulatorEntry(accumulator, entry);
  let datasetCount = 0;

  if (!target) {
    return null;
  }

  await processDeepDiveResponseItems(response, async (item) => {
    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const visitorMetadata = extractMetadataObject(metadata, item, 'visitor', entry);
    const accountMetadata = extractMetadataObject(metadata, item, 'account', entry);

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

  target.datasetCount = (target.datasetCount || 0) + datasetCount;

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
    const visitorMetadata = extractMetadataObject(metadata, item, 'visitor', entry);
    const accountMetadata = extractMetadataObject(metadata, item, 'account', entry);

    if (visitorMetadata) {
      const visitorId = item.visitorId || metadata.visitorId || '';
      updateVisitorAggregation(visitorMetadata, entry, visitorId, metadataVisitorAggregation);
    }

    if (accountMetadata) {
      updateAccountAggregation(accountMetadata, entry, metadataAccountAggregation);
    }
  });
};


