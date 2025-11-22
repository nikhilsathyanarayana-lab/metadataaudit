const normalizeDomain = (domain) => domain.replace(/\/$/, '');

const buildAggregationRequestBody = () => ({
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

const buildRequestHeaders = (integrationKey) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'X-Pendo-Integration-Key': integrationKey,
});

export const postAggregationRequest = async (domain, integrationKey, requestBody = buildAggregationRequestBody()) => {
  const endpoint = `${normalizeDomain(domain)}/api/v1/aggregation`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      headers: buildRequestHeaders(integrationKey),
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(`Aggregation request failed (${response.status}) for ${endpoint}`);
      return null;
    }

    const data = await response.json();
    console.info(`Aggregation response received from ${endpoint}`);
    return data;
  } catch (error) {
    console.error(`Aggregation request encountered an error for ${endpoint}:`, error);
    return null;
  }
};

export const aggregationBuilders = {
  buildAggregationRequestBody,
  buildRequestHeaders,
};
