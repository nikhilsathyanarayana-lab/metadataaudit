// Orchestrates the deep dive experience by connecting data helpers, aggregation, and UI flows.
import { buildChunkedMetaEventsPayloads, buildMetaEventsPayload, runAggregationWithFallbackWindows } from '../services/requests.js';
import { applyManualAppNames, loadManualAppNames } from '../services/appNames.js';
import {
  DEEP_DIVE_CONCURRENCY,
  LOOKBACK_OPTIONS,
  TARGET_LOOKBACK,
  DEEP_DIVE_REQUEST_SPACING_MS,
  deepDiveGlobalKey,
  logDeepDive,
} from './deepDive/constants.js';
import {
  buildRowsForLookback,
  buildScanEntries,
  loadDeepDiveRecords,
  loadMetadataRecords,
  scheduleDomUpdate,
  syncDeepDiveRecordsAppName,
  syncMetadataRecordsAppName,
  upsertDeepDiveRecord,
  yieldToBrowser,
} from './deepDive/dataHelpers.js';
import {
  clearDeepDiveCollections,
  collectDeepDiveMetadataFields,
  ensureDeepDiveAccumulatorEntry,
  getOutstandingMetadataCalls,
  getMetadataShapeAnomalies,
  metadata_accounts,
  metadata_api_calls,
  metadata_pending_api_calls,
  metadata_visitors,
  markPendingMetadataCallStarted,
  updateMetadataApiCalls,
  registerPendingMetadataCall,
  resolvePendingMetadataCall,
  summarizePendingMetadataCallProgress,
  updateMetadataCollections,
  updatePendingMetadataCallRequestCount,
} from './deepDive/aggregation.js';
import {
  installDeepDiveGlobalErrorHandlers,
  renderTable,
  reportDeepDiveError,
  setExportAvailability,
  setupLookbackControls,
  setupProgressTracker,
  updateMetadataFieldHeaders,
} from './deepDive/ui/render.js';
import { setupManualAppNameModal, setupRegexFormatModal } from './deepDive/ui/modals.js';
import { exportDeepDiveJson } from '../controllers/exports/deep_json.js';
import { exportDeepDiveXlsx } from '../controllers/exports/deep_xlsx.js';
import { exposeDeepDiveDebugCommands } from './deepDive/debug.js';
import { summarizeJsonShape } from './deepDive/shapeUtils.js';

export { exportDeepDiveJson, exportDeepDiveXlsx, installDeepDiveGlobalErrorHandlers, reportDeepDiveError };

const STALL_WATCHDOG_INTERVAL_MS = 5_000;
const API_CALL_TIMEOUT_MS = 60_000;

const deepDiveCallPlan = [];

const syncCallPlanToWindow = () => {
  if (typeof window !== 'undefined') {
    window.deepDiveCallPlan = deepDiveCallPlan;
  }
};

const stageDeepDiveCallPlan = (entries, lookbackDays) => {
  const timestamp = new Date().toISOString();

  deepDiveCallPlan.splice(
    0,
    deepDiveCallPlan.length,
    ...entries.map((entry) => ({
      appId: entry.appId,
      subId: entry.subId || '',
      lookbackDays,
      status: 'Queued',
      detail: '',
      plannedAt: timestamp,
      updatedAt: timestamp,
    })),
  );

  syncCallPlanToWindow();

  if (entries.length) {
    logDeepDive('info', 'Prepared deep dive call plan', { plannedCalls: entries.length, lookbackDays });
  }

  return deepDiveCallPlan;
};

const updateDeepDiveCallPlanStatus = (entry, status, detail = '') => {
  const appId = typeof entry === 'string' ? entry : entry?.appId;

  if (!appId) {
    return null;
  }

  const target = deepDiveCallPlan.find((call) => call?.appId === appId);

  if (!target) {
    return null;
  }

  target.status = status;
  target.detail = detail;
  target.updatedAt = new Date().toISOString();

  syncCallPlanToWindow();

  return target;
};

syncCallPlanToWindow();

const calculateStallThreshold = (call) => {
  const queueIndex = metadata_pending_api_calls.findIndex((item) => item?.appId === call?.appId);
  const position = queueIndex === -1 ? 1 : queueIndex + 1;

  return API_CALL_TIMEOUT_MS + position * DEEP_DIVE_REQUEST_SPACING_MS;
};

const runDeepDiveScan = async (entries, lookback, progressHandlers, rows, onSuccessfulCall, onComplete) => {
  clearDeepDiveCollections();

  const updateApiProgress =
    typeof progressHandlers === 'function' ? progressHandlers : progressHandlers?.updateApiProgress;
  const updateProcessingProgress =
    typeof progressHandlers === 'object' && progressHandlers !== null
      ? progressHandlers.updateProcessingProgress
      : null;
  const setApiStatus = progressHandlers?.setApiStatus;
  const setProcessingStatus = progressHandlers?.setProcessingStatus;
  const setApiError = progressHandlers?.setApiError;
  const setProcessingError = progressHandlers?.setProcessingError;

  const targetLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;
  const queue = entries.slice();
  stageDeepDiveCallPlan(queue, targetLookback);
  queue.forEach(registerPendingMetadataCall);
  logDeepDive('info', 'Prepared deep dive request queue', {
    queuedEntries: queue.length,
    requestedLookback: lookback,
    targetLookback,
  });
  let { total: totalApiCalls, completed: completedApiCalls } =
    summarizePendingMetadataCallProgress();
  let completedProcessingSteps = 0;
  let successCount = 0;
  const deepDiveAccumulator = new Map();

  const getTotalApiCalls = () => {
    const { total } = summarizePendingMetadataCallProgress();
    if (total > 0) {
      totalApiCalls = total;
    }
    return totalApiCalls;
  };

  const syncApiProgress = () =>
    scheduleDomUpdate(() => {
      const { completed, total } = summarizePendingMetadataCallProgress();

      if (total > 0) {
        totalApiCalls = total;
      }

      completedApiCalls = Math.max(completedApiCalls, completed);
      updateApiProgress?.(completedApiCalls, totalApiCalls);
    });

  const syncProcessingProgress = () =>
    scheduleDomUpdate(() => {
      updateProcessingProgress?.(completedProcessingSteps, getTotalApiCalls(), completedApiCalls);
    });

  const normalizeRequestCount = (summary) => {
    const count = Number.isFinite(summary?.requestCount) ? summary.requestCount : 1;

    return Math.max(count, 1);
  };

  logDeepDive('info', 'Starting deep dive scan', {
    requestedEntries: entries.length,
    totalApiCalls: getTotalApiCalls(),
    targetLookback,
  });

  const entryLookup = new Map(queue.map((entry) => [entry.appId, entry]));
  const pendingResolvers = new Map();

  const watchdogController = (() => {
    let watchdogId = null;

    const resolveStalledCall = (call, ageMs, thresholdMs) => {
      const entry = entryLookup.get(call.appId) || call;
      const stalledMessage =
        `Deep dive request stalled after ${Math.round(ageMs / 1000)} seconds ` +
        `(threshold: ${Math.round(thresholdMs / 1000)} seconds).`;
      const resolver = pendingResolvers.get(call.appId);

      resolvePendingMetadataCall(entry, 'failed', stalledMessage);
      updateMetadataApiCalls(entry, 'error', stalledMessage);
      updateDeepDiveCallPlanStatus(entry, 'Error', stalledMessage);

      completedProcessingSteps += normalizeRequestCount(call);
      syncApiProgress();
      syncProcessingProgress();

      logDeepDive('warn', 'Detected stalled deep dive request', {
        appId: call.appId,
        subId: call.subId,
        status: call.status,
        ageMs: Math.round(ageMs),
        stallThresholdMs: Math.round(thresholdMs),
      });

      if (resolver?.cancel) {
        resolver.cancel('stalled');
      }
    };

    const checkForStalledCalls = () => {
      const now = Date.now();

      metadata_pending_api_calls
        .filter((call) => call && (call.status === 'queued' || call.status === 'in-flight'))
        .forEach((call) => {
          const queuedAtMs = Date.parse(call.queuedAt);
          const ageMs = Number.isFinite(queuedAtMs) ? now - queuedAtMs : 0;
          const stallThresholdMs = calculateStallThreshold(call);

          if (ageMs >= stallThresholdMs) {
            resolveStalledCall(call, ageMs, stallThresholdMs);
          }
        });
    };

    return {
      start: () => {
        if (!watchdogId) {
          watchdogId = setInterval(checkForStalledCalls, STALL_WATCHDOG_INTERVAL_MS);
        }
      },
      stop: () => {
        if (watchdogId) {
          clearInterval(watchdogId);
          watchdogId = null;
        }
      },
    };
  })();

  if (!getTotalApiCalls()) {
    syncApiProgress();
    scheduleDomUpdate(() => {
      setApiError?.(
        'No metadata selections found. Run the Metadata Fields page first to capture app details.',
      );
      setProcessingStatus?.('Response queue idle.');
    });
    return;
  }

  scheduleDomUpdate(() => {
    updateApiProgress?.(completedApiCalls, getTotalApiCalls());
    updateProcessingProgress?.(completedProcessingSteps, getTotalApiCalls(), completedApiCalls);
    setApiStatus?.('Starting deep dive scan…');
    setProcessingStatus?.('Waiting for the first API response…');
  });

  const processEntry = async (entry) => {
    logDeepDive('info', 'Processing deep dive entry', {
      appId: entry.appId,
      subId: entry.subId,
      targetLookback,
    });

    const startTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    await yieldToBrowser();
    markPendingMetadataCallStarted(entry);
    let requestSummary = { requestCount: 1 };
    let apiCompleted = false;
    try {
      const onWindowSplit = (windowSize, payloadCount) => {
        logDeepDive('info', 'Splitting deep dive request into smaller windows', {
          appId: entry.appId,
          windowSize,
          payloadCount,
        });
        updateDeepDiveCallPlanStatus(entry, 'Split', `Split into ${payloadCount} windows.`);
        updatePendingMetadataCallRequestCount(entry, normalizeRequestCount({ requestCount: payloadCount }));
        syncApiProgress();
        syncProcessingProgress();
        scheduleDomUpdate(() => {
          setApiStatus?.(
            `Splitting ${windowSize}-day deep dive into ${payloadCount} request${payloadCount === 1 ? '' : 's'}…`,
          );
        });
      };

      requestSummary = await runAggregationWithFallbackWindows({
        entry,
        totalWindowDays: targetLookback,
        buildBasePayload: (windowSize) => buildMetaEventsPayload(entry.appId, windowSize),
        buildChunkedPayloads: (windowSize, chunkSize) =>
          buildChunkedMetaEventsPayloads(entry.appId, windowSize, chunkSize),
        aggregateResults: (collector, response) => collector.push(response),
        onWindowSplit,
      });

      const resolvedRequestCount = normalizeRequestCount(requestSummary);

      updatePendingMetadataCallRequestCount(entry, resolvedRequestCount);
      syncApiProgress();
      syncProcessingProgress();

      if (!Array.isArray(requestSummary?.aggregatedResults)) {
        throw requestSummary?.lastError || new Error('Aggregation response was empty or malformed.');
      }

      apiCompleted = true;
      syncApiProgress();
      scheduleDomUpdate(() => {
        setProcessingStatus?.(
          `Handling response ${completedProcessingSteps + resolvedRequestCount}/${getTotalApiCalls()}.`,
        );
      });

      let normalizedFields = null;
      let datasetCount = 0;

      for (const response of requestSummary.aggregatedResults) {
        normalizedFields = await collectDeepDiveMetadataFields(response, deepDiveAccumulator, entry);
        datasetCount = Number.isFinite(normalizedFields?.datasetCount)
          ? normalizedFields.datasetCount
          : datasetCount;
      }

      upsertDeepDiveRecord(entry, normalizedFields, '', targetLookback);
      updateMetadataApiCalls(entry, 'success', '', datasetCount);
      resolvePendingMetadataCall(entry, 'completed');
      updateDeepDiveCallPlanStatus(entry, 'Completed');
      for (const response of requestSummary.aggregatedResults) {
        await updateMetadataCollections(response, entry);
      }
      successCount += 1;
      completedProcessingSteps += resolvedRequestCount;
      syncProcessingProgress();
      const durationMs =
        (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) -
        startTime;

      logDeepDive('info', 'Deep dive entry completed', {
        appId: entry.appId,
        subId: entry.subId,
        lookbackDays: targetLookback,
        requestCount: resolvedRequestCount,
        responseCount: requestSummary?.aggregatedResults?.length || 0,
        datasetCount,
        visitorFieldCount: normalizedFields?.visitorFields?.size || 0,
        accountFieldCount: normalizedFields?.accountFields?.size || 0,
        durationMs: Math.round(durationMs),
      });
      if (onSuccessfulCall) {
        scheduleDomUpdate(() => onSuccessfulCall());
      }
    } catch (error) {
      const resolvedRequestCount = normalizeRequestCount(requestSummary);

      updatePendingMetadataCallRequestCount(entry, resolvedRequestCount);
      syncApiProgress();
      syncProcessingProgress();
      const timedOut = error?.name === 'AbortError' || /timed out/i.test(error?.message || '');
      const detail = timedOut
        ? 'Deep dive request timed out after 60 seconds.'
        : error?.message || 'Unable to fetch metadata events.';
      const normalizedFields = ensureDeepDiveAccumulatorEntry(deepDiveAccumulator, entry);

      upsertDeepDiveRecord(entry, normalizedFields, detail, targetLookback);
      updateMetadataApiCalls(entry, 'error', detail);
      resolvePendingMetadataCall(entry, 'failed', detail);
      updateDeepDiveCallPlanStatus(entry, 'Error', detail);

      if (!apiCompleted) {
        syncApiProgress();
      }
      completedProcessingSteps += resolvedRequestCount;
      syncProcessingProgress();

      logDeepDive('info', 'Deep dive entry marked as failed', {
        appId: entry.appId,
        subId: entry.subId,
        lookbackDays: targetLookback,
        apiCompleted,
        timedOut,
        requestCount: resolvedRequestCount,
      });

      const targetSetter = apiCompleted ? setProcessingError : setApiError;
      const errorTargetLabel = apiCompleted ? 'response handling' : 'API';
      scheduleDomUpdate(() => {
        targetSetter?.(`Deep dive ${errorTargetLabel} error for app ${entry.appId}: ${detail}`);
      });

      if (apiCompleted) {
        logDeepDive('error', 'Deep dive response handling failed', { appId: entry.appId, error });
      } else {
        logDeepDive('error', 'Deep dive request failed', { appId: entry.appId, error });
      }
    } finally {
      requestSummary = null;
    }
  };

  const requestQueue = [];
  let activeRequests = 0;
  let lastDispatchAtMs = 0;

  const dispatchNextRequest = async () => {
    if (activeRequests >= Math.max(DEEP_DIVE_CONCURRENCY, 1)) {
      return;
    }

    const nextRequest = requestQueue.shift();
    if (!nextRequest) {
      return;
    }

    const { entry, resolver } = nextRequest;

    if (resolver.resolved) {
      dispatchNextRequest();
      return;
    }

    activeRequests += 1;

    const elapsedSinceLastDispatch = Date.now() - lastDispatchAtMs;
    const delayMs = Math.max(DEEP_DIVE_REQUEST_SPACING_MS - Math.max(elapsedSinceLastDispatch, 0), 0);

    logDeepDive('debug', 'Dispatching deep dive request', {
      appId: entry.appId,
      subId: entry.subId,
      delayMs,
      activeRequests,
    });

    updateDeepDiveCallPlanStatus(entry, 'Calling');

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    lastDispatchAtMs = Date.now();

    if (resolver.cancelled) {
      logDeepDive('warn', 'Skipping cancelled deep dive request', {
        appId: entry.appId,
        subId: entry.subId,
        reason: resolver.reason || 'unknown',
      });
      resolver.safeResolve();
      activeRequests -= 1;
      dispatchNextRequest();
      return;
    }

    try {
      await processEntry(entry);
    } finally {
      resolver.safeResolve();
      activeRequests -= 1;
      dispatchNextRequest();
    }
  };

  const scheduleDeepDiveRequest = (entry, index) =>
    new Promise((resolve) => {
      const resolver = {
        resolved: false,
        cancelled: false,
        cancel: (reason = '') => {
          resolver.cancelled = true;
          resolver.reason = reason;
          resolver.safeResolve();
        },
        safeResolve: () => {
          if (resolver.resolved) {
            return;
          }

          resolver.resolved = true;
          pendingResolvers.delete(entry.appId);
          resolve();
        },
      };

      logDeepDive('debug', 'Scheduling deep dive request', {
        appId: entry.appId,
        subId: entry.subId,
        queueIndex: index,
      });

      pendingResolvers.set(entry.appId, resolver);
      requestQueue.push({ entry, resolver });
      dispatchNextRequest();
    });

  const scheduledRequests = queue.map((entry, index) => scheduleDeepDiveRequest(entry, index));

  logDeepDive('debug', 'Queued deep dive requests for execution', {
    scheduledCount: scheduledRequests.length,
    spacingMs: DEEP_DIVE_REQUEST_SPACING_MS,
    concurrency: DEEP_DIVE_CONCURRENCY,
  });

  const completionGuard = new Promise((resolve) => {
    const checkForCompletion = () => {
      const { completed, total } = summarizePendingMetadataCallProgress();
      const outstanding = getOutstandingMetadataCalls();
      const stalledOutstanding = outstanding.filter((call) => {
        const queuedAtMs = Date.parse(call.queuedAt);
        const ageMs = Number.isFinite(queuedAtMs) ? Date.now() - queuedAtMs : 0;

        return ageMs >= calculateStallThreshold(call);
      });

      const queueDrained = requestQueue.length === 0 && activeRequests === 0;
      const finished = total > 0 && completed >= total && queueDrained;

      if (finished || stalledOutstanding.length) {
        resolve(stalledOutstanding.length ? 'stalled' : 'completed');
        return;
      }

      setTimeout(checkForCompletion, STALL_WATCHDOG_INTERVAL_MS);
    };

    checkForCompletion();
  });

  watchdogController.start();

  const scheduledResolution = Promise.all(scheduledRequests).then(() => 'scheduled');

  let raceOutcome = null;

  try {
    raceOutcome = await Promise.race([scheduledResolution, completionGuard]);
  } finally {
    watchdogController.stop();
    if (raceOutcome === 'stalled') {
      pendingResolvers.forEach((resolver) => resolver.cancel?.('completion-guard'));
    }
    await scheduledResolution.catch(() => {});
  }

  const cancelledPendingCalls = metadata_pending_api_calls.filter(
    (call) => call && call.status !== 'completed' && call.status !== 'failed',
  );

  if (cancelledPendingCalls.length) {
    const cancellationMessage = 'Deep dive cancelled before pending requests finished.';

    cancelledPendingCalls.forEach((call) => {
      const entry = entryLookup.get(call.appId) || call;

      resolvePendingMetadataCall(entry, 'failed', cancellationMessage);
      updateMetadataApiCalls(entry, 'error', cancellationMessage);
      updateDeepDiveCallPlanStatus(entry, 'Error', cancellationMessage);
      completedProcessingSteps += normalizeRequestCount(call);
    });

    const { completed, total } = summarizePendingMetadataCallProgress();
    completedApiCalls = Math.max(completedApiCalls, completed);
    totalApiCalls = Math.max(totalApiCalls, total);

    syncApiProgress();
    syncProcessingProgress();

    scheduleDomUpdate(() => {
      updateApiProgress?.(completedApiCalls, totalApiCalls);
      updateProcessingProgress?.(completedProcessingSteps, totalApiCalls, completedApiCalls);
      setApiError?.(cancellationMessage);
      setProcessingError?.(cancellationMessage);
    });

    logDeepDive('warn', 'Marked cancelled deep dive requests as failed', {
      cancelledCallCount: cancelledPendingCalls.length,
    });
  }

  const outstandingAfter = getOutstandingMetadataCalls();
  logDeepDive('info', 'Deep dive request scheduling complete', {
    scheduledCount: scheduledRequests.length,
    outstandingCalls: outstandingAfter.length,
  });

  if (outstandingAfter.length) {
    logDeepDive('warn', 'Outstanding deep dive requests detected after scan resolution', {
      outstandingCalls: outstandingAfter.map((call) => ({
        appId: call.appId,
        subId: call.subId,
        status: call.status,
      })),
    });

    const { completed, total } = summarizePendingMetadataCallProgress();
    completedApiCalls = Math.max(completedApiCalls, completed);
    totalApiCalls = Math.max(totalApiCalls, total);

    const outstandingMessage = `${outstandingAfter.length} deep-dive request${
      outstandingAfter.length === 1 ? '' : 's'
    } are still queued; reload or retry.`;

    scheduleDomUpdate(() => {
      updateApiProgress?.(completedApiCalls, totalApiCalls);
      updateProcessingProgress?.(completedProcessingSteps, totalApiCalls, completedApiCalls);
      setApiError?.(outstandingMessage);
      setProcessingError?.(outstandingMessage);
    });
  }

  const failedApiCalls = metadata_api_calls.filter((call) => call?.status !== 'success');
  if (failedApiCalls.length) {
    const failedMessage = `${failedApiCalls.length} deep dive request${
      failedApiCalls.length === 1 ? '' : 's'
    } failed; rerun the scan to avoid incomplete exports.`;

    scheduleDomUpdate(() => {
      setApiError?.(failedMessage);
      setProcessingError?.(failedMessage);
    });

    logDeepDive('warn', 'Deep dive recorded failed API calls; exports will mark these apps incomplete', {
      failedCalls: failedApiCalls.map((call) => ({
        appId: call.appId,
        subId: call.subId,
        status: call.status,
        error: call.error,
        recordedAt: call.recordedAt,
      })),
    });
  }

  if (successCount) {
    scheduleDomUpdate(() => {
      setApiStatus?.(`Completed ${successCount} deep dive request${successCount === 1 ? '' : 's'}.`);
    });
  }

  const { completed: resolvedCalls, total: finalTotal } = summarizePendingMetadataCallProgress();
  completedApiCalls = Math.max(completedApiCalls, resolvedCalls);
  totalApiCalls = Math.max(totalApiCalls, finalTotal);

  const completionLabel = outstandingAfter.length
    ? `Deep dive finished with ${outstandingAfter.length} outstanding request${
        outstandingAfter.length === 1 ? '' : 's'
      }.`
    : 'Deep dive complete.';

  scheduleDomUpdate(() => {
    updateApiProgress?.(completedApiCalls, totalApiCalls);
    updateProcessingProgress?.(completedProcessingSteps, totalApiCalls, completedApiCalls);
    setApiStatus?.(completionLabel);
    setProcessingStatus?.(completionLabel);
  });

  logDeepDive('info', 'Deep dive scan completed', {
    completedCalls: completedApiCalls,
    successCount,
    totalCalls: totalApiCalls,
  });

  const clearTransientCallData = () => metadata_api_calls.splice(0, metadata_api_calls.length);

  if (onComplete) {
    scheduleDomUpdate(() => {
      onComplete();
      clearTransientCallData();
    });
  } else {
    clearTransientCallData();
  }
};

const hydrateCachedExportCollections = () => {
  const cachedDeepDive = typeof window !== 'undefined' ? window.deepDiveData?.[deepDiveGlobalKey] : null;

  if (!cachedDeepDive || typeof cachedDeepDive !== 'object') {
    return false;
  }

  const isValidExportRow = (row) =>
    row && typeof row === 'object' && typeof row.appId === 'string' && row.appId.trim().length > 0;

  const sanitizeSnapshot = (snapshot, source) => {
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      return [];
    }

    const validRows = snapshot.filter(isValidExportRow);

    if (!validRows.length) {
      logDeepDive('warn', 'Rejected cached deep dive export snapshot', {
        source,
        totalRows: snapshot.length,
        sampleShape: summarizeJsonShape(snapshot.slice(0, 3)),
      });
      return [];
    }

    if (validRows.length !== snapshot.length) {
      logDeepDive('warn', 'Filtered invalid rows from cached deep dive export snapshot', {
        source,
        totalRows: snapshot.length,
        validRows: validRows.length,
        sampleShape: summarizeJsonShape(snapshot.slice(0, 3)),
      });
    }

    return validRows;
  };

  const extractCachedCollection = (keys) => {
    const containers = [cachedDeepDive];

    if (cachedDeepDive.records && typeof cachedDeepDive.records === 'object') {
      containers.push(cachedDeepDive.records);
    }

    for (const container of containers) {
      if (!container || typeof container !== 'object') {
        continue;
      }

      for (const key of keys) {
        const snapshot = container[key];

        if (Array.isArray(snapshot) && snapshot.length > 0) {
          return { snapshot, source: key };
        }
      }
    }

    return null;
  };

  const applySnapshot = (target, cachedCollection) => {
    if (!Array.isArray(target) || !cachedCollection) {
      return false;
    }

    const sanitized = sanitizeSnapshot(cachedCollection.snapshot, cachedCollection.source);

    if (!sanitized.length) {
      return false;
    }

    target.splice(0, target.length, ...sanitized);
    return true;
  };

  const hydratedVisitors = applySnapshot(
    metadata_visitors,
    extractCachedCollection(['metadata_visitors', 'visitors']),
  );
  const hydratedAccounts = applySnapshot(
    metadata_accounts,
    extractCachedCollection(['metadata_accounts', 'accounts']),
  );

  if (hydratedVisitors || hydratedAccounts) {
    logDeepDive('info', 'Hydrated cached deep dive export collections', {
      visitors: metadata_visitors.length,
      accounts: metadata_accounts.length,
    });
  }

  return hydratedVisitors || hydratedAccounts;
};

export const initDeepDive = async () => {
  try {
    logDeepDive('info', 'Initializing deep dive experience');
    const visitorTableBody = document.getElementById('visitor-deep-dive-table-body');
    const accountTableBody = document.getElementById('account-deep-dive-table-body');

    if (!visitorTableBody || !accountTableBody) {
      return;
    }

    exposeDeepDiveDebugCommands({ deepDiveCallPlan, calculateStallThreshold });

    const progressHandlers = setupProgressTracker();
    const startButton = document.getElementById('deep-dive-start');

    const manualAppNames = loadManualAppNames();
    let metadataRecords = loadMetadataRecords();
    const deepDiveRecords = loadDeepDiveRecords();
    hydrateCachedExportCollections();
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
      const hasAggregatedRows = metadata_visitors.length > 0 || metadata_accounts.length > 0;

      setExportAvailability(rows.length > 0 || deepDiveRecords.length > 0 || hasAggregatedRows);
    };

    const refreshTables = (lookback = selectedLookback) => {
      try {
        selectedLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;

        logDeepDive('info', 'Refreshing deep dive tables', {
          requestedLookback: lookback,
          selectedLookback,
        });

        const nextRows = applyManualAppNames(
          buildRowsForLookback(metadataRecords, selectedLookback),
          manualAppNames,
        );

        rows.splice(0, rows.length, ...nextRows);
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

        const plannedEntries = buildScanEntries(metadataRecords, manualAppNames, selectedLookback);
        stageDeepDiveCallPlan(plannedEntries, selectedLookback);
        progressHandlers.updateProcessingProgress(0, plannedEntries.length, 0);
        progressHandlers.updateApiProgress(0, plannedEntries.length);
        updateExportAvailability();
      } catch (error) {
        progressHandlers.setProcessingError?.('Unable to refresh deep dive tables.');
        reportDeepDiveError('Unable to refresh deep dive tables.', error);
      }
    };

    selectedLookback = setupLookbackControls(refreshTables, selectedLookback);
    refreshTables(selectedLookback);

    if (startButton) {
      startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        startButton.textContent = 'Scanning…';
        progressHandlers.setApiStatus?.('Starting deep dive scan…');
        progressHandlers.setProcessingStatus?.('Waiting for the first API response…');

        try {
          const scanEntries = buildScanEntries(metadataRecords, manualAppNames, selectedLookback);
          stageDeepDiveCallPlan(scanEntries, selectedLookback);
          await runDeepDiveScan(
            scanEntries,
            selectedLookback,
            progressHandlers,
            rows,
            () => {
              updateExportAvailability();
            },
            updateExportAvailability,
          );
        } catch (error) {
          progressHandlers.setApiError?.(
            'Deep dive scan encountered an unexpected error. Please try again.',
          );
          reportDeepDiveError('Deep dive scan encountered an unexpected error. Please try again.', error);
        } finally {
          startButton.disabled = false;
          startButton.textContent = 'Start scan';
        }
      });
    }
  } catch (error) {
    reportDeepDiveError(
      'Unable to initialize the deep dive experience. Please refresh and try again.',
      error,
    );
  }
};
