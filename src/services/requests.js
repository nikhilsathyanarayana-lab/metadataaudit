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

/**
 * Build the aggregation payload used to discover available apps.
 * @returns {object}
 */
export const buildAppAggregationRequest = () => ({
  response: { location: 'request', mimeType: 'application/json' },
  request: {
    requestId: 'apps-list',
    pipeline: [
      {
        source: {
          singleEvents: { appId: 'expandAppIds("*")' },
          timeSeries: { first: 'now()', count: -7, period: 'dayRange' },
        },
      },
      { group: { group: ['appId'] } },
      { select: { appId: 'appId' } },
    ],
  },
});

export const buildAppDiscoveryPayload = () => ({
  response: { location: 'request', mimeType: 'application/json' },
  request: {
    requestId: 'app-discovery',
    pipeline: [
      {
        source: {
          singleEvents: { appId: 'expandAppIds("*")' },
          timeSeries: { first: 'now()', count: -7, period: 'dayRange' },
        },
      },
      { group: { group: ['appId'] } },
      { select: { appId: 'appId' } },
    ],
  },
});

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
    const last = `dateAdd(now(), -${chunkIndex * chunkSize}, "days")`;

    const payload = buildMetadataFieldsForAppPayload(appId, windowDays);
    const spawn = payload?.request?.pipeline?.[0]?.spawn;

    if (Array.isArray(spawn)) {
      spawn.forEach((branch) => {
        const source = branch?.[0]?.source;

        if (source?.timeSeries) {
          source.timeSeries = {
            ...source.timeSeries,
            last,
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
 * @returns {Promise<object|null>}
 */
export const fetchAppsForEntry = async (entry, fetchImpl = fetch) => {
  try {
    return await postAggregationWithIntegrationKey(entry, buildAppAggregationRequest(), fetchImpl);
  } catch (error) {
    console.error('Aggregation request encountered an error:', error);
    return null;
  }
};

const extractJwtToken = (cookieHeaderValue) => {
  if (!cookieHeaderValue) {
    return '';
  }

  const match = cookieHeaderValue.match(/pendo\.sess\.jwt2\s*=\s*([^;\s]+)/i);
  return match?.[1] || '';
};

export const buildHeaders = (cookieHeaderValue) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  cookie: cookieHeaderValue,
});

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
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: buildRequestHeaders(integrationKey),
    body: JSON.stringify(payload),
  });

  if (!response?.ok) {
    const rawBody = await response.text().catch(() => '');
    const detail = rawBody?.trim() ? `: ${rawBody.trim()}` : '';
    const statusLabel = response?.status || 'unknown status';
    throw new Error(`Aggregation request failed (${statusLabel})${detail}`);
  }

  return response.json();
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

  const response = await fetchImpl(proxyEndpoint, {
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

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    let parsedBody;

    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch (parseError) {
      parsedBody = null;
    }

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
    const statusLabel = response.status || 'unknown status';
    const message = detail
      ? `Aggregation request failed (${statusLabel}): ${detail}`
      : `Aggregation request failed (status ${statusLabel}).`;

    const error = new Error(message);
    error.details = { status: response.status, body: parsedBody || rawBody };
    throw error;
  }

  return response.json();
};

export default {
  buildAggregationUrl,
  buildMetadataFieldsForAppPayload,
  buildAppAggregationRequest,
  buildAppDiscoveryPayload,
  buildChunkedMetadataFieldPayloads,
  buildCookieHeaderValue,
  buildExamplesPayload,
  buildHeaders,
  buildMetadataFieldsPayload,
  buildRequestHeaders,
  postAggregationWithIntegrationKey,
  fetchAggregation,
  fetchAppsForEntry,
};
