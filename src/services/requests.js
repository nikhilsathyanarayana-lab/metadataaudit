import { createLogger } from '../utils/logger.js';
import { extractAppIds } from './appUtils.js';

/**
 * @typedef {Object} AppAggregationEntry
 * @property {string} domain The base domain for the aggregation request.
 * @property {string} integrationKey Pendo integration key for authentication.
 */

/**
 * @typedef {Object} AggregationProxyOptions
 * @property {string} region Environment slug used by the proxy.
 * @property {string} subId Subscription ID for the workbook requests.
 * @property {string} [proxyEndpoint] Optional proxy endpoint override.
 */

const normalizeDomain = (domain) => domain?.replace(/\/$/, '') || '';
const RESPONSE_TOO_LARGE_MESSAGE = /too many data files/i;
const AGGREGATION_TIMEOUT_MESSAGE = /aggregation request timed out/i;
export const FALLBACK_WINDOW_SEQUENCE = [180, 60, 30, 10, 7, 1];

const requestLogger = createLogger('Requests');

export const logAggregationSplit = (contextLabel, windowDays, payloadCount, appIds) => {
  const label = contextLabel || 'Aggregation';
  const normalizedWindow = Number(windowDays);
  const normalizedPayloadCount = Number(payloadCount);
  const normalizedAppIds = Array.isArray(appIds) ? appIds : [appIds];

  if (!Number.isFinite(normalizedPayloadCount) || normalizedPayloadCount <= 1) {
    return;
  }

  const windowLabel = Number.isFinite(normalizedWindow) && normalizedWindow > 0
    ? `${normalizedWindow}-day`
    : 'unknown-window';

  const appIdLabel = normalizedAppIds
    .map((candidate) => (candidate === undefined || candidate === null ? '' : String(candidate).trim()))
    .filter(Boolean)
    .join(',');

  const logger = appIdLabel ? createLogger(`Request-${appIdLabel}`) : requestLogger;

  logger.info(
    `${label} request split into ${normalizedPayloadCount} window(s) at ${windowLabel} scope.`,
  );
};

const createAggregationError = (message, status, body) => {
  const error = new Error(message);
  error.responseStatus = status;
  error.responseBody = body;
  error.details = {
    status: status ?? 'unknown status',
    body: body ?? '',
  };
  return error;
};

export const isTooMuchDataOrTimeout = (error) => {
  const { responseStatus, responseBody, details, message, name, isAbortError } = error || {};
  const status = responseStatus ?? details?.status;
  const bodyText = typeof (responseBody ?? details?.body) === 'string' ? responseBody ?? details?.body : '';
  const messageText = message || '';

  return (
    status === 413 ||
    RESPONSE_TOO_LARGE_MESSAGE.test(messageText) ||
    RESPONSE_TOO_LARGE_MESSAGE.test(bodyText || '') ||
    AGGREGATION_TIMEOUT_MESSAGE.test(messageText) ||
    AGGREGATION_TIMEOUT_MESSAGE.test(bodyText || '') ||
    name === 'AbortError' ||
    isAbortError === true
  );
};

export const isTooMuchDataError = (error) => isTooMuchDataOrTimeout(error);

const DEFAULT_AGGREGATION_TIMEOUT_MS = 60_000;

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

export const buildMetaEventsPayload = (appId, windowDays = 7) => ({
  response: { location: 'request', mimeType: 'application/json' },
  request: {
    name: 'account-visitor-only',
    pipeline: [
      {
        source: {
          singleEvents: { appId },
          timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
        },
      },
      { filter: 'contains(type,`meta`)' },
      { unmarshal: { metadata: 'title' } },
      {
        select: {
          visitor: 'metadata.visitor',
          account: 'metadata.account',
          visitorId: 'visitorId',
          accountId: 'accountId',
          appId: 'appId',
        },
      },
    ],
  },
});

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

export const buildAppListingPayload = (windowDays = 7, requestId = 'app-discovery') => ({
  response: { location: 'request', mimeType: 'application/json' },
  request: {
    requestId,
    pipeline: [
      {
        source: {
          singleEvents: { appId: 'expandAppIds("*")' },
          timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
        },
      },
      { group: { group: ['appId'] } },
      { select: { appId: 'appId' } },
    ],
  },
});

export const buildChunkedAppListingPayloads = (
  windowDays,
  chunkSize = 30,
  requestIdPrefix = 'app-discovery',
) => {
  const normalizedWindow = Number(windowDays);

  if (!normalizedWindow || chunkSize <= 0) {
    return [];
  }

  const totalChunks = Math.ceil(normalizedWindow / chunkSize);
  const payloads = [];

  for (let chunkIndex = 1; chunkIndex <= totalChunks; chunkIndex += 1) {
    const startOffset = (chunkIndex - 1) * chunkSize;
    const remaining = normalizedWindow - startOffset;
    const chunkDays = Math.min(chunkSize, remaining);
    const first = `dateAdd(now(), -${startOffset}, "days")`;
    const payload = buildAppListingPayload(chunkDays, `${requestIdPrefix}-chunk-${chunkIndex}`);
    const timeSeries = payload?.request?.pipeline?.[0]?.source?.timeSeries;

    if (timeSeries) {
      timeSeries.first = first;
      timeSeries.count = -chunkDays;
      timeSeries.period = 'dayRange';
    }

    payloads.push(payload);
  }

  return payloads;
};

export const buildMetadataFieldsForAppPayload = (appId, windowDays) => ({
  response: { mimeType: 'application/json' },
  request: {
    name: 'metadata-fields-for-app',
    pipeline: [
      {
        spawn: [
          [
            {
              source: {
                singleEvents: { appId },
                timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
              },
            },
            { filter: 'contains(type,`meta`)' },
            { unmarshal: { metadata: 'title' } },
            { filter: '!isNil(metadata.visitor)' },
            { eval: { visitorMetadata: 'keys(metadata.visitor)' } },
            { unwind: { field: 'visitorMetadata' } },
            { group: { group: ['appId', 'visitorMetadata'] } },
            { group: { group: ['appId'], fields: { visitorMetadata: { list: 'visitorMetadata' } } } },
          ],
          [
            {
              source: {
                singleEvents: { appId },
                timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
              },
            },
            { filter: 'contains(type,`meta`)' },
            { unmarshal: { metadata: 'title' } },
            { filter: '!isNil(metadata.account)' },
            { eval: { accountMetadata: 'keys(metadata.account)' } },
            { unwind: { field: 'accountMetadata' } },
            { group: { group: ['appId', 'accountMetadata'] } },
            { group: { group: ['appId'], fields: { accountMetadata: { list: 'accountMetadata' } } } },
          ],
        ],
      },
      { join: { fields: ['appId'] } },
    ],
  },
});

/**
 * Build chunked payloads for metadata field requests when a single window is too large.
 * Each payload mirrors the base metadata fields request but scopes the time range to a
 * specific 30-day window so callers can retry across the last 180 days in smaller slices.
 *
 * @param {string} appId Application ID for the metadata request.
 * @param {number} windowDays Original window size requested (e.g. 180).
 * @param {number} [chunkSize=30] Number of days per chunk.
 * @returns {object[]} Array of payloads covering the requested window in chunks.
 */
export const buildChunkedMetadataFieldPayloads = (appId, windowDays, chunkSize = 30) => {
  const normalizedWindow = Number(windowDays);

  if (!appId || !normalizedWindow || chunkSize <= 0) {
    return [];
  }

  const totalChunks = Math.ceil(normalizedWindow / chunkSize);
  const payloads = [];
  for (let chunkIndex = 1; chunkIndex <= totalChunks; chunkIndex += 1) {
    const startOffset = (chunkIndex - 1) * chunkSize;
    const remaining = normalizedWindow - startOffset;
    const chunkDays = Math.min(chunkSize, remaining);
    const count = -chunkDays;
    const first = `dateAdd(now(), -${startOffset}, "days")`;

    const payload = buildMetadataFieldsForAppPayload(appId, windowDays);
    const spawn = payload?.request?.pipeline?.[0]?.spawn;

    if (Array.isArray(spawn)) {
      spawn.forEach((branch) => {
        const source = branch?.[0]?.source;

        if (source?.timeSeries) {
          source.timeSeries = {
            ...source.timeSeries,
            first,
            count,
            period: 'dayRange',
          };
        }
      });
    }

    if (payload?.request) {
      payload.request.requestId = `${payload.request.requestId || payload.request.name || 'metadata-fields'}-chunk-${chunkIndex}`;
    }

    payloads.push(payload);
  }

  return payloads;
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
  const filteredFallbacks = Number.isFinite(hintWindow)
    ? fallbackWindows.filter((windowSize) => windowSize <= hintWindow)
    : fallbackWindows;
  const normalizedFallbacks = filteredFallbacks.length ? filteredFallbacks : fallbackWindows;

  if (fallbackWindows.length !== normalizedFallbacks.length) {
    logger.info(
      `Skipping oversized aggregation windows (${fallbackWindows.filter((size) => size > hintWindow).join(', ')}) in favor of ${hintWindow}-day chunks due to prior limits.`,
    );
  }

  for (const windowSize of normalizedFallbacks) {
    const baseWindow = Number(totalWindowDays);
    const shouldForceChunkedBase =
      windowSize === baseWindow && Number.isFinite(preferredChunk) && preferredChunk > 0 && preferredChunk < baseWindow;
    const payloads =
      windowSize === baseWindow && !shouldForceChunkedBase
        ? [buildBasePayload(windowSize)]
        : buildChunkedPayloads(windowSize, shouldForceChunkedBase ? preferredChunk : windowSize);

    if (!Array.isArray(payloads) || !payloads.length) {
      continue;
    }

    if (typeof onWindowSplit === 'function' && payloads.length > 1) {
      onWindowSplit(windowSize, payloads.length);
    }

    const aggregatedResults = [];

    try {
      const scheduleAggregationRequest = (payload, index) => new Promise((resolve, reject) => {
        setTimeout(() => {
          postAggregationWithIntegrationKey(entry, payload, fetchImpl)
            .then((response) => resolve({ index, response }))
            .catch(reject);
        }, index * 3000);
      });

      requestCount += payloads.length;

      const responses = await Promise.all(
        payloads.map((payload, index) => scheduleAggregationRequest(payload, index)),
      );

      responses
        .sort((a, b) => a.index - b.index)
        .forEach(({ response }) => aggregate(aggregatedResults, response, windowSize));

      const chunkSizeUsed = payloads.length > 1 ? (shouldForceChunkedBase ? preferredChunk : windowSize) : null;

      return { aggregatedResults, appliedWindow: windowSize, requestCount, chunkSizeUsed };
    } catch (error) {
      lastError = error;

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

export const buildMetadataFieldsPayload = (windowDays) => ({
  response: { location: 'request', mimeType: 'application/json' },
  request: {
    requestId: `metadata-fields-${windowDays}`,
    pipeline: [
      {
        source: {
          singleEvents: { appId: 'expandAppIds("*")' },
          metadata: { account: true, visitor: true },
          timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
        },
      },
      {
        select: {
          appId: 'appId',
          visitorFields: 'keys(metadata.visitor)',
          accountFields: 'keys(metadata.account)',
        },
      },
    ],
  },
});

export const buildExamplesPayload = () => ({
  response: { location: 'request', mimeType: 'application/json' },
  request: {
    requestId: 'metadata-examples',
    pipeline: [
      {
        source: {
          singleEvents: { appId: 'expandAppIds("*")' },
          metadata: { account: true, visitor: true },
          timeSeries: { first: 'now()', count: -7, period: 'dayRange' },
        },
      },
      {
        select: {
          appId: 'appId',
          examples: 'metadata',
        },
      },
    ],
  },
});

/**
 * Build request headers for talking directly to the Aggregations API.
 * @param {string} integrationKey
 * @returns {Record<string, string>}
 */
export const buildRequestHeaders = (integrationKey) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'X-Pendo-Integration-Key': integrationKey,
});

/**
 * Fetch the app aggregation for a single SubID entry.
 * @param {AppAggregationEntry} entry
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<object|null|{errorType: 'timeout' | 'failed'}>}
 */
export const fetchAppsForEntry = async (entry, windowDays = 7, fetchImpl = fetch) => {
  const requestIdPrefix = 'apps-list';
  let requestCount = 1;

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
      buildChunkedPayloads: (windowDays, chunkSize) =>
        buildChunkedAppListingPayloads(windowDays, chunkSize, requestIdPrefix),
      aggregateResults: (collector, response) => collector.push(...extractAppIds(response)),
      fetchImpl,
      onWindowSplit: (windowSize, payloadCount) =>
        logAggregationSplit('App discovery', windowSize, payloadCount),
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

    if (!isTooMuchDataOrTimeout(error)) {
      return { errorType: 'failed', requestCount };
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

/**
 * Post an aggregation payload using an integration key.
 * @param {AppAggregationEntry} entry
 * @param {object} payload
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<object>}
 */
export const postAggregationWithIntegrationKey = async (entry, payload, fetchImpl = fetch) => {
  const { domain, integrationKey } = entry || {};

  if (!domain || !integrationKey) {
    throw new Error('Domain and integration key are required for the aggregation request.');
  }

  const endpoint = `${normalizeDomain(domain)}/api/v1/aggregation`;
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

    if (timedOut || networkError?.name === 'AbortError') {
      throw createAggregationError(timeoutMessage, null, '');
    }

    throw createAggregationError(networkError?.message || 'Aggregation request could not be sent.', null, '');
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  const rawBody = await response?.text().catch(() => '');

  if (!response?.ok) {
    const statusLabel = response?.status ?? 'unknown status';
    const detail = rawBody?.trim() ? `: ${rawBody.trim()}` : '';
    throw createAggregationError(`Aggregation request failed (${statusLabel})${detail}`.trim(), response?.status, rawBody);
  }

  try {
    return rawBody ? JSON.parse(rawBody) : {};
  } catch (parseError) {
    throw createAggregationError('Aggregation response was not valid JSON.', response?.status, rawBody);
  }
};

/**
 * Proxy an aggregation request through the PHP endpoint.
 * @param {string} url Aggregations API endpoint.
 * @param {object} payload Aggregations request payload.
 * @param {string} cookieHeaderValue Raw cookie header including pendo.sess.jwt2.
 * @param {AggregationProxyOptions} options Proxy configuration.
 * @param {typeof fetch} fetchImpl Fetch implementation override for testing.
 */
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

export default {
  buildAggregationUrl,
  buildChunkedAppListingPayloads,
  buildMetadataFieldsForAppPayload,
  buildAppListingPayload,
  buildMetaEventsPayload,
  buildChunkedMetadataFieldPayloads,
  FALLBACK_WINDOW_SEQUENCE,
  isTooMuchDataOrTimeout,
  isTooMuchDataError,
  runAggregationWithFallbackWindows,
  buildCookieHeaderValue,
  buildExamplesPayload,
  buildMetadataFieldsPayload,
  buildRequestHeaders,
  postAggregationWithIntegrationKey,
  fetchAggregation,
  fetchAppsForEntry,
};
