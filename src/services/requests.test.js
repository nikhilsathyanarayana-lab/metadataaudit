import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAggregationUrl,
  buildAppListingPayload,
  buildCookieHeaderValue,
  buildMetaEventsPayload,
  buildMetadataFieldsForAppPayload,
  buildChunkedMetadataFieldPayloads,
  fetchAggregation,
  fetchAppsForEntry,
  postAggregationWithIntegrationKey,
} from './requests.js';

test('buildCookieHeaderValue normalizes different formats', () => {
  assert.equal(buildCookieHeaderValue(''), '');
  assert.equal(buildCookieHeaderValue('cookie: pendo.sess.jwt2=abc123'), 'pendo.sess.jwt2=abc123');
  assert.equal(buildCookieHeaderValue('abc123'), 'pendo.sess.jwt2=abc123');
});

test('buildAggregationUrl interpolates the subscription id', () => {
  const envUrls = { us: 'https://example.com/api/{sub_id}/aggregation' };
  const result = buildAggregationUrl(envUrls, 'us', '1234');

  assert.equal(result, 'https://example.com/api/1234/aggregation');
});

test('buildMetaEventsPayload uses a single request with pipeline', () => {
  const payload = buildMetaEventsPayload('app-123', 10);

  assert.equal(payload.response?.location, 'request');
  assert.ok(Array.isArray(payload.request?.pipeline));
  assert.ok(!payload.requests);

  const source = payload.request?.pipeline?.[0]?.source;
  assert.equal(source?.singleEvents?.appId, 'app-123');
  assert.equal(source?.timeSeries?.count, -10);
  assert.equal(source?.timeSeries?.period, 'dayRange');

  const filterStep = payload.request?.pipeline?.[1];
  assert.equal(filterStep?.filter, 'contains(type,`meta`)');
});

test('fetchAppsForEntry posts to the aggregation endpoint with headers', async () => {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ apps: ['one'] }) };
  };

  const response = await fetchAppsForEntry(
    { domain: 'https://apps.example.com/', integrationKey: 'integration-key' },
    fetchMock,
  );

  assert.deepEqual(response, { apps: ['one'] });
  assert.equal(calls[0].url, 'https://apps.example.com/api/v1/aggregation');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-Pendo-Integration-Key'], 'integration-key');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.request?.requestId, 'apps-list');
  assert.ok(Array.isArray(buildAppListingPayload('apps-list').request?.pipeline));
});

test('buildAppListingPayload maintains the expected shape', () => {
  const payload = buildAppListingPayload();
  assert.equal(payload.request?.requestId, 'app-discovery');
  assert.ok(Array.isArray(payload.request?.pipeline));
});

test('buildMetadataFieldsForAppPayload mirrors the workbook query', () => {
  const payload = buildMetadataFieldsForAppPayload('app-1', 30);
  const { request } = payload;

  assert.equal(request?.name, 'metadata-fields-for-app');
  assert.equal(request?.pipeline?.[0]?.spawn?.length, 2);

  const visitorSource = request?.pipeline?.[0]?.spawn?.[0]?.[0]?.source;
  const accountSource = request?.pipeline?.[0]?.spawn?.[1]?.[0]?.source;

  assert.equal(visitorSource?.singleEvents?.appId, 'app-1');
  assert.equal(visitorSource?.timeSeries?.count, -30);
  assert.equal(accountSource?.singleEvents?.appId, 'app-1');
  assert.equal(accountSource?.timeSeries?.count, -30);
});

test('buildChunkedMetadataFieldPayloads creates 30-day slices for retries', () => {
  const payloads = buildChunkedMetadataFieldPayloads('app-1', 180);

  assert.equal(payloads.length, 6);
  assert.ok(
    payloads.every((payload, index) => payload.request?.requestId?.endsWith(`-chunk-${index + 1}`)),
  );

  const extractTimeSeries = (payload) =>
    payload.request?.pipeline?.[0]?.spawn?.map((branch) => branch?.[0]?.source?.timeSeries) || [];

  const getOffset = (timeSeries) => {
    const match = timeSeries?.first?.match(/dateAdd\(now\(\), -(\d+), "days"\)/);
    return Number(match?.[1]);
  };

  payloads.forEach((payload, idx) => {
    const series = extractTimeSeries(payload);
    const expectedFirst = `dateAdd(now(), -${idx * 30}, "days")`;
    const expectedCount = -30;

    assert.ok(
      series.every(
        (item) =>
          typeof item?.first === 'string' &&
          item?.first === expectedFirst &&
          item?.count === expectedCount &&
          item?.period === 'dayRange',
      ),
    );
  });

  for (let i = 0; i < payloads.length - 1; i += 1) {
    const currentSeries = extractTimeSeries(payloads[i]);
    const nextSeries = extractTimeSeries(payloads[i + 1]);

    currentSeries.forEach((currentItem, branchIdx) => {
      const nextItem = nextSeries[branchIdx];
      assert.equal(getOffset(nextItem) - getOffset(currentItem), 30);
    });
  }
});

test('fetchAggregation proxies the request with extracted token', async () => {
  const payload = { test: true };
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const response = await fetchAggregation(
    'https://aggregations.example.com/api',
    payload,
    'pendo.sess.jwt2=jwt-token; other=value',
    { region: 'us', subId: 'sub-1' },
    fetchMock,
  );

  assert.deepEqual(response, { ok: true });
  assert.equal(calls[0].url, 'proxy.php');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');

  const parsedBody = JSON.parse(calls[0].options.body);
  assert.equal(parsedBody.token, 'jwt-token');
  assert.equal(parsedBody.region, 'us');
  assert.equal(parsedBody.subId, 'sub-1');
  assert.deepEqual(parsedBody.payload, payload);
  assert.equal(parsedBody.endpointPreview, 'https://aggregations.example.com/api');
});

test('fetchAggregation errors when token is missing', async () => {
  await assert.rejects(
    () =>
      fetchAggregation(
        'https://aggregations.example.com/api',
        {},
        '',
        { region: 'us', subId: 'sub-1' },
        async () => ({ ok: true, json: async () => ({}) }),
      ),
    /pendo.sess.jwt2/,
  );
});

test('postAggregationWithIntegrationKey forwards the request payload', async () => {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const payload = { request: { requestId: 'test' } };
  const entry = { domain: 'https://apps.example.com', integrationKey: 'abc' };

  const response = await postAggregationWithIntegrationKey(entry, payload, fetchMock);

  assert.deepEqual(response, { ok: true });
  assert.equal(calls[0].url, 'https://apps.example.com/api/v1/aggregation');
  assert.equal(calls[0].options.headers['X-Pendo-Integration-Key'], 'abc');
  assert.equal(JSON.parse(calls[0].options.body).request.requestId, 'test');
});

test('postAggregationWithIntegrationKey attaches response metadata to thrown errors', async () => {
  const fetchMock = async () => ({
    ok: false,
    status: 500,
    text: async () => 'server boom',
  });

  const payload = { request: { requestId: 'test' } };
  const entry = { domain: 'https://apps.example.com', integrationKey: 'abc' };

  await assert.rejects(
    postAggregationWithIntegrationKey(entry, payload, fetchMock),
    (error) => {
      assert.equal(error.responseStatus, 500);
      assert.equal(error.responseBody, 'server boom');
      assert.match(error.message, /Aggregation request failed/);
      return true;
    },
  );
});

test('fetchAppsForEntry logs response metadata before returning null', async () => {
  const messages = [];
  const originalConsoleError = console.error;

  console.error = (...args) => {
    messages.push(args);
  };

  try {
    const fetchMock = async () => ({
      ok: false,
      status: 404,
      text: async () => 'not found',
    });

    const entry = { domain: 'https://apps.example.com', integrationKey: 'abc' };
    const result = await fetchAppsForEntry(entry, fetchMock);

    assert.equal(result, null);
    assert.ok(
      messages.some(
        ([label, details]) =>
          label === 'Aggregation response details:' &&
          details?.status === 404 &&
          details?.body === 'not found',
      ),
    );
  } finally {
    console.error = originalConsoleError;
  }
});
