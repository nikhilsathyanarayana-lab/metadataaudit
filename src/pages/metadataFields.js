import {
  buildChunkedMetadataFieldPayloads,
  buildMetadataFieldsForAppPayload,
  logAggregationSplit,
} from '../services/payloads/index.js';
import { isTooMuchDataOrTimeout, RESPONSE_TOO_LARGE_MESSAGE } from '../services/requests/errors.js';
import { runAggregationWithFallbackWindows } from '../services/requests/network.js';
import { loadTemplate } from '../controllers/modalLoader.js';
import { extractAppIds } from '../services/appUtils.js';
import { createLogger } from '../utils/logger.js';
import { applyBannerTone, ensureMessageRegion, renderRegionBanner, setBannerText } from '../ui/statusBanner.js';
import { renderPendingQueueBanner } from '../ui/pendingQueueBanner.js';
import {
  applyManualAppNames,
  loadManualAppNames,
  getManualAppName,
  setManualAppName,
} from '../services/appNames.js';
import {
  clearPendingCallQueue,
  markPendingCallStarted,
  registerPendingCall,
  resolvePendingCall,
  summarizePendingCallProgress,
  updatePendingCallRequestCount,
} from './deepDive/aggregation.js';

const metadataLogger = createLogger('MetadataFields');

const LOOKBACK_WINDOWS = [7, 30, 180];
const OVER_LIMIT_CLASS = 'metadata-limit-exceeded';
const STATUS_REGION_ID = 'page-status-banner';
const storageKey = 'appSelectionResponses';
const metadataFieldStorageKey = 'metadataFieldRecords';
const metadataFieldStorageVersion = 1;
let metadataFieldsReadyPromise = Promise.resolve();
let metadataSnapshot = new Map();
const aggregationHintsByApp = new Map();

const getAggregationHint = (appId) => aggregationHintsByApp.get(appId) || {};

const updateAggregationHint = (appId, windowDays, chunkSizeUsed) => {
  if (!appId || !Number.isFinite(windowDays)) {
    return;
  }

  const existing = aggregationHintsByApp.get(appId) || {};
  const preferredChunkSize =
    Number.isFinite(chunkSizeUsed) && chunkSizeUsed > 0
      ? chunkSizeUsed
      : existing.preferredChunkSize;

  aggregationHintsByApp.set(appId, {
    maxWindowDays: Math.max(existing.maxWindowDays || 0, windowDays),
    preferredChunkSize,
  });
};

const buildMetadataRecordKey = (appId, windowDays) => `${appId}::${windowDays}`;

const loadMetadataSnapshot = () => {
  metadataSnapshot = new Map();

  try {
    const raw = sessionStorage.getItem(metadataFieldStorageKey);

    if (!raw) {
      return metadataSnapshot;
    }

    const parsed = JSON.parse(raw);
    const records = parsed?.records;

    if (parsed?.version !== metadataFieldStorageVersion || !Array.isArray(records)) {
      return metadataSnapshot;
    }

    records.forEach((record) => {
      if (!record?.appId || !Number.isFinite(record?.windowDays)) {
        return;
      }

      const key = buildMetadataRecordKey(record.appId, record.windowDays);
      metadataSnapshot.set(key, record);
    });
  } catch (error) {
    metadataLogger.error('Unable to load stored metadata fields:', error);
  }

  return metadataSnapshot;
};

export const getMetadataFieldRecords = (windowDays) => {
  if (!metadataSnapshot.size) {
    loadMetadataSnapshot();
  }

  const records = Array.from(metadataSnapshot.values());

  if (Number.isFinite(windowDays)) {
    return records.filter((record) => record?.windowDays === windowDays);
  }

  return records;
};

const logMetadataRequestError = async (error, contextLabel) => {
  const { responseStatus, responseBody, details } = error || {};
  const status = responseStatus ?? details?.status;
  const body = responseBody ?? details?.body;

  if (status !== undefined || body !== undefined) {
    metadataLogger.error(`${contextLabel} response details:`, {
      status: status ?? 'unknown status',
      body: body ?? '',
    });
    return;
  }

  if (typeof error?.response?.text === 'function') {
    try {
      const responseText = await error.response.text();

      if (responseText) {
        metadataLogger.error(`${contextLabel} response body:`, responseText);
        return;
      }
    } catch (loggingError) {
      metadataLogger.error('Unable to read error response text:', loggingError);
      return;
    }
  }

  metadataLogger.error(contextLabel, error);
};

const persistMetadataSnapshot = () => {
  const serialized = {
    version: metadataFieldStorageVersion,
    updatedAt: new Date().toISOString(),
    records: Array.from(metadataSnapshot.values()),
  };

  sessionStorage.setItem(metadataFieldStorageKey, JSON.stringify(serialized));
};

const updateMetadataSnapshotEntry = (
  entry,
  windowDays,
  visitorFields,
  accountFields,
  manualAppNames,
) => {
  if (!entry?.appId || !Number.isFinite(windowDays)) {
    return;
  }

  const record = {
    version: metadataFieldStorageVersion,
    updatedAt: new Date().toISOString(),
    appId: entry.appId,
    appName: entry.appName || getManualAppName(manualAppNames, entry.subId, entry.appId) || '',
    subId: entry.subId,
    domain: entry.domain,
    integrationKey: entry.integrationKey,
    windowDays,
    visitorFields,
    accountFields,
  };

  metadataSnapshot.set(buildMetadataRecordKey(entry.appId, windowDays), record);
  persistMetadataSnapshot();
};

const updateAppSelectionMetadataFields = (
  appId,
  windowDays,
  visitorFields = [],
  accountFields = [],
) => {
  if (!appId || windowDays !== 7) {
    return;
  }

  try {
    const raw = sessionStorage.getItem(storageKey);

    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const normalizedVisitorFields = Array.isArray(visitorFields) ? visitorFields : [];
    const normalizedAccountFields = Array.isArray(accountFields) ? accountFields : [];

    const updatedSelections = parsed.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }

      const appIds = extractAppIds(entry.response);

      if (!appIds.includes(appId)) {
        return entry;
      }

      return {
        ...entry,
        metadataFields: {
          ...(entry.metadataFields || {}),
          [appId]: {
            windowDays,
            visitorFields: normalizedVisitorFields,
            accountFields: normalizedAccountFields,
            updatedAt,
          },
        },
      };
    });

    sessionStorage.setItem(storageKey, JSON.stringify(updatedSelections));
  } catch (error) {
    metadataLogger.error('Unable to update stored app selections with metadata fields:', error);
  }
};

const syncMetadataSnapshotAppName = (appId, appName, subId) => {
  if (!appId) {
    return;
  }

  let updated = false;
  metadataSnapshot.forEach((record, key) => {
    if (record.appId === appId && (!subId || record.subId === subId)) {
      metadataSnapshot.set(key, {
        ...record,
        appName,
        updatedAt: new Date().toISOString(),
      });
      updated = true;
    }
  });

  if (updated) {
    persistMetadataSnapshot();
  }
};

const createMessageRegion = () => ensureMessageRegion('metadata-fields-messages');

const renderQueueBanner = (overrideMessage, overrideTone) =>
  renderPendingQueueBanner({
    regionId: STATUS_REGION_ID,
    beforeSelector: 'header.page-header',
    formatMessage: ({ total, completed }) => {
      if (typeof overrideMessage === 'string') {
        return overrideMessage;
      }

      if (!total) {
        return 'No API calls queued.';
      }

      const boundedCompleted = Math.min(completed, total);
      return `API calls completed ${boundedCompleted} of ${total}`;
    },
    tone: overrideTone ? () => overrideTone : undefined,
  });

const showMessage = (region, message, tone = 'info') => {
  renderRegionBanner(region, message, tone, { ariaLive: tone === 'error' ? undefined : 'polite' });
};

const parseStoredSelection = () => {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry) => entry?.subId && entry?.domain && entry?.integrationKey)
      : [];
  } catch (error) {
    metadataLogger.error('Unable to parse stored app selection data:', error);
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

const buildAppEntries = (manualAppNames) => {
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

  return applyManualAppNames(entries, manualAppNames);
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

  setBannerText(feedback, message);
  applyBannerTone(feedback, tone);
};

const setupManualAppNameModal = async (manualAppNames, entries, allRows, syncAppName) => {
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
    const existingName = getManualAppName(manualAppNames, entry?.subId, entry?.appId) || entry?.appName || '';
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

    setManualAppName(manualAppNames, activeEntry.appId, appName, activeEntry.subId);
    syncAppName?.(activeEntry.appId, appName, activeEntry.subId);

    entries
      .filter((entry) => entry.appId === activeEntry.appId && entry.subId === activeEntry.subId)
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
  const visitorFields = new Set();
  const accountFields = new Set();

  const addFields = (fields, target) => {
    if (!Array.isArray(fields)) {
      return;
    }

    fields.forEach((field) => {
      if (typeof field === 'string' || typeof field === 'number') {
        const normalized = String(field).trim();

        if (normalized) {
          target.add(normalized);
        }
      }
    });
  };

  const collectFromItem = (item) => {
    if (!item) {
      return;
    }

    if (Array.isArray(item)) {
      item.forEach(collectFromItem);
      return;
    }

    if (typeof item !== 'object') {
      return;
    }

    addFields(item.visitorFields ?? item.visitorMetadata, visitorFields);
    addFields(item.accountFields ?? item.accountMetadata, accountFields);

    collectFromItem(item.results);
    collectFromItem(item.data);
  };

  collectFromItem(apiResponse);

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

const fetchAndPopulate = (
  entries,
  visitorRows,
  accountRows,
  messageRegion,
  manualAppNames,
) => {
  let queueIntervalId = null;
  const workQueue = [];
  const inFlight = new Set();
  const abortedEntries = new Set();
  const queueEntries = new Map();
  const updateProgressText = () => renderQueueBanner();

  clearPendingCallQueue();
  updateProgressText();

  const entryKey = (entry) => `${entry.subId || ''}::${entry.domain || ''}::${entry.integrationKey || ''}`;
  const queueKeyForItem = (entry, windowDays) =>
    `metadata-fields::${entry.appId || entry.subId || entry.domain || entry.integrationKey || 'unknown'}::${windowDays}`;

  const getCells = (entry) => ({
    visitorCells: visitorRows.find((row) => row.entry === entry)?.cells,
    accountCells: accountRows.find((row) => row.entry === entry)?.cells,
  });

  const isAborted = (entry) => abortedEntries.has(entryKey(entry));

  const removePendingForEntry = (entry) => {
    const key = entryKey(entry);
    let removedCount = 0;
    for (let i = workQueue.length - 1; i >= 0; i -= 1) {
      const queuedItem = workQueue[i];
      if (entryKey(queuedItem.entry) === key) {
        const pendingKey = queuedItem.queueKey;
        workQueue.splice(i, 1);
        removedCount += 1;

        if (pendingKey) {
          resolvePendingCall(pendingKey, 'failed', 'Aborted after client error.');
          queueEntries.delete(pendingKey);
        }
      }
    }

    if (removedCount > 0) {
      updateProgressText();
    }
  };

  const enqueueWorkItem = (item) => {
    const queueKey = queueKeyForItem(item.entry, item.windowDays);
    const pendingCall = registerPendingCall({
      ...item.entry,
      queueKey,
      operation: 'metadataFields',
    });
    queueEntries.set(queueKey, pendingCall);
    workQueue.push({ ...item, queueKey });
    updateProgressText();
  };

  const handleBaseRequest = async (item) => {
    const { entry, windowDays, queueKey } = item;
    const pendingKey = queueKey || queueKeyForItem(entry, windowDays);
    const pendingCall =
      queueEntries.get(pendingKey) ||
      registerPendingCall({ ...entry, queueKey: pendingKey, operation: 'metadataFields' });
    queueEntries.set(pendingKey, pendingCall);

    const { visitorCells, accountCells } = getCells(entry);

    if (!visitorCells || !accountCells) {
      resolvePendingCall(pendingCall, 'failed', 'Missing target cells.');
      updateProgressText();
      return;
    }

    if (isAborted(entry)) {
      resolvePendingCall(pendingCall, 'failed', 'Aborted before dispatch.');
      updateProgressText();
      return;
    }

    markPendingCallStarted(pendingCall);
    updateProgressText();

    const updatePendingQueue = (plannedCount) => {
      const previousCount = Math.max(1, Number(pendingCall?.requestCount) || 1);
      const normalizedCount = Math.max(previousCount, Number(plannedCount) || 0, 1);
      updatePendingCallRequestCount(pendingCall, normalizedCount);
      updateProgressText();
    };

    let clientErrorWithoutRecovery = false;
    let requestSummary = { requestCount: 1 };
    let requestStatus = 'completed';
    let requestError = '';
    const { maxWindowDays, preferredChunkSize } = getAggregationHint(entry.appId);
    const startingWindowHint = Number.isFinite(preferredChunkSize)
      ? preferredChunkSize
      : maxWindowDays;
    const shouldSkipLargeWindow = Number.isFinite(startingWindowHint) && startingWindowHint < windowDays;

    if (shouldSkipLargeWindow) {
      metadataLogger.info(
        `Using prior aggregation window ${startingWindowHint}d for app ${entry.appId}; skipping ${windowDays}d base request due to earlier size/timeout limits.`,
      );
    }

    try {
      requestSummary = await runAggregationWithFallbackWindows({
        entry,
        totalWindowDays: windowDays,
        buildBasePayload: (totalWindow) => buildMetadataFieldsForAppPayload(entry.appId, totalWindow),
        buildChunkedPayloads: (windowSize, chunkSize) =>
          buildChunkedMetadataFieldPayloads(entry.appId, windowSize, chunkSize),
        aggregateResults: (collector, response) => {
          if (Array.isArray(response?.results)) {
            collector.push(...response.results);
            return;
          }

          if (Array.isArray(response?.data)) {
            collector.push(...response.data);
            return;
          }

          if (Array.isArray(response)) {
            collector.push(...response);
          }
        },
        onWindowSplit: (windowSize, payloadCount) =>
          logAggregationSplit('Metadata fields', windowSize, payloadCount, entry?.appId),
        maxWindowHint: shouldSkipLargeWindow ? startingWindowHint : undefined,
        preferredChunkSize,
        updatePendingQueue,
        onRequestsPlanned: () => updateProgressText(),
        onRequestsSettled: () => {
          updateProgressText();
        },
      });

      if (!Array.isArray(requestSummary?.aggregatedResults)) {
        throw requestSummary?.lastError || new Error('Metadata request did not return any data.');
      }

      const { visitorFields, accountFields } = parseMetadataFields(requestSummary.aggregatedResults);

      updateCellContent(visitorCells[windowDays], visitorFields, 'visitor');
      updateCellContent(accountCells[windowDays], accountFields, 'account');

      updateMetadataSnapshotEntry(entry, windowDays, visitorFields, accountFields, manualAppNames);
      updateAppSelectionMetadataFields(entry.appId, windowDays, visitorFields, accountFields);
      updateAggregationHint(entry.appId, windowDays, requestSummary?.chunkSizeUsed);

      visitorCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
      accountCells[windowDays].classList.remove(OVER_LIMIT_CLASS);
    } catch (error) {
      await logMetadataRequestError(error, 'Metadata field request failed');
      requestSummary = { requestCount: error?.requestCount || requestSummary?.requestCount || 1 };
      const errorMessage = error?.message || 'Unable to fetch metadata fields.';
      const statusMatch = errorMessage.match(/\((\d{3})\)/);
      const statusCode = Number(statusMatch?.[1]) || null;
      const tooMuchData =
        statusCode === 413 || RESPONSE_TOO_LARGE_MESSAGE.test(errorMessage || '') || isTooMuchDataOrTimeout(error);
      clientErrorWithoutRecovery = !tooMuchData && statusCode >= 400 && statusCode < 500;
      const cellMessage = tooMuchData ? 'too much data' : 'Error fetching data';

      const generalMessage = errorMessage?.trim() || 'Unable to fetch metadata fields.';
      const failureMessage = tooMuchData
        ? `Metadata request too large for app ${entry.appId} (${windowDays}d). Try a smaller window.`
        : `Metadata request failed for app ${entry.appId} (${windowDays}d): ${generalMessage}`;

      requestStatus = 'failed';
      requestError = failureMessage;

      showMessage(messageRegion, failureMessage, 'error');

      updateCellContent(visitorCells[windowDays], [], 'visitor');
      updateCellContent(accountCells[windowDays], [], 'account');
      visitorCells[windowDays].textContent = cellMessage;
      accountCells[windowDays].textContent = cellMessage;
      visitorCells[windowDays].classList.toggle(OVER_LIMIT_CLASS, tooMuchData);
      accountCells[windowDays].classList.toggle(OVER_LIMIT_CLASS, tooMuchData);
    } finally {
      updatePendingCallRequestCount(pendingCall, requestSummary?.requestCount || 1);
      resolvePendingCall(pendingCall, requestStatus, requestError);
      queueEntries.delete(pendingKey);
      updateProgressText();

      if (clientErrorWithoutRecovery) {
        abortedEntries.add(entryKey(entry));
        removePendingForEntry(entry);
      }
    }
  };

  const executeWorkItem = async (item) => {
    await handleBaseRequest(item);
  };

  const dispatchNext = () => {
    if (!workQueue.length) {
      if (!inFlight.size && queueIntervalId) {
        clearInterval(queueIntervalId);
        queueIntervalId = null;
      }
      return;
    }

    const nextItem = workQueue.shift();
    const promise = executeWorkItem(nextItem);
    inFlight.add(promise);
    promise
      .catch(() => {})
      .finally(() => {
        inFlight.delete(promise);
      });
  };

  const startScheduler = () => {
    if (queueIntervalId) {
      return;
    }

    queueIntervalId = setInterval(dispatchNext, 3000);
    setTimeout(dispatchNext, 0);
  };

  entries.forEach((entry) => {
    LOOKBACK_WINDOWS.forEach((windowDays) => {
      enqueueWorkItem({ entry, windowDays, payloadType: 'base' });
    });
  });

  startScheduler();
};

export const initMetadataFields = () => {
  metadataFieldsReadyPromise = (async () => {
    const visitorTableBody = document.getElementById('visitor-metadata-table-body');
    const accountTableBody = document.getElementById('account-metadata-table-body');

    if (!visitorTableBody || !accountTableBody) {
      return;
    }

    const messageRegion = createMessageRegion();
    loadMetadataSnapshot();
    const manualAppNames = loadManualAppNames();
    const entries = buildAppEntries(manualAppNames);
    renderQueueBanner();

    if (!entries.length) {
      showMessage(messageRegion, 'No application data available. Start from the SubID form.', 'error');
      renderTableRows(visitorTableBody, []);
      renderTableRows(accountTableBody, []);
      renderQueueBanner('No API calls queued.', 'warning');
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

    const openAppNameModal = await setupManualAppNameModal(
      manualAppNames,
      entries,
      allRows,
      syncMetadataSnapshotAppName,
    );

    if (typeof openAppNameModal === 'function') {
      allRows.forEach(({ entry, appNameButton }) => {
        if (appNameButton) {
          appNameButton.addEventListener('click', () => openAppNameModal(entry));
          appNameButton.setAttribute('aria-label', `Set app name for ${entry.appId}`);
        }
      });
    }

    await fetchAndPopulate(entries, visitorRows, accountRows, messageRegion, manualAppNames);
  })();

  return metadataFieldsReadyPromise;
};

export const waitForMetadataFields = () => metadataFieldsReadyPromise;
