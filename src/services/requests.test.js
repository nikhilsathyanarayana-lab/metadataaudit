import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAggregationUrl,
  buildAppAggregationRequest,
  buildCookieHeaderValue,
  buildAppDiscoveryPayload,
  buildMetadataFieldsForAppPayload,
  buildMetadataFieldsTimeSeriesSlice,
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

  const { timeSeries, singleEvents } = request?.pipeline?.[0]?.source || {};

  assert.equal(singleEvents?.appId, 'app-1');
  assert.equal(timeSeries?.count, -30);
  assert.equal(timeSeries?.first, 'startOfPeriod("dayRange", now())');
  assert.equal(timeSeries?.period, 'dayRange');
});

test('buildMetadataFieldsTimeSeriesSlice uses day-aligned windows per offset', () => {
  const offsets = [0, 30, 60, 90, 120, 150];
  const sliceFirsts = offsets.map(
    (offset) => buildMetadataFieldsTimeSeriesSlice('app-1', offset, 30)?.timeSeries?.first,
  );

  assert.deepEqual(sliceFirsts, [
    'startOfPeriod("dayRange", now())',
    'startOfPeriod("dayRange", dateAdd(now(), -30, "days"))',
    'startOfPeriod("dayRange", dateAdd(now(), -60, "days"))',
    'startOfPeriod("dayRange", dateAdd(now(), -90, "days"))',
    'startOfPeriod("dayRange", dateAdd(now(), -120, "days"))',
    'startOfPeriod("dayRange", dateAdd(now(), -150, "days"))',
  ]);
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
