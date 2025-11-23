const normalizeDomain = (domain) => domain?.replace(/\/$/, '') || '';

export const buildAggregationUrl = (envUrls, envValue, subId) => {
  const endpointTemplate = envUrls?.[envValue];
  return endpointTemplate?.replace('{sub_id}', encodeURIComponent(subId));
};

export const buildHeaders = (cookieHeaderValue) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  cookie: cookieHeaderValue,
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

export const fetchAggregation = async (url, payload, cookieHeaderValue) => {
  const endpoint = normalizeDomain(url);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: buildHeaders(cookieHeaderValue),
    body: JSON.stringify(payload),
    credentials: 'include',
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => null);
    throw new Error(
      `Aggregation request failed (${response.status}): ${response.statusText}${errorText ? ` - ${errorText}` : ''}`,
    );
  }

  return response.json();
};
