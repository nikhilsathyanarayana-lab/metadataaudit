import assert from 'node:assert';
import test from 'node:test';
import { buildAppAggregationRequest, buildRequestHeaders, fetchAppsForEntry } from './requests.js';

test('buildAppAggregationRequest returns app discovery pipeline', () => {
  const payload = buildAppAggregationRequest();
  assert.equal(payload?.request?.requestId, 'apps-list');
  assert.ok(Array.isArray(payload?.request?.pipeline));
  assert.ok(payload.request.pipeline.some((step) => step?.group));
});

test('buildRequestHeaders includes integration key', () => {
  const headers = buildRequestHeaders('abc123');
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(headers['X-Pendo-Integration-Key'], 'abc123');
});

test('fetchAppsForEntry posts payload to the aggregation endpoint', async () => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      json: async () => ({ result: 'ok' }),
    };
  };

  const result = await fetchAppsForEntry(
    { domain: 'https://example.com/', integrationKey: 'key-123' },
    mockFetch,
  );

  assert.deepEqual(result, { result: 'ok' });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.url, 'https://example.com/api/v1/aggregation');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['X-Pendo-Integration-Key'], 'key-123');
  assert.ok(call.options.body.includes('apps-list'));
});

test('fetchAppsForEntry returns null on failure', async () => {
  const mockFetch = async () => ({ ok: false, status: 500 });
  const result = await fetchAppsForEntry({ domain: 'https://bad.test', integrationKey: 'fail' }, mockFetch);
  assert.equal(result, null);
});
