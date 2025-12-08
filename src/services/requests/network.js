import { extractAppIds } from '../appUtils.js';
import { createLogger } from '../../utils/logger.js';
import { buildAppListingPayload, buildChunkedAppListingPayloads } from '../payloads/index.js';
import { createAggregationError, isTooMuchDataOrTimeout } from './errors.js';

const requestLogger = createLogger('Requests', { debugFlag: 'DEBUG_DEEP_DIVE', alwaysInfo: true });
const isDeepDiveDebugEnabled = () => typeof window !== 'undefined' && window.DEBUG_DEEP_DIVE === true;

const logAggregationRequestPayload = (endpoint, payload, status, responseBody) => {
  if (!isDeepDiveDebugEnabled()) {
    return;
  }

  requestLogger.info('Aggregation request payload (debug):', {
    endpoint,
    status: status ?? 'unknown status',
    payload,
    responseBody: responseBody ?? '',
  });
};

const normalizeDomain = (domain) => domain?.replace(/\/$/, '') || '';
export const FALLBACK_WINDOW_SEQUENCE = [180, 60, 30, 10, 7, 1];
const DEFAULT_AGGREGATION_TIMEOUT_MS = 60_000;
const DEFAULT_CHUNK_SIZE = 30;

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

export const buildCookieHeaderValue = (rawCookie) => {
  const trimmed = rawCookie.trim();

  if (!trimmed) {
    return '';
  }

  const withoutLabel = trimmed.toLowerCase().startsWith('cookie:')
    ? trimmed.slice(trimmed.indexOf(':') + 1).trim()
    : trimmed;

  if (withoutLabel.includes('=')) {
    return withoutLabel;
  }

  const regexMatch = withoutLabel.match(/pendo\.sess\.jwt2\s*=\s*([^;\s]+)/i);

  if (regexMatch?.[0]) {
    return regexMatch[0].trim();
  }

  return `pendo.sess.jwt2=${withoutLabel}`;
};

export const runAggregationWithFallbackWindows = async ({
  entry,
  totalWindowDays,
  buildBasePayload,
  buildChunkedPayloads,
  aggregateResults,
  fetchImpl = fetch,
  onWindowSplit,
  maxWindowHint,
  preferredChunkSize,
  onRequestsPlanned,
  onRequestsSettled,
}) => {
  const fallbackWindows = normalizeFallbackWindows(totalWindowDays);
  const logger = entry?.appId ? createLogger(`Request-${entry.appId}`) : requestLogger;
  const aggregate = typeof aggregateResults === 'function' ? aggregateResults : (collector, response) => {
    collector.push(response);
  };
  let lastError = null;
  let requestCount = 0;

  const hintWindow = Number(maxWindowHint);
  const preferredChunk = Number(preferredChunkSize);
  const resolvedChunkSize = Number.isFinite(preferredChunk) && preferredChunk > 0
    ? preferredChunk
    : Number.isFinite(hintWindow) && hintWindow > 0
      ? hintWindow
      : DEFAULT_CHUNK_SIZE;
  const normalizedFallbacks = Number.isFinite(hintWindow) && hintWindow > 0
    ? Array.from(
        new Set([
          Number(totalWindowDays),
          hintWindow,
          ...fallbackWindows.filter((candidate) => candidate < hintWindow),
        ]),
      )
    : fallbackWindows;

  for (const windowSize of normalizedFallbacks) {
    const baseWindow = Number(totalWindowDays);
    const chunkSize = Math.min(resolvedChunkSize, windowSize);
    const shouldForceChunkedBase = windowSize === baseWindow && chunkSize < baseWindow;
    const payloads =
      windowSize === baseWindow && !shouldForceChunkedBase
        ? [buildBasePayload(windowSize)]
        : buildChunkedPayloads(windowSize, chunkSize);

    if (!Array.isArray(payloads) || !payloads.length) {
      continue;
    }

    if (typeof onWindowSplit === 'function' && payloads.length > 1) {
      onWindowSplit(windowSize, payloads.length);
    }

    const aggregatedResults = [];

    const plannedRequestCount = payloads.length;

    try {
      const scheduleAggregationRequest = (payload, index) =>
        new Promise((resolve, reject) => {
          const requestId = payload?.request?.requestId || `window-${windowSize}-${index + 1}`;
          const payloadLength = typeof payload === 'string' ? payload.length : JSON.stringify(payload || {}).length;
          const startTime = Date.now();

          requestLogger.debug('Dispatching aggregation request.', {
            requestId,
            windowSize,
            chunkSize,
            payloadLength,
          });

          setTimeout(() => {
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

      const chunkSizeUsed = payloads.length > 1 ? chunkSize : null;
      onRequestsSettled?.(plannedRequestCount, windowSize);

      return { aggregatedResults, appliedWindow: windowSize, requestCount, chunkSizeUsed };
    } catch (error) {
      lastError = error;
      onRequestsSettled?.(plannedRequestCount, windowSize);

      if (!isTooMuchDataOrTimeout(error)) {
        const propagatedError = error;
        propagatedError.requestCount = requestCount;
        throw propagatedError;
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
  const { onRequestsPlanned, onRequestsSettled } = callbacks || {};

  const logAggregationResponseDetails = (error) => {
    const { responseStatus, responseBody, details } = error || {};
    const status = responseStatus ?? details?.status;
    const body = responseBody ?? details?.body;

    if (status !== undefined || body !== undefined) {
      requestLogger.error('Aggregation response details:', {
        status: status ?? 'unknown status',
        body: body ?? '',
      });
    }
  };

  try {
    const { aggregatedResults, requestCount: totalRequests } = await runAggregationWithFallbackWindows({
      entry,
      totalWindowDays: windowDays,
      buildBasePayload: (totalWindow) => buildAppListingPayload(totalWindow, requestIdPrefix),
      buildChunkedPayloads: (windowSize, chunkSize) =>
        buildChunkedAppListingPayloads(windowSize, chunkSize, requestIdPrefix),
      aggregateResults: (collector, response) => collector.push(...extractAppIds(response)),
      fetchImpl,
      onWindowSplit: (windowSize, payloadCount) =>
        requestLogger.info(
          `App discovery request split into ${payloadCount} window(s) at ${windowSize}-day scope.`,
        ),
      onRequestsPlanned,
      onRequestsSettled,
    });

    requestCount = Math.max(1, totalRequests || 1);

    if (Array.isArray(aggregatedResults)) {
      const uniqueAppIds = Array.from(new Set(aggregatedResults));
      return { results: uniqueAppIds.map((appId) => ({ appId })), requestCount };
    }
  } catch (error) {
    requestLogger.error('Aggregation request encountered an error:', error);
    logAggregationResponseDetails(error);
    requestCount = Math.max(1, error?.requestCount || requestCount || 1);
    const errorHint = error?.details?.hint || error?.hint;

    if (errorHint) {
      requestLogger.error('Aggregation request hint:', {
        hint: errorHint,
        requestId: error?.details?.requestId || payload?.request?.requestId,
      });
    }

    if (!isTooMuchDataOrTimeout(error)) {
      return { errorType: 'failed', requestCount, errorHint };
    }
  }

  return { errorType: 'timeout', requestCount };
};

const extractJwtToken = (cookieHeaderValue) => {
  if (!cookieHeaderValue) {
    return '';
  }

  const match = cookieHeaderValue.match(/pendo\.sess\.jwt2\s*=\s*([^;\s]+)/i);
  return match?.[1] || '';
};

export const postAggregationWithIntegrationKey = async (entry, payload, fetchImpl = fetch) => {
  const { domain, integrationKey, appId } = entry || {};

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
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timeoutId = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, DEFAULT_AGGREGATION_TIMEOUT_MS)
    : null;

  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: buildRequestHeaders(integrationKey),
      body: JSON.stringify(payload),
      signal: controller?.signal,
    });
  } catch (networkError) {
    const timeoutMessage = `Aggregation request timed out after ${DEFAULT_AGGREGATION_TIMEOUT_MS / 1000} seconds.`;
    const abortedByBrowser = networkError?.name === 'AbortError';
    const failedToFetch = /failed to fetch/i.test(networkError?.message || '');
    const isCorsBlocked = !timedOut && (abortedByBrowser || networkError?.name === 'TypeError' || failedToFetch);
    const corsHint = 'CORS/preflight blocked. Ensure the proxy or browser allows this request.';

    if (isCorsBlocked) {
      requestLogger.error('Aggregation request blocked by CORS/preflight.', {
        endpoint,
        requestId: requestId || 'unknown request',
        message: networkError?.message,
      });
    }

    if (timedOut || networkError?.name === 'AbortError') {
      throw createAggregationError(timeoutMessage, null, '', {
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
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
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

export const fetchAggregation = async (
  url,
  payload,
  cookieHeaderValue,
  options = {},
  fetchImpl = fetch,
) => {
  const { region, subId, proxyEndpoint = 'proxy.php' } = options;
  const token = extractJwtToken(cookieHeaderValue);

  if (!region || !subId) {
    throw new Error('Region and Sub ID are required for the proxy request.');
  }

  if (!token) {
    throw new Error('Missing pendo.sess.jwt2 token for the proxy request.');
  }

  let response;

  try {
    response = await fetchImpl(proxyEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        payload,
        region,
        subId,
        token,
        endpointPreview: normalizeDomain(url),
      }),
      credentials: 'same-origin',
    });
  } catch (networkError) {
    throw createAggregationError(
      networkError?.message || 'Aggregation proxy request could not be sent.',
      null,
      '',
    );
  }

  const rawBody = await response?.text().catch(() => '');
  let parsedBody;

  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch (parseError) {
    parsedBody = null;
  }

  if (!response?.ok) {
    const extractDetails = () => {
      if (parsedBody && typeof parsedBody === 'object') {
        const { error, message, overall, fields } = parsedBody;
        const fieldText = Array.isArray(fields)
          ? fields.join('; ')
          : fields && typeof fields === 'object'
            ? Object.values(fields).join('; ')
            : fields;

        return [overall, fieldText, message, error].filter(Boolean).join(' ');
      }

      return rawBody?.trim() || '';
    };

    const detail = extractDetails();
    const statusLabel = response?.status || 'unknown status';
    const message = detail
      ? `Aggregation request failed (${statusLabel}): ${detail}`
      : `Aggregation request failed (status ${statusLabel}).`;

    requestLogger.error('Aggregation response details:', {
      status: response?.status ?? 'unknown status',
      body: parsedBody ?? rawBody ?? '',
    });

    throw createAggregationError(message, response?.status, parsedBody || rawBody);
  }

  if (!rawBody) {
    return {};
  }

  try {
    return parsedBody ?? JSON.parse(rawBody);
  } catch (parseError) {
    throw createAggregationError('Aggregation response was not valid JSON.', response?.status, rawBody);
  }
};
