import { extractAppIds } from '../appUtils.js';
import { createLogger } from '../../utils/logger.js';
import { buildAppListingPayload, buildChunkedAppListingPayloads } from '../payloads/index.js';
import { createAggregationError, isTooMuchDataOrTimeout } from './errors.js';

const requestLogger = createLogger('Requests', {
  alwaysInfo: true,
  debugFlag: ['DEBUG_LOGGING', 'DEBUG_DEEP_DIVE'],
});
const isDebugLoggingEnabled = () =>
  typeof window !== 'undefined' && (window.DEBUG_LOGGING === true || window.DEBUG_DEEP_DIVE === true);

const logAggregationRequestPayload = (endpoint, payload, status, responseBody) => {
  if (!isDebugLoggingEnabled() && (!status || status < 400)) {
    return;
  }

  requestLogger.error('Aggregation request payload (debug):', {
    endpoint,
    status: status ?? 'unknown status',
    payload,
    responseBody: responseBody ?? '',
  });
};

const normalizeDomain = (domain) => domain?.replace(/\/$/, '') || '';
export const FALLBACK_WINDOW_SEQUENCE = [180, 60, 30, 10, 7, 1];
const deriveChunkSizes = (windowSize, fallbackWindows, preferredChunkSize, maxWindowHint) => {
  const chunkSizes = [];

  if (Number.isFinite(preferredChunkSize) && preferredChunkSize > 0 && preferredChunkSize < windowSize) {
    chunkSizes.push(preferredChunkSize);
  }

  if (Number.isFinite(maxWindowHint) && maxWindowHint > 0 && maxWindowHint < windowSize) {
    chunkSizes.push(maxWindowHint);
  }

  fallbackWindows
    .filter((candidate) => candidate > 0 && candidate < windowSize)
    .forEach((candidate) => {
      if (!chunkSizes.includes(candidate)) {
        chunkSizes.push(candidate);
      }
    });

  return chunkSizes;
};

const normalizeFallbackWindows = (windowDays) => {
  const normalized = Number(windowDays);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return [];
  }

  const windows = [];

  [normalized, ...FALLBACK_WINDOW_SEQUENCE].forEach((candidate) => {
    if (candidate > 0 && candidate <= normalized && !windows.includes(candidate)) {
      windows.push(candidate);
    }
  });

  return windows;
};

export const buildAggregationUrl = (envUrls, envValue, subId) => {
  const endpointTemplate = envUrls?.[envValue];
  return endpointTemplate?.replace('{sub_id}', encodeURIComponent(subId));
};

export const runAggregationWithFallbackWindows = async ({
  entry,
  totalWindowDays,
  buildBasePayload,
  buildChunkedPayloads,
  aggregateResults,
  fetchImpl = fetch,
  onWindowSplit,
  onBeforeRequest,
  maxWindowHint,
  preferredChunkSize,
  onRequestsPlanned,
  onRequestsSettled,
  updatePendingQueue,
}) => {
  const fallbackWindows = normalizeFallbackWindows(totalWindowDays);
  const logger = entry?.appId ? createLogger(`Request-${entry.appId}`) : requestLogger;
  const aggregate = typeof aggregateResults === 'function' ? aggregateResults : (collector, response) => {
    collector.push(response);
  };
  let lastError = null;
  let requestCount = 0;
  let pendingQueueCount = 0;

  const updatePendingQueueCount = (plannedCount, windowSize, reason = 'planned') => {
    const normalizedPlanned = Math.max(1, Number(plannedCount) || 0);

    if (normalizedPlanned <= pendingQueueCount) {
      return;
    }

    pendingQueueCount = normalizedPlanned;
    updatePendingQueue?.(pendingQueueCount, windowSize, reason);
  };

  const hintWindow = Number(maxWindowHint);
  const preferredChunk = Number(preferredChunkSize);
  const normalizedFallbacks = Number.isFinite(hintWindow) && hintWindow > 0
    ? Array.from(
        new Set([
          Number(totalWindowDays),
          hintWindow,
          ...fallbackWindows.filter((candidate) => candidate < hintWindow),
        ]),
      )
    : fallbackWindows;

  logger.debug('Starting aggregation with fallback windows', {
    appId: entry?.appId,
    totalWindowDays,
    maxWindowHint: hintWindow || null,
    preferredChunkSize: preferredChunk || null,
    fallbackWindows: normalizedFallbacks,
  });

  for (const windowSize of normalizedFallbacks) {
    const basePayload = buildBasePayload(windowSize);
    if (!basePayload) {
      continue;
    }

    const runAttempt = async ({ payloads, chunkSizeUsed }) => {
      if (!Array.isArray(payloads) || !payloads.length) {
        return null;
      }

      if (typeof onWindowSplit === 'function' && payloads.length > 1) {
        onWindowSplit(windowSize, payloads.length);
        updatePendingQueueCount(payloads.length, windowSize, 'split');
      }

      const aggregatedResults = [];
      const plannedRequestCount = payloads.length;
      updatePendingQueueCount(plannedRequestCount, windowSize);

      try {
        const scheduleAggregationRequest = (payload, index) =>
          new Promise((resolve, reject) => {
            const requestId = payload?.request?.requestId || `window-${windowSize}-${index + 1}`;
            const payloadLength = typeof payload === 'string' ? payload.length : JSON.stringify(payload || {}).length;
            const startTime = Date.now();

            if (typeof onBeforeRequest === 'function') {
              try {
                onBeforeRequest(payload, { windowSize, chunkSizeUsed, requestId, entry });
              } catch (hookError) {
                requestLogger.warn('onBeforeRequest hook failed.', hookError);
              }
            }

            setTimeout(() => {
              requestLogger.debug('Dispatching aggregation request.', {
                requestId,
                windowSize,
                chunkSize: chunkSizeUsed,
                payloadLength,
              });

              postAggregationWithIntegrationKey(entry, payload, fetchImpl)
                .then((response) => {
                  const durationMs = Date.now() - startTime;
                  requestLogger.debug('Aggregation response received.', {
                    requestId,
                    windowSize,
                    durationMs,
                    response,
                  });
                  resolve({ index, response });
                })
                .catch((error) => {
                  const durationMs = Date.now() - startTime;
                  requestLogger.debug('Aggregation request failed.', {
                    requestId,
                    windowSize,
                    durationMs,
                    error,
                  });
                  reject(error);
                });
            }, index * 3000);
          });

        onRequestsPlanned?.(plannedRequestCount, windowSize);
        requestCount += plannedRequestCount;

        const responses = await Promise.all(
          payloads.map((payload, index) => scheduleAggregationRequest(payload, index)),
        );

        responses
          .sort((a, b) => a.index - b.index)
          .forEach(({ response }) => aggregate(aggregatedResults, response, windowSize));

        onRequestsSettled?.(plannedRequestCount, windowSize);

        return { aggregatedResults, chunkSizeUsed: payloads.length > 1 ? chunkSizeUsed : null };
      } catch (error) {
        lastError = error;
        onRequestsSettled?.(plannedRequestCount, windowSize);

        if (!isTooMuchDataOrTimeout(error)) {
          const propagatedError = error;
          propagatedError.requestCount = requestCount;
          throw propagatedError;
        }

        return null;
      }
    };

    const attemptChunkSizes = deriveChunkSizes(windowSize, normalizedFallbacks, preferredChunk, hintWindow);

    const baseResult = await runAttempt({ payloads: [basePayload], chunkSizeUsed: null });

    if (baseResult) {
      const { aggregatedResults, chunkSizeUsed } = baseResult;
      logger.debug('Aggregation succeeded without chunking', {
        appId: entry?.appId,
        windowSize,
        requestCount,
        chunkSizeUsed,
      });
      return { aggregatedResults, appliedWindow: windowSize, requestCount, chunkSizeUsed };
    }

    for (const chunkSize of attemptChunkSizes) {
      const chunkedPayloads = buildChunkedPayloads(windowSize, chunkSize);

      if (!Array.isArray(chunkedPayloads) || !chunkedPayloads.length) {
        continue;
      }

      const result = await runAttempt({ payloads: chunkedPayloads, chunkSizeUsed: chunkSize });

      if (result) {
        const { aggregatedResults, chunkSizeUsed } = result;
        logger.debug('Aggregation succeeded with chunking', {
          appId: entry?.appId,
          windowSize,
          requestCount,
          chunkSizeUsed,
          payloadCount: chunkedPayloads.length,
        });
        return { aggregatedResults, appliedWindow: windowSize, requestCount, chunkSizeUsed };
      }
    }
  }

  const finalError = lastError || createAggregationError('Aggregation request failed for all fallback windows.', null, '');
  finalError.requestCount = requestCount;

  return { aggregatedResults: null, appliedWindow: null, lastError: finalError, requestCount };
};

export const buildRequestHeaders = (integrationKey) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'X-Pendo-Integration-Key': integrationKey,
});

export const fetchAppsForEntry = async (entry, windowDays = 7, fetchImpl = fetch, callbacks = {}) => {
  const requestIdPrefix = 'apps-list';
  let requestCount = 1;
  const { onRequestsPlanned, onRequestsSettled, updatePendingQueue } = callbacks || {};

  const logAggregationResponseDetails = (error, windowSize) => {
    const { responseStatus, responseBody, details, hint } = error || {};
    const status = responseStatus ?? details?.status;
    const body = responseBody ?? details?.body;
    const requestId = details?.requestId || 'unknown request';
    const windowLabel = details?.windowSize ?? details?.window ?? windowSize ?? 'unknown window';
    const errorHint = details?.hint || hint || 'no hint provided';

    requestLogger.error('Aggregation response details:', {
      status: status ?? 'unknown status',
      body: body ?? '',
      hint: errorHint,
      requestId,
      windowSize: windowLabel,
    });
  };

  try {
    const { aggregatedResults, requestCount: totalRequests, lastError } = await runAggregationWithFallbackWindows({
      entry,
      totalWindowDays: windowDays,
      buildBasePayload: (totalWindow) => buildAppListingPayload(totalWindow, requestIdPrefix),
      buildChunkedPayloads: (windowSize, chunkSize) =>
        buildChunkedAppListingPayloads(windowSize, chunkSize, requestIdPrefix),
      aggregateResults: (collector, response) => collector.push(...extractAppIds(response)),
      fetchImpl,
      onBeforeRequest: (_payload, details = {}) => {
        const { requestId, windowSize, chunkSizeUsed } = details;
        const subId = entry?.subId || 'unknown SubID';

        requestLogger.info('Sending app discovery request.', {
          requestId: requestId || 'unknown request',
          subId,
          windowSize: windowSize ?? windowDays,
          chunkSize: chunkSizeUsed || null,
        });
      },
      onWindowSplit: (windowSize, payloadCount) =>
        requestLogger.info(
          `App discovery request split into ${payloadCount} window(s) at ${windowSize}-day scope.`,
        ),
      onRequestsPlanned,
      onRequestsSettled,
      updatePendingQueue,
    });

    requestCount = Math.max(1, totalRequests || 1);

    if (Array.isArray(aggregatedResults)) {
      const uniqueAppIds = Array.from(new Set(aggregatedResults));
      return { results: uniqueAppIds.map((appId) => ({ appId })), requestCount };
    }

    if (lastError) {
      logAggregationResponseDetails(lastError);
      const errorHint = lastError?.details?.hint || lastError?.hint;

      if (errorHint) {
        requestLogger.error('Aggregation request hint:', {
          hint: errorHint,
          requestId: lastError?.details?.requestId || 'unknown request',
        });
      }

      return { errorType: isTooMuchDataOrTimeout(lastError) ? 'timeout' : 'failed', requestCount, errorHint };
    }
  } catch (error) {
    requestLogger.error('Aggregation request encountered an error:', error);
    logAggregationResponseDetails(error, windowDays);
    requestCount = Math.max(1, error?.requestCount || requestCount || 1);
    const errorHint = error?.details?.hint || error?.hint;

    if (errorHint) {
      requestLogger.error('Aggregation request hint:', {
        hint: errorHint,
        requestId: error?.details?.requestId || 'unknown request',
      });
    }

    if (!isTooMuchDataOrTimeout(error)) {
      return { errorType: 'failed', requestCount, errorHint };
    }
  }

  return { errorType: 'timeout', requestCount };
};

const hydrateAggregationEntry = (entry) => {
  const hydratedEntry = { ...(entry || {}) };

  if (hydratedEntry.domain && hydratedEntry.integrationKey) {
    return hydratedEntry;
  }

  if (typeof sessionStorage === 'undefined') {
    return hydratedEntry;
  }

  try {
    const raw = sessionStorage.getItem('subidLaunchData');

    if (!raw) {
      return hydratedEntry;
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return hydratedEntry;
    }

    const matchedEntry = parsed.find((candidate) => candidate?.subId === hydratedEntry.subId);

    if (!matchedEntry) {
      return hydratedEntry;
    }

    hydratedEntry.domain = hydratedEntry.domain || matchedEntry.domain;
    hydratedEntry.integrationKey = hydratedEntry.integrationKey || matchedEntry.integrationKey;
  } catch (error) {
    requestLogger.warn('Unable to hydrate aggregation entry from session storage.', { error });
  }

  return hydratedEntry;
};

export const postAggregationWithIntegrationKey = async (entry, payload, fetchImpl = fetch) => {
  const { domain, integrationKey, appId } = hydrateAggregationEntry(entry);

  if (!domain || !integrationKey) {
    throw new Error('Domain and integration key are required for the aggregation request.');
  }

  const queryParams = [];
  const requestId = payload?.request?.requestId;

  if (appId) {
    queryParams.push(`appId=${encodeURIComponent(appId)}`);
  }

  if (requestId) {
    queryParams.push(`requestId=${encodeURIComponent(requestId)}`);
  }

  const querySuffix = queryParams.length ? `?${queryParams.join('&')}` : '';
  const endpoint = `${normalizeDomain(domain)}/api/v1/aggregation${querySuffix}`;
  let response;

  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: buildRequestHeaders(integrationKey),
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    const abortedByBrowser = networkError?.name === 'AbortError';
    const failedToFetch = /failed to fetch/i.test(networkError?.message || '');
    const isCorsBlocked = abortedByBrowser || networkError?.name === 'TypeError' || failedToFetch;
    const corsHint = 'CORS/preflight blocked. Ensure the proxy or browser allows this request.';

    if (isCorsBlocked) {
      requestLogger.error('Aggregation request blocked by CORS/preflight.', {
        endpoint,
        requestId: requestId || 'unknown request',
        message: networkError?.message,
      });
    }

    if (abortedByBrowser) {
      throw createAggregationError('Aggregation request was aborted by the browser.', null, '', {
        isAbortError: true,
        endpoint,
        requestId,
      });
    }

    const message = isCorsBlocked
      ? `${networkError?.message || 'Aggregation request could not be sent.'} (CORS/preflight blocked)`
      : networkError?.message || 'Aggregation request could not be sent.';

    throw createAggregationError(message, null, '', {
      endpoint,
      requestId,
      hint: isCorsBlocked ? corsHint : undefined,
    });
  }

  const rawBody = await response?.text().catch(() => '');

  if (!response?.ok) {
    const statusLabel = response?.status ?? 'unknown status';
    const detail = rawBody?.trim() ? `: ${rawBody.trim()}` : '';
    logAggregationRequestPayload(endpoint, payload, statusLabel, rawBody);
    throw createAggregationError(`Aggregation request failed (${statusLabel})${detail}`.trim(), response?.status, rawBody);
  }

  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch (parseError) {
    throw createAggregationError('Aggregation response was not valid JSON.', response?.status, rawBody);
  }
};

