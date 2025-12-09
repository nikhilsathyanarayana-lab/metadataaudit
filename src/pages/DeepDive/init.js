import { applyManualAppNames, loadManualAppNames } from '../../services/appNames.js';
import {
  buildRowsForLookback,
  buildScanEntries,
  loadDeepDiveRecords,
  loadMetadataRecords,
  syncDeepDiveRecordsAppName,
  syncMetadataRecordsAppName,
} from '../deepDive/dataHelpers.js';
import { exposeDeepDiveDebugCommands } from '../deepDive/debug.js';
import { metadata_accounts, metadata_visitors } from '../deepDive/aggregation.js';
import {
  LOOKBACK_OPTIONS,
  TARGET_LOOKBACK,
  deepDiveGlobalKey,
  logDeepDive,
  logDeepDiveFunctionCall,
} from '../deepDive/constants.js';
import { summarizeJsonShape } from '../deepDive/shapeUtils.js';
import {
  setExportAvailability,
  setupProgressTracker,
  updateMetadataFieldHeaders,
  renderTable,
  setupLookbackControls,
  reportDeepDiveError,
} from '../deepDive/ui/render.js';
import { setupManualAppNameModal, setupRegexFormatModal } from '../deepDive/ui/modals.js';
import { stageDeepDiveCallPlan } from './plan.js';
import { runDeepDiveScan } from './runner.js';

const hydrateCachedExportCollections = () => {
  logDeepDiveFunctionCall('hydrateCachedExportCollections');
  const cachedDeepDive =
    typeof window !== 'undefined' ? window.deepDiveData?.[deepDiveGlobalKey] : null;

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
    logDeepDiveFunctionCall('applySnapshot', {
      hasTarget: Array.isArray(target),
      hasCachedCollection: Boolean(cachedCollection),
    });
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

const initDeepDive = async () => {
  logDeepDiveFunctionCall('initDeepDive');
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
    hydrateCachedExportCollections();
    const rows = [];
    const renderedRows = [];
    const getRenderedRows = () => renderedRows;
    const openAppNameModal = await setupManualAppNameModal(
      manualAppNames,
      rows,
      getRenderedRows,
      (appId, appName, subId) => {
        metadataRecords = syncMetadataRecordsAppName(appId, appName, metadataRecords, subId);
        syncDeepDiveRecordsAppName(appId, appName, subId);
      },
    );
    const openRegexModal = await setupRegexFormatModal();

    let selectedLookback = TARGET_LOOKBACK;

    const updateExportAvailability = () => {
      logDeepDiveFunctionCall('updateExportAvailability');
      const hasAggregatedRows = metadata_visitors.length > 0 || metadata_accounts.length > 0;

      setExportAvailability(rows.length > 0 || deepDiveRecords.length > 0 || hasAggregatedRows);
    };

    const refreshTables = (lookback = selectedLookback) => {
      logDeepDiveFunctionCall('refreshTables', { requestedLookback: lookback });
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

export { hydrateCachedExportCollections, initDeepDive };
