// Executes the deep dive workflow: queue setup, request scheduling, response handling, and cleanup.
import { buildChunkedMetaEventsPayloads, buildMetaEventsPayload } from '../../services/payloads/index.js';
import { runAggregationWithFallbackWindows } from '../../services/requests/network.js';
import {
  clearDeepDiveCollections,
  buildPendingRequestSignature,
  collectDeepDiveMetadataFields,
  ensureDeepDiveAccumulatorEntry,
  getOutstandingPendingCalls,
  getOutstandingMetadataCalls,
  getNextQueuedPendingCall,
  hasQueuedPendingCalls,
  metadata_api_calls,
  metadata_pending_api_calls,
  markPendingMetadataCallStarted,
  updateMetadataApiCalls,
  resolvePendingMetadataCall,
  settlePendingWindowPlan,
  summarizePendingMetadataCallProgress,
  updateMetadataCollections,
  updatePendingMetadataCallRequestCount,
  updatePendingCallWindowPlan,
  getPendingWindowDispatches,
  settlePendingWindowDispatch,
  trackPendingWindowDispatch,
} from '../deepDive/aggregation.js';
import {
  DEEP_DIVE_CONCURRENCY,
  LOOKBACK_OPTIONS,
  TARGET_LOOKBACK,
  DEEP_DIVE_REQUEST_SPACING_MS,
  logDeepDive,
} from '../deepDive/constants.js';
import { scheduleDomUpdate, upsertDeepDiveRecord, yieldToBrowser } from '../deepDive/dataHelpers.js';
import { stageDeepDiveCallPlan, updateDeepDiveCallPlanStatus } from './plan.js';

const runDeepDiveScan = async (entries, lookback, progressHandlers, rows, onSuccessfulCall, onComplete) => {
  const plannedEntries = Array.isArray(entries) ? [...entries] : [];
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
  const invalidEntries = plannedEntries.filter(
    (entry) => !entry?.appId || !entry?.domain || !entry?.integrationKey,
  );

  if (invalidEntries.length) {
    logDeepDive('error', 'Deep dive entries missing required fields before scan.', {
      invalidCount: invalidEntries.length,
      totalEntries: plannedEntries.length,
      examples: invalidEntries.slice(0, 3).map((entry) => ({
        appId: entry?.appId,
        subId: entry?.subId,
        hasDomain: Boolean(entry?.domain),
        hasIntegrationKey: Boolean(entry?.integrationKey),
      })),
    });
  }

  const validEntries = invalidEntries.length
    ? plannedEntries.filter((entry) => entry?.appId && entry?.domain && entry?.integrationKey)
    : plannedEntries;
  const requestTable = stageDeepDiveCallPlan(validEntries, targetLookback);
  logDeepDive('info', 'Prepared deep dive request queue', {
    queuedEntries: requestTable.length,
    requestedLookback: lookback,
    targetLookback,
  });
  let { total: totalApiCalls, completed: completedApiCalls } = summarizePendingMetadataCallProgress();
  let completedProcessingSteps = 0;
  let successCount = 0;
  const deepDiveAccumulator = new Map();
  let processingResponses = false;
  let lastProcessingAtMs = 0;

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

  const markProcessingStart = () => {
    processingResponses = true;
    lastProcessingAtMs = Date.now();
  };

  const markProcessingActivity = () => {
    lastProcessingAtMs = Date.now();
  };

  const markProcessingComplete = () => {
    processingResponses = false;
    lastProcessingAtMs = Date.now();
  };

  const normalizeRequestCount = (summary) => {
    const count = Number.isFinite(summary?.requestCount)
      ? summary.requestCount
      : Number.isFinite(summary)
        ? summary
        : 1;

    return Math.max(count, 1);
  };

  logDeepDive('info', 'Starting deep dive scan', {
    requestedEntries: validEntries.length,
    totalApiCalls: getTotalApiCalls(),
    targetLookback,
  });

  const entryLookup = new Map(requestTable.map((entry) => [entry.appId, entry]));
  const buildResolverKey = (entry) => buildPendingRequestSignature(entry, targetLookback);
  const pendingResolvers = new Map();

  let resolveMetadataCompletion;
  const metadataCompletion = new Promise((resolve) => {
    resolveMetadataCompletion = resolve;
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
    setApiStatus?.('Preparing deep dive request queue…');
    setProcessingStatus?.('Waiting for the first API response…');
  });

  const createResponseFlowLogger = (entry) => (step, details = {}) => {
    const progress = summarizePendingMetadataCallProgress();
    const pendingRecord = metadata_pending_api_calls.find(
      (call) => call.appId === entry.appId && (call.subId || '') === (entry.subId || ''),
    );

    logDeepDive('debug', 'Deep dive response flow', step, {
      appId: entry.appId,
      subId: entry.subId,
      pendingStatus: pendingRecord?.status || 'absent',
      pendingRequestCount: pendingRecord?.requestCount ?? null,
      pendingPlannedWindows: pendingRecord?.plannedWindows || [],
      progress,
      ...details,
    });
  };

  const runAggregationPhase = async (entry) => {
    logDeepDive('info', 'Processing deep dive entry', {
      appId: entry.appId,
      subId: entry.subId,
      targetLookback,
    });

    const logResponseFlowStep = createResponseFlowLogger(entry);
    const startTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    await yieldToBrowser();
    let requestSummary = { requestCount: 1 };
    let apiCompleted = false;
    const syncPendingQueue = (plannedCount, windowSize, reason = 'planned') => {
      const normalizedCount = normalizeRequestCount(plannedCount);
      updatePendingMetadataCallRequestCount(entry, normalizedCount);
      updatePendingCallWindowPlan(entry, normalizedCount, windowSize, reason);
      trackPendingWindowDispatch(entry, normalizedCount, windowSize, reason);
      syncApiProgress();
      syncProcessingProgress();
    };
    try {
      const onWindowSplit = (windowSize, payloadCount) => {
        logDeepDive('info', 'Splitting deep dive request into smaller windows', {
          appId: entry.appId,
          windowSize,
          payloadCount,
        });
        updateDeepDiveCallPlanStatus(entry, 'Split', `Split into ${payloadCount} windows.`);
        syncPendingQueue(payloadCount, windowSize, 'split');
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
        onRequestsPlanned: syncPendingQueue,
        updatePendingQueue: syncPendingQueue,
        onRequestsSettled: (plannedCount, windowSize) => {
          settlePendingWindowPlan(entry, normalizeRequestCount(plannedCount), windowSize);
          settlePendingWindowDispatch(entry, normalizeRequestCount(plannedCount), windowSize);
          syncApiProgress();
          syncProcessingProgress();
        },
      });

      const resolvedRequestCount = normalizeRequestCount(requestSummary);

      logResponseFlowStep('aggregation completed', {
        resolvedRequestCount,
        aggregatedResponseCount: requestSummary?.aggregatedResults?.length || 0,
        appliedWindow: requestSummary?.appliedWindow || null,
      });

      updatePendingMetadataCallRequestCount(entry, resolvedRequestCount);
      settlePendingWindowPlan(entry, resolvedRequestCount, requestSummary?.appliedWindow);
      syncApiProgress();
      syncProcessingProgress();

      if (!Array.isArray(requestSummary?.aggregatedResults)) {
        throw requestSummary?.lastError || new Error('Aggregation response was empty or malformed.');
      }

      apiCompleted = true;
      logResponseFlowStep('api completed', {
        resolvedRequestCount,
        aggregatedResponseCount: requestSummary?.aggregatedResults?.length || 0,
      });
      syncApiProgress();
      scheduleDomUpdate(() => {
        setProcessingStatus?.(
          `Handling response ${completedProcessingSteps + resolvedRequestCount}/${getTotalApiCalls()}.`,
        );
      });

      return { requestSummary, resolvedRequestCount, logResponseFlowStep, startTime };
    } catch (error) {
      const resolvedRequestCount = normalizeRequestCount(requestSummary);

      updatePendingMetadataCallRequestCount(entry, resolvedRequestCount);
      settlePendingWindowPlan(entry, resolvedRequestCount, requestSummary?.appliedWindow);
      settlePendingWindowDispatch(entry, resolvedRequestCount, requestSummary?.appliedWindow);
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

      logResponseFlowStep('response handling failed', {
        apiCompleted,
        resolvedRequestCount,
        errorDetail: detail,
      });

      if (!apiCompleted) {
        syncApiProgress();
      }
      completedProcessingSteps += resolvedRequestCount;
      syncProcessingProgress();
      if (processingResponses) {
        markProcessingComplete();
      }

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

    return null;
  };

  const runProcessingPhase = async (entry, aggregationResult) => {
    const { requestSummary, resolvedRequestCount, logResponseFlowStep, startTime } = aggregationResult;
    let normalizedFields = null;
    let datasetCount = 0;

    markProcessingStart();

    try {
      for (const response of requestSummary.aggregatedResults) {
        markProcessingActivity();
        normalizedFields = await collectDeepDiveMetadataFields(response, deepDiveAccumulator, entry);
        datasetCount = Number.isFinite(normalizedFields?.datasetCount)
          ? normalizedFields.datasetCount
          : datasetCount;
      }

      upsertDeepDiveRecord(entry, normalizedFields, '', targetLookback);
      updateMetadataApiCalls(entry, 'success', '', datasetCount);
      const resolvedCall = resolvePendingMetadataCall(entry, 'completed');
      logResponseFlowStep('pending call resolved', {
        resolvedStatus: resolvedCall?.status,
        resolvedError: resolvedCall?.error,
      });
      updateDeepDiveCallPlanStatus(entry, 'Completed');
      for (const response of requestSummary.aggregatedResults) {
        markProcessingActivity();
        await updateMetadataCollections(response, entry);
      }
      logResponseFlowStep('response data persisted', {
        datasetCount,
        visitorFieldCount: normalizedFields?.visitorFields?.size || 0,
        accountFieldCount: normalizedFields?.accountFields?.size || 0,
      });

      successCount += 1;
      completedProcessingSteps += resolvedRequestCount;
      syncApiProgress();
      syncProcessingProgress();
      const durationMs =
        (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) -
        startTime;

      logDeepDive('info', 'Deep dive entry completed', {
        appId: entry.appId,
        subId: entry.subId,
        functionName: 'runDeepDiveScan',
        lookbackDays: targetLookback,
        requestCount: resolvedRequestCount,
        responseCount: requestSummary?.aggregatedResults?.length || 0,
        datasetCount,
        visitorFieldCount: normalizedFields?.visitorFields?.size || 0,
        accountFieldCount: normalizedFields?.accountFields?.size || 0,
        durationMs: Math.round(durationMs),
        updatedTargets: {
          accumulatorKey: `${entry.appId || 'unknown'}:${entry.subId || 'unknown'}`,
          metadataCollections: 'metadata_api_calls, metadata_pending_api_calls',
          callPlanStatus: 'Completed',
          persistedCollections: Boolean(requestSummary?.aggregatedResults?.length),
        },
      });
      if (onSuccessfulCall) {
        scheduleDomUpdate(() => onSuccessfulCall());
      }
    } catch (error) {
      const detail = error?.message || 'Unable to process metadata events.';
      const resolvedCall = resolvePendingMetadataCall(entry, 'failed', detail);
      updateDeepDiveCallPlanStatus(entry, 'Error', detail);
      updateMetadataApiCalls(entry, 'error', detail);
      updatePendingMetadataCallRequestCount(entry, resolvedRequestCount);
      settlePendingWindowPlan(entry, resolvedRequestCount, requestSummary?.appliedWindow);
      settlePendingWindowDispatch(entry, resolvedRequestCount, requestSummary?.appliedWindow);
      completedProcessingSteps += resolvedRequestCount;
      syncApiProgress();
      syncProcessingProgress();
      logResponseFlowStep('response handling failed', {
        apiCompleted: true,
        resolvedRequestCount,
        errorDetail: detail,
        resolvedStatus: resolvedCall?.status,
      });

      scheduleDomUpdate(() => {
        setProcessingError?.(`Deep dive response handling error for app ${entry.appId}: ${detail}`);
      });

      logDeepDive('error', 'Deep dive response handling failed', { appId: entry.appId, error });
    } finally {
      markProcessingComplete();
    }
  };

  const queueProcessingPhase = (entry, aggregationResult) =>
    Promise.resolve()
      .then(() => runProcessingPhase(entry, aggregationResult))
      .catch((error) => {
        logDeepDive('error', 'Unhandled deep dive processing failure', { appId: entry.appId, error });
      })
      .finally(() => {
        tryResolveCompletion();
      });

  let activeRequests = 0;
  let lastDispatchAtMs = 0;
  let lastCompletionAtMs = 0;
  let requestWatchdogTimer = null;
  let lastOutstandingCount = 0;

  const startRequestWatchdog = () => {
    const WATCHDOG_INTERVAL_MS = 60000;
    const WATCHDOG_IDLE_THRESHOLD_MS = 45000;
    const watchdogStartedAtMs = Date.now();

    if (requestWatchdogTimer) {
      return;
    }

    requestWatchdogTimer = setInterval(() => {
      const outstanding = getOutstandingPendingCalls();
      const windowDispatches = getPendingWindowDispatches();
      const now = Date.now();
      const lastActivityAtMs = Math.max(
        lastCompletionAtMs || 0,
        lastDispatchAtMs || 0,
        lastProcessingAtMs || 0,
        watchdogStartedAtMs,
      );
      const idleForMs = now - lastActivityAtMs;

      if (!outstanding.length && !windowDispatches.length) {
        if (lastOutstandingCount > 0) {
          logDeepDive('debug', 'All deep dive requests completed; watchdog idle.');
        }
        lastOutstandingCount = 0;
        return;
      }

      lastOutstandingCount = outstanding.length + windowDispatches.length;

      if (idleForMs < WATCHDOG_IDLE_THRESHOLD_MS) {
        return;
      }

      const pendingSummary = outstanding.map((call) => {
        const queuedAtMs = Date.parse(call.queuedAt);
        const ageMs = Number.isFinite(queuedAtMs) ? now - queuedAtMs : 0;
        const running = call.status === 'in-flight';

        return {
          appId: call.appId,
          status: call.status,
          running,
          ageMs: Math.round(ageMs),
          requestCount: call.requestCount,
        };
      });

      const runningCalls = pendingSummary.filter((call) => call.running);
      const processingActive =
        processingResponses || (lastProcessingAtMs && now - lastProcessingAtMs < WATCHDOG_IDLE_THRESHOLD_MS);
      const hasWindowDispatches = windowDispatches.length > 0;
      const hasActiveRequests = activeRequests > 0;

      // If at least one pending call is actively running, downgrade the watchdog alert
      // to avoid flagging legitimate work as stalled.
      if (runningCalls.length || hasActiveRequests || processingActive || hasWindowDispatches) {
        logDeepDive('info', 'Deep dive requests still running; watchdog continuing to monitor.', {
          outstandingCount: outstanding.length,
          windowDispatchCount: windowDispatches.length,
          idleForMs: Math.round(idleForMs),
          lastDispatchAtMs: lastDispatchAtMs || null,
          lastDispatchAtIso: lastDispatchAtMs ? new Date(lastDispatchAtMs).toISOString() : '',
          lastCompletionAtMs: lastCompletionAtMs || null,
          lastProcessingAtMs: lastProcessingAtMs || null,
          lastProcessingAtIso: lastProcessingAtMs ? new Date(lastProcessingAtMs).toISOString() : '',
          processingActive,
          processingResponses,
          activeRequests,
          runningCount: runningCalls.length,
          outstanding: pendingSummary,
          windowDispatches,
        });
        return;
      }

      logDeepDive('warn', 'Deep dive requests appear stalled; no recent dispatch or completion.', {
        outstandingCount: outstanding.length,
        windowDispatchCount: windowDispatches.length,
        idleForMs: Math.round(idleForMs),
        lastDispatchAtMs: lastDispatchAtMs || null,
        lastDispatchAtIso: lastDispatchAtMs ? new Date(lastDispatchAtMs).toISOString() : '',
        lastCompletionAtMs: lastCompletionAtMs || null,
        lastProcessingAtMs: lastProcessingAtMs || null,
        lastProcessingAtIso: lastProcessingAtMs ? new Date(lastProcessingAtMs).toISOString() : '',
        processingActive,
        processingResponses,
        activeRequests,
        outstanding: pendingSummary,
        windowDispatches,
      });
    }, WATCHDOG_INTERVAL_MS);
  };

  const clearRequestWatchdog = () => {
    if (requestWatchdogTimer) {
      clearInterval(requestWatchdogTimer);
      requestWatchdogTimer = null;
    }
  };

  const recordRequestSettled = () => {
    lastCompletionAtMs = Date.now();
  };

  const tryResolveCompletion = () => {
    const { completed, total } = summarizePendingMetadataCallProgress();
    const queueDrained = !hasQueuedPendingCalls() && activeRequests === 0;

    if (total > 0 && completed >= total && queueDrained) {
      resolveMetadataCompletion?.('completed');
    }
  };

  const dispatchNextRequest = async () => {
    if (activeRequests >= Math.max(DEEP_DIVE_CONCURRENCY, 1)) {
      return;
    }

    const nextEntry = getNextQueuedPendingCall();

    if (!nextEntry) {
      return;
    }

    const resolverKey = buildResolverKey(nextEntry);
    const resolver = pendingResolvers.get(resolverKey);

    if (resolver?.resolved) {
      dispatchNextRequest();
      return;
    }

    activeRequests += 1;
    markPendingMetadataCallStarted(nextEntry);

    const elapsedSinceLastDispatch = Date.now() - lastDispatchAtMs;
    const delayMs = Math.max(DEEP_DIVE_REQUEST_SPACING_MS - Math.max(elapsedSinceLastDispatch, 0), 0);

    logDeepDive('debug', 'Dispatching deep dive request', {
      appId: nextEntry.appId,
      subId: nextEntry.subId,
      delayMs,
      activeRequests,
    });

    updateDeepDiveCallPlanStatus(nextEntry, 'Calling');

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    lastDispatchAtMs = Date.now();

    if (resolver?.cancelled) {
      logDeepDive('warn', 'Skipping cancelled deep dive request', {
        appId: nextEntry.appId,
        subId: nextEntry.subId,
        reason: resolver.reason || 'unknown',
      });
      resolver.safeResolve();
      activeRequests -= 1;
      recordRequestSettled();
      dispatchNextRequest();
      return;
    }

    try {
      const aggregationResult = await runAggregationPhase(nextEntry);

      if (aggregationResult) {
        queueProcessingPhase(nextEntry, aggregationResult);
      } else {
        tryResolveCompletion();
      }
    } finally {
      recordRequestSettled();
      resolver?.safeResolve();
      activeRequests -= 1;
      tryResolveCompletion();
      dispatchNextRequest();
    }
  };

  const scheduleDeepDiveRequest = (entry, index) =>
    new Promise((resolve) => {
      const resolverKey = buildResolverKey(entry);
      const matchingPending = metadata_pending_api_calls.find(
        (call) => buildPendingRequestSignature(call, targetLookback) === resolverKey,
      );
      const matchingRecorded = metadata_api_calls.find((call) => {
        const signature = call?.timeSeriesKey || buildPendingRequestSignature(call, targetLookback);
        return signature === resolverKey && call?.status === 'success';
      });

      if (pendingResolvers.has(resolverKey) || matchingRecorded) {
        logDeepDive('info', 'Skipping duplicate deep dive request', {
          appId: entry.appId,
          subId: entry.subId,
          queueIndex: index,
          resolverKey,
          reason: matchingRecorded ? 'already completed' : 'already scheduled',
        });
        resolvePendingMetadataCall(entry, 'Completed', 'Duplicate request skipped.');
        updateDeepDiveCallPlanStatus(entry, 'Skipped', 'Duplicate request signature; skipped dispatch.');
        syncApiProgress();
        syncProcessingProgress();
        resolve();
        return;
      }

      if (matchingPending && matchingPending.status !== 'queued') {
        logDeepDive('info', 'Skipping already in-flight deep dive request', {
          appId: entry.appId,
          subId: entry.subId,
          queueIndex: index,
          resolverKey,
          status: matchingPending.status,
        });
        resolvePendingMetadataCall(entry, 'Completed', 'Duplicate request skipped.');
        updateDeepDiveCallPlanStatus(entry, 'Skipped', 'Duplicate request signature; skipped dispatch.');
        syncApiProgress();
        syncProcessingProgress();
        resolve();
        return;
      }

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
          pendingResolvers.delete(resolverKey);
          resolve();
        },
      };

      logDeepDive('debug', 'Scheduling deep dive request', {
        appId: entry.appId,
        subId: entry.subId,
        queueIndex: index,
        resolverKey,
      });

      pendingResolvers.set(resolverKey, resolver);
      dispatchNextRequest();
    });

  const scheduledRequests = requestTable.map((entry, index) => scheduleDeepDiveRequest(entry, index));

  logDeepDive('debug', 'Queued deep dive requests for execution', {
    scheduledCount: scheduledRequests.length,
    spacingMs: DEEP_DIVE_REQUEST_SPACING_MS,
    concurrency: DEEP_DIVE_CONCURRENCY,
  });

  const scheduledResolution = Promise.all(scheduledRequests).then(() => 'scheduled');

  startRequestWatchdog();
  tryResolveCompletion();

  await Promise.all([scheduledResolution, metadataCompletion]).catch(() => {});

  clearRequestWatchdog();

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

  const failedApiCalls = metadata_api_calls.filter((call) => call?.status !== 'success');
  if (failedApiCalls.length) {
    const failedMessage = `Deep dive requests failed; rerun to avoid incomplete exports (${failedApiCalls.length} request${
      failedApiCalls.length === 1 ? '' : 's'
    } impacted).`;

    scheduleDomUpdate(() => {
      setApiError?.(failedMessage);
      setProcessingError?.(failedMessage);
    });

    const failedPayload = {
      failedCalls: failedApiCalls.map((call) => ({
        appId: call.appId,
        subId: call.subId,
        status: call.status,
        error: call.error,
        recordedAt: call.recordedAt,
      })),
    };

    logDeepDive('error', 'Deep dive recorded failed API calls; exports will mark these apps incomplete', failedPayload);
    console.error('Deep dive recorded failed API calls; exports will mark these apps incomplete', failedPayload);
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
    updateProcessingProgress?.(completedProcessingSteps, totalApiCalls);
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

export { runDeepDiveScan };
