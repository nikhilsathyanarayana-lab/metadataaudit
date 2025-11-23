/**
 * @typedef {Object} AppAggregationEntry
 * @property {string} domain The base domain for the aggregation request.
 * @property {string} integrationKey Pendo integration key for authentication.
 */

const normalizeDomain = (domain) => domain?.replace(/\/$/, '') || '';

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
  const { domain, integrationKey } = entry;
  const endpoint = `${normalizeDomain(domain)}/api/v1/aggregation`;

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: buildRequestHeaders(integrationKey),
      body: JSON.stringify(buildAppAggregationRequest()),
    });

    if (!response?.ok) {
      throw new Error(`Aggregation request failed (${response?.status}) for ${endpoint}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Aggregation request encountered an error:', error);
    return null;
  }
};

export default {
  buildAppAggregationRequest,
  buildRequestHeaders,
  fetchAppsForEntry,
};
