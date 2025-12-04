// Orchestrates the deep dive experience by connecting data helpers, aggregation, and UI flows.
import { buildMetaEventsPayload, postAggregationWithIntegrationKey } from '../services/requests.js';
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
  metadata_accounts,
  metadata_api_calls,
  metadata_visitors,
  updateMetadataApiCalls,
  updateMetadataCollections,
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
  const totalApiCalls = queue.length;
  let completedApiCalls = 0;
  let completedProcessingSteps = 0;
  let successCount = 0;
  const deepDiveAccumulator = new Map();

  const syncApiProgress = () =>
    scheduleDomUpdate(() => {
      updateApiProgress?.(completedApiCalls, totalApiCalls);
    });

  const syncProcessingProgress = () =>
    scheduleDomUpdate(() => {
      updateProcessingProgress?.(completedProcessingSteps, totalApiCalls);
    });

  logDeepDive('info', 'Starting deep dive scan', {
    requestedEntries: entries.length,
    totalApiCalls,
    targetLookback,
  });

  if (!totalApiCalls) {
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
    updateApiProgress?.(completedApiCalls, totalApiCalls);
    updateProcessingProgress?.(completedProcessingSteps, totalApiCalls);
    setApiStatus?.('Starting deep dive scan…');
    setProcessingStatus?.('Waiting for the first API response…');
  });

  const processEntry = async (entry) => {
    logDeepDive('info', 'Processing deep dive entry', {
      appId: entry.appId,
      subId: entry.subId,
      targetLookback,
    });

    await yieldToBrowser();
    let payload;
    let response = null;
    let apiCompleted = false;
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

      response = await postAggregationWithIntegrationKey(entry, payload);

      if (!response || typeof response !== 'object') {
        throw new Error('Aggregation response was empty or malformed.');
      }

      apiCompleted = true;
      completedApiCalls += 1;
      syncApiProgress();
      scheduleDomUpdate(() => {
        setProcessingStatus?.(`Handling response ${completedProcessingSteps + 1}/${totalApiCalls}.`);
      });

      const normalizedFields = await collectDeepDiveMetadataFields(
        response,
        deepDiveAccumulator,
        entry,
      );

      const datasetCount = Number.isFinite(normalizedFields?.datasetCount)
        ? normalizedFields.datasetCount
        : 0;

      upsertDeepDiveRecord(entry, normalizedFields, '', targetLookback);
      updateMetadataApiCalls(entry, 'success', '', datasetCount);
      await updateMetadataCollections(response, entry);
      response = null;
      successCount += 1;
      completedProcessingSteps += 1;
      syncProcessingProgress();
      if (onSuccessfulCall) {
        scheduleDomUpdate(() => onSuccessfulCall());
      }
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || /timed out/i.test(error?.message || '');
      const detail = timedOut
        ? 'Deep dive request timed out after 60 seconds.'
        : error?.message || 'Unable to fetch metadata events.';
      const normalizedFields = ensureDeepDiveAccumulatorEntry(deepDiveAccumulator, entry);

      upsertDeepDiveRecord(entry, normalizedFields, detail, targetLookback);
      updateMetadataApiCalls(entry, 'error', detail);

      if (!apiCompleted) {
        completedApiCalls += 1;
        syncApiProgress();
      }
      completedProcessingSteps += 1;
      syncProcessingProgress();

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
      payload = null;
      response = null;
    }
  };

  const scheduleDeepDiveRequest = (entry, index) =>
    new Promise((resolve) => {
      const chunkIndex = Math.floor(index / Math.max(DEEP_DIVE_CONCURRENCY, 1));
      const delayMs = chunkIndex * DEEP_DIVE_REQUEST_SPACING_MS;

      setTimeout(async () => {
        try {
          await processEntry(entry);
        } finally {
          resolve();
        }
      }, delayMs);
    });

  const scheduledRequests = queue.map((entry, index) => scheduleDeepDiveRequest(entry, index));

  await Promise.all(scheduledRequests);

  if (successCount) {
    scheduleDomUpdate(() => {
      setApiStatus?.(`Completed ${successCount} deep dive request${successCount === 1 ? '' : 's'}.`);
    });
  }

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

export const initDeepDive = async () => {
  try {
    logDeepDive('info', 'Initializing deep dive experience');
    const visitorTableBody = document.getElementById('visitor-deep-dive-table-body');
    const accountTableBody = document.getElementById('account-deep-dive-table-body');

    if (!visitorTableBody || !accountTableBody) {
      return;
    }

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
