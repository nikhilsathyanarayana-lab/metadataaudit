import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAggregationUrl,
  buildAppAggregationRequest,
  buildCookieHeaderValue,
  buildAppDiscoveryPayload,
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
  assert.ok(Array.isArray(buildAppAggregationRequest().request?.pipeline));
});

test('buildAppDiscoveryPayload maintains the expected shape', () => {
  const payload = buildAppDiscoveryPayload();
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
  const originalNow = Date.now;
  const mockedNow = 1_700_000_000_000;
  const msPerDay = 24 * 60 * 60 * 1000;

  try {
    Date.now = () => mockedNow;
    const payloads = buildChunkedMetadataFieldPayloads('app-1', 180);

    assert.equal(payloads.length, 6);
    assert.ok(
      payloads.every((payload, index) => payload.request?.requestId?.endsWith(`-chunk-${index + 1}`)),
    );

    const extractTimeSeries = (payload) =>
      payload.request?.pipeline?.[0]?.spawn?.map((branch) => branch?.[0]?.source?.timeSeries) || [];

    payloads.forEach((payload, idx) => {
      const series = extractTimeSeries(payload);
      const expectedFirst = mockedNow - idx * 30 * msPerDay;
      const expectedCount = -(30 * msPerDay);

      assert.ok(
        series.every(
          (item) =>
            typeof item?.first === 'number' &&
            item?.first === expectedFirst &&
            item?.count === expectedCount &&
            item?.period === 'millisecondRange',
        ),
      );
    });
  } finally {
    Date.now = originalNow;
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
