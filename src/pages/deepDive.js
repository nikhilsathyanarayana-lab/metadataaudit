// Orchestrates the deep dive experience by connecting data helpers, aggregation, and UI flows.
import { buildChunkedMetaEventsPayloads, buildMetaEventsPayload, runAggregationWithFallbackWindows } from '../services/requests.js';
import { applyManualAppNames, loadManualAppNames } from '../services/appNames.js';
import {
  DEEP_DIVE_CONCURRENCY,
  LOOKBACK_OPTIONS,
  TARGET_LOOKBACK,
  DEEP_DIVE_REQUEST_SPACING_MS,
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
  metadata_accounts,
  metadata_api_calls,
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

export { exportDeepDiveJson, exportDeepDiveXlsx, installDeepDiveGlobalErrorHandlers, reportDeepDiveError };

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
      updateProcessingProgress?.(completedProcessingSteps, getTotalApiCalls());
    });

  logDeepDive('info', 'Starting deep dive scan', {
    requestedEntries: entries.length,
    totalApiCalls: getTotalApiCalls(),
    targetLookback,
  });

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
    updateProcessingProgress?.(completedProcessingSteps, getTotalApiCalls());
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
        updatePendingMetadataCallRequestCount(entry, payloadCount);
        syncApiProgress();
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

      updatePendingMetadataCallRequestCount(entry, requestSummary?.requestCount || 1);
      syncApiProgress();

      if (!Array.isArray(requestSummary?.aggregatedResults)) {
        throw requestSummary?.lastError || new Error('Aggregation response was empty or malformed.');
      }

      apiCompleted = true;
      syncApiProgress();
      scheduleDomUpdate(() => {
        setProcessingStatus?.(
          `Handling response ${completedProcessingSteps + 1}/${getTotalApiCalls()}.`,
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
      for (const response of requestSummary.aggregatedResults) {
        await updateMetadataCollections(response, entry);
      }
      successCount += 1;
      completedProcessingSteps += 1;
      syncProcessingProgress();
      const durationMs =
        (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) -
        startTime;
      logDeepDive('info', 'Deep dive entry completed', {
        appId: entry.appId,
        subId: entry.subId,
        lookbackDays: targetLookback,
        requestCount: requestSummary?.requestCount || 1,
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
      updatePendingMetadataCallRequestCount(entry, requestSummary?.requestCount || 1);
      syncApiProgress();
      const timedOut = error?.name === 'AbortError' || /timed out/i.test(error?.message || '');
      const detail = timedOut
        ? 'Deep dive request timed out after 60 seconds.'
        : error?.message || 'Unable to fetch metadata events.';
      const normalizedFields = ensureDeepDiveAccumulatorEntry(deepDiveAccumulator, entry);

      upsertDeepDiveRecord(entry, normalizedFields, detail, targetLookback);
      updateMetadataApiCalls(entry, 'error', detail);
      resolvePendingMetadataCall(entry, 'failed', detail);

      if (!apiCompleted) {
        syncApiProgress();
      }
      completedProcessingSteps += 1;
      syncProcessingProgress();

      logDeepDive('info', 'Deep dive entry marked as failed', {
        appId: entry.appId,
        subId: entry.subId,
        lookbackDays: targetLookback,
        apiCompleted,
        timedOut,
        requestCount: requestSummary?.requestCount || 1,
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

  const scheduleDeepDiveRequest = (entry, index) =>
    new Promise((resolve) => {
      const chunkIndex = Math.floor(index / Math.max(DEEP_DIVE_CONCURRENCY, 1));
      const delayMs = chunkIndex * DEEP_DIVE_REQUEST_SPACING_MS;

      logDeepDive('debug', 'Scheduling deep dive request', {
        appId: entry.appId,
        subId: entry.subId,
        chunkIndex,
        delayMs,
      });

      setTimeout(async () => {
        try {
          await processEntry(entry);
        } finally {
          resolve();
        }
      }, delayMs);
    });

  const scheduledRequests = queue.map((entry, index) => scheduleDeepDiveRequest(entry, index));

  logDeepDive('debug', 'Queued deep dive requests for execution', {
    scheduledCount: scheduledRequests.length,
    spacingMs: DEEP_DIVE_REQUEST_SPACING_MS,
    concurrency: DEEP_DIVE_CONCURRENCY,
  });

  await Promise.all(scheduledRequests);

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
      updateProcessingProgress?.(completedProcessingSteps, totalApiCalls);
      setApiError?.(outstandingMessage);
      setProcessingError?.(outstandingMessage);
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

const exposeDeepDiveDebugCommands = () => {
  if (typeof window === 'undefined' || window.showPendingDeepDiveRequests) {
    return;
  }

  window.showPendingDeepDiveRequests = () => {
    const outstanding = getOutstandingMetadataCalls();

    if (!outstanding.length) {
      console.info('No pending deep dive requests.');
      return [];
    }

    const summarized = outstanding.map((call) => ({
      appId: call.appId,
      subId: call.subId,
      status: call.status,
      queuedAt: call.queuedAt,
      startedAt: call.startedAt,
    }));

    console.table(summarized);
    return outstanding;
  };

  logDeepDive('info', 'Deep dive pending request inspector installed.');
};

export const initDeepDive = async () => {
  try {
    logDeepDive('info', 'Initializing deep dive experience');
    const visitorTableBody = document.getElementById('visitor-deep-dive-table-body');
    const accountTableBody = document.getElementById('account-deep-dive-table-body');

    if (!visitorTableBody || !accountTableBody) {
      return;
    }

    exposeDeepDiveDebugCommands();

    const progressHandlers = setupProgressTracker();
    const startButton = document.getElementById('deep-dive-start');

    const manualAppNames = loadManualAppNames();
    let metadataRecords = loadMetadataRecords();
    const deepDiveRecords = loadDeepDiveRecords();
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
      setExportAvailability(rows.length > 0 || deepDiveRecords.length > 0);
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

        const totalEntries = buildScanEntries(metadataRecords, manualAppNames, selectedLookback).length;
        progressHandlers.updateProcessingProgress(0, totalEntries);
        progressHandlers.updateApiProgress(0, totalEntries);
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
          await runDeepDiveScan(
            buildScanEntries(metadataRecords, manualAppNames, selectedLookback),
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
