import { postAggregationWithIntegrationKey } from '../../src/services/requests/network.js';

const APP_LISTING_PAYLOAD = Object.freeze({
  response: {
    location: 'request',
    mimeType: 'application/json',
  },
  request: {
    pipeline: [
      {
        source: {
          apps: {},
        },
      },
      {
        select: {
          appId: 'id',
          appName: 'name',
        },
      },
      {
        sort: ['appName'],
      },
    ],
  },
});

let credentialEntries = Array.isArray(window?.appCredentials) ? window.appCredentials : [];

// Clean up credential inputs and drop empty entries.
const normalizeCredentials = (entries = []) =>
  entries
    .filter((entry) => entry && (entry.subId || entry.domain || entry.integrationKey))
    .map((entry) => ({
      subId: entry.subId || '',
      domain: entry.domain || '',
      integrationKey: entry.integrationKey || '',
    }));

// Persist normalized credentials for later API calls.
export const setAppCredentials = (entries = []) => {
  credentialEntries = normalizeCredentials(entries);
};

// Return normalized credentials using overrides or window defaults.
const getCredentials = (override) => {
  const normalized = normalizeCredentials(override ?? credentialEntries);

  if (normalized.length) {
    return normalized;
  }

  const windowCredentials = normalizeCredentials(window?.appCredentials || []);
  return windowCredentials;
};

// Fetch app listings for each credential set without rendering UI.
export async function app_names(entries) {
  const credentials = getCredentials(entries);

  if (!credentials.length) {
    return [];
  }

  const requests = credentials.map(async (credential) => {
    let response;

    try {
      response = await postAggregationWithIntegrationKey(
        credential,
        JSON.parse(JSON.stringify(APP_LISTING_PAYLOAD)),
      );
    } catch (error) {
      return {
        credential,
        errorType: 'failed',
        errorHint: error?.message,
      };
    }

    const results = response?.results
      || response?.response?.results
      || response?.data?.results
      || response?.response?.data?.results;

    if (!response || response.errorType || !Array.isArray(results)) {
      return {
        credential,
        errorType: response?.errorType || 'invalidResponse',
        errorHint: response?.errorHint,
      };
    }

    return {
      credential,
      results: results.map((app) => ({
        appId: app?.appId || '',
        appName: app?.appName || app?.appId || '',
      })),
    };
  });

  return Promise.all(requests);
}
