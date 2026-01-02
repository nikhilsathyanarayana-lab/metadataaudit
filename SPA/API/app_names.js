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
const appCountsBySubId = new Map();

// Track the latest app totals per SubID from app_names responses.
const recordAppCounts = (credentialResults = []) => {
  let hasResults = false;
  const nextCounts = new Map();

  credentialResults.forEach((result) => {
    const subId = result?.credential?.subId;

    if (!subId) {
      return;
    }

    const apps = Array.isArray(result?.results) ? result.results : [];
    const uniqueAppIds = new Set();

    apps.forEach((app) => {
      if (app?.appId) {
        uniqueAppIds.add(String(app.appId));
      }
    });

    hasResults = true;
    nextCounts.set(String(subId), {
      total: apps.length,
      distinct: uniqueAppIds.size,
    });
  });

  if (!hasResults) {
    return;
  }

  appCountsBySubId.clear();
  nextCounts.forEach((count, subId) => appCountsBySubId.set(subId, count));
};

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
      const safeContext = {
        subId: credential?.subId || '',
        domain: credential?.domain || '',
      };

      // eslint-disable-next-line no-console
      console.error('[app_names] Failed to fetch app list.', { ...safeContext, error });

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
      const safeContext = {
        subId: credential?.subId || '',
        domain: credential?.domain || '',
      };
      const errorType = response?.errorType || 'invalidResponse';
      const errorHint = response?.errorHint || response?.response?.errorHint;

      // eslint-disable-next-line no-console
      console.error('[app_names] Invalid app list response.', {
        ...safeContext,
        errorType,
        errorHint,
      });

      return {
        credential,
        errorType,
        errorHint,
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

  const credentialResults = await Promise.all(requests);

  recordAppCounts(credentialResults);

  if (typeof window !== 'undefined') {
    window.appCountsBySubId = getAppCountBySubId();
  }

  return credentialResults;
}

// Return the total number of apps discovered for a SubID.
export const getAppCountForSub = (subId) => {
  return appCountsBySubId.get(String(subId))?.total || 0;
};

// Return the distinct app count for a SubID for selection calculations.
export const getDistinctAppCountForSub = (subId) => {
  return appCountsBySubId.get(String(subId))?.distinct || 0;
};

// Snapshot all tracked app totals for debugging or UI summaries.
export function getAppCountBySubId() {
  return Object.fromEntries(appCountsBySubId);
}
