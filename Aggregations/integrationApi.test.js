import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAggregationUrl,
  buildAppListingPayload,
  buildExamplesPayload,
  buildMetadataFieldsPayload,
} from './aggregationRequests.js';

const TEST_DOMAIN = process.env.PENDO_TEST_DOMAIN || 'https://app.eu.pendo.io/';
const TEST_INTEGRATION_KEY =
  process.env.PENDO_TEST_INTEGRATION_KEY || '929705d6-6b7d-473c-98d8-655ff2716e6f';
const TEST_SUB_ID = process.env.PENDO_TEST_SUB_ID || '5333058005958656';

const integrationEndpoint = (domain) => `${domain.replace(/\/$/, '')}/api/v1/aggregation`;
const buildIntegrationHeaders = (integrationKey) => ({
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'X-Pendo-Integration-Key': integrationKey,
});

const extractAppIds = (apiResponse) => {
  if (!apiResponse) {
    return [];
  }

  const candidateLists = [apiResponse?.results, apiResponse?.data, apiResponse?.apps];

  if (Array.isArray(apiResponse)) {
    candidateLists.push(apiResponse);
  }

  return candidateLists
    .filter(Array.isArray)
    .flat()
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (entry?.appId) {
        return entry.appId;
      }

      return null;
    })
    .filter(Boolean);
};

test('buildAggregationUrl interpolates the subscription id', () => {
  const envUrls = {
    eu: 'https://aggregations-dot-pendo-io.gke.eu.pendo.io/api/s/{sub_id}/aggregation?all=true',
  };

  const url = buildAggregationUrl(envUrls, 'eu', TEST_SUB_ID);

  assert.equal(
    url,
    'https://aggregations-dot-pendo-io.gke.eu.pendo.io/api/s/5333058005958656/aggregation?all=true',
    'The URL template should substitute the SubID into the EU endpoint template.',
  );
});

test('payload builders keep the expected request shape', () => {
  const discoveryPayload = buildAppListingPayload();
  const metadataPayload = buildMetadataFieldsPayload(30);
  const examplesPayload = buildExamplesPayload();

  [discoveryPayload, metadataPayload, examplesPayload].forEach((payload) => {
    assert.ok(payload.response?.mimeType === 'application/json', 'Response should request JSON.');
    assert.ok(Array.isArray(payload.request?.pipeline), 'Pipelines should be arrays of stages.');
  });

  assert.equal(metadataPayload.request?.requestId, 'metadata-fields-30');
  assert.equal(metadataPayload.request?.pipeline?.[0]?.source?.metadata?.account, true);
  assert.equal(examplesPayload.request?.pipeline?.[1]?.select?.examples, 'metadata');
});

test(
  'integration API returns app ids for the provided subscription',
  { timeout: 20000 },
  async (t) => {
    let response;

    try {
      response = await fetch(integrationEndpoint(TEST_DOMAIN), {
        method: 'POST',
        headers: buildIntegrationHeaders(TEST_INTEGRATION_KEY),
        body: JSON.stringify(buildAppListingPayload()),
      });
    } catch (error) {
      const networkErrorCode = error?.cause?.code || error?.code;
      const networkMessages = error?.cause?.errors?.map((item) => item?.code).filter(Boolean) || [];

      if (networkErrorCode === 'ENETUNREACH' || networkMessages.includes('ENETUNREACH')) {
        t.diagnostic('Skipping live integration call because the network is unreachable from this environment.');
        t.skip('Network unreachable for the integration API endpoint.');
        return;
      }

      throw error;
    }

    assert.equal(response.ok, true, `Aggregation request failed: ${response.status} ${response.statusText}`);

    const body = await response.json();
    const appIds = extractAppIds(body);

    t.diagnostic(`Received ${appIds.length} app ids for SubID ${TEST_SUB_ID}`);
    assert.ok(appIds.length > 0, 'Integration API should return at least one app ID.');
  },
);
