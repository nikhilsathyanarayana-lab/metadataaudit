// Orchestrates the deep dive experience by connecting data helpers, aggregation, and UI flows.
import { buildMetaEventsPayload, postAggregationWithIntegrationKey } from '../services/requests.js';
import { applyManualAppNames, loadManualAppNames } from '../services/appNames.js';
import {
  DEEP_DIVE_CONCURRENCY,
  LOOKBACK_OPTIONS,
  TARGET_LOOKBACK,
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
  ensureMessageRegion,
  installDeepDiveGlobalErrorHandlers,
  renderTable,
  reportDeepDiveError,
  setExportAvailability,
  setupLookbackControls,
  setupProgressTracker,
  showMessage,
  updateMetadataFieldHeaders,
} from './deepDive/ui/render.js';
import { setupManualAppNameModal, setupRegexFormatModal } from './deepDive/ui/modals.js';
import { exportDeepDiveJson } from '../controllers/exports/deep_json.js';
import { exportDeepDiveXlsx } from '../controllers/exports/deep_xlsx.js';

export { exportDeepDiveJson, exportDeepDiveXlsx, installDeepDiveGlobalErrorHandlers, reportDeepDiveError };

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

  const targetLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;
  const queue = entries.slice();
  const totalCalls = queue.length;
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
    totalCalls,
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

  const processEntry = async (entry) => {
    logDeepDive('info', 'Processing deep dive entry', {
      appId: entry.appId,
      subId: entry.subId,
      targetLookback,
    });

    await yieldToBrowser();
    let payload;
    let response = null;
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

      const normalizedFields = await collectDeepDiveMetadataFields(
        response,
        deepDiveAccumulator,
        entry,
      );

      upsertDeepDiveRecord(entry, normalizedFields, '', targetLookback);
      updateMetadataApiCalls(entry, 'success', '');
      await updateMetadataCollections(response, entry);
      response = null;
      successCount += 1;
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

      reportDeepDiveError(
        `Deep dive request failed for app ${entry.appId}: ${detail}`,
        error,
        messageRegion,
      );
    } finally {
      payload = null;
      response = null;
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

    const messageRegion = ensureMessageRegion();
    const { updateText: updateProgress } = setupProgressTracker();
    const startButton = document.getElementById('deep-dive-start');

    const manualAppNames = loadManualAppNames();
    let metadataRecords = loadMetadataRecords(reportDeepDiveError);
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
          buildRowsForLookback(metadataRecords, selectedLookback, reportDeepDiveError),
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

        updateExportAvailability();
        updateProgress(0, buildScanEntries(metadataRecords, manualAppNames, selectedLookback).length);
      } catch (error) {
        reportDeepDiveError('Unable to refresh deep dive tables.', error, messageRegion);
      }
    };

    selectedLookback = setupLookbackControls(refreshTables, selectedLookback);
    refreshTables(selectedLookback);

    if (startButton) {
      startButton.addEventListener('click', async () => {
        startButton.disabled = true;
        startButton.textContent = 'Scanning…';
        showMessage(messageRegion, 'Starting deep dive scan…', 'info');

        try {
          await runDeepDiveScan(
            buildScanEntries(metadataRecords, manualAppNames, selectedLookback),
            selectedLookback,
            updateProgress,
            messageRegion,
            rows,
            () => {
              updateExportAvailability();
            },
            updateExportAvailability,
          );
        } catch (error) {
          reportDeepDiveError(
            'Deep dive scan encountered an unexpected error. Please try again.',
            error,
            messageRegion,
          );
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
