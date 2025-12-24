import { postAggregationWithIntegrationKey } from '../../src/services/requests/network.js';
import { app_names } from './app_names.js';

const DEFAULT_LOOKBACK_WINDOWS = [7, 30, 180];

const buildMetadataPayload = ({ appId, appName }, lookbackWindow = DEFAULT_LOOKBACK_WINDOWS[0]) => ({
  response: {
    location: 'request',
    mimeType: 'application/json',
  },
  request: {
    requestId: `meta-events-${appName || appId || 'unknown'}-${lookbackWindow}d`,
    name: 'metadata-audit',
    pipeline: [
      {
        source: {
          singleEvents: { appId },
          timeSeries: { first: 'now()', count: -Number(lookbackWindow), period: 'dayRange' },
        },
      },
      {
        filter: 'contains(type, `meta`) && title != ``',
      },
      {
        unmarshal: {
          metadata: 'title',
        },
      },
      {
        select: {
          visitor: 'metadata.visitor',
          account: 'metadata.account',
          custom: 'metadata.custom',
          salesforce: 'metadata.salesforce',
        },
      },
    ],
  },
});

const normalizeAppEntries = (entries = []) =>
  entries
    .filter((entry) => entry && (entry.subId || entry.appId))
    .map((entry) => ({
      subId: entry.subId || '',
      appId: entry.appId || '',
      appName: entry.appName || entry.appId || '',
    }));

const buildCredentialLookup = (credentialResults = []) => {
  const lookup = new Map();

  credentialResults.forEach((result) => {
    const subId = result?.credential?.subId;

    if (subId) {
      lookup.set(subId, result.credential);
    }
  });

  return lookup;
};

export const buildMetadataCallPlan = async (appEntries = [], lookbackWindow = DEFAULT_LOOKBACK_WINDOWS[0]) => {
  const normalizedApps = normalizeAppEntries(appEntries);

  if (!normalizedApps.length) {
    return [];
  }

  const credentialResults = await app_names();

  if (!credentialResults.length) {
    return [];
  }

  const credentialLookup = buildCredentialLookup(credentialResults);

  return normalizedApps
    .map((appEntry) => {
      const credential = credentialLookup.get(appEntry.subId) || credentialResults[0]?.credential;

      if (!credential) {
        return null;
      }

      const payload = buildMetadataPayload(appEntry, lookbackWindow);

      return {
        credential: { ...credential, appId: appEntry.appId },
        payload,
        app: appEntry,
      };
    })
    .filter(Boolean);
};

export const executeMetadataCallPlan = async (
  calls = [],
  lookbackWindow = DEFAULT_LOOKBACK_WINDOWS[0],
  onAggregation,
  limit = calls.length,
) => {
  if (!Array.isArray(calls) || !calls.length) {
    return [];
  }

  const maxCalls = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), calls.length)
    : calls.length;

  const responses = [];

  /* eslint-disable no-await-in-loop */
  for (let index = 0; index < maxCalls; index += 1) {
    const nextCall = calls[index];

    try {
      const response = await postAggregationWithIntegrationKey(nextCall.credential, nextCall.payload);

      if (typeof onAggregation === 'function') {
        onAggregation({
          app: nextCall.app,
          lookbackWindow,
          response,
          queueIndex: index,
          totalQueued: maxCalls,
        });
      }

      responses.push({
        app: nextCall.app,
        lookbackWindow,
        response,
        queueIndex: index,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Unable to request metadata audit payload.', error);
    }
  }
  /* eslint-enable no-await-in-loop */

  return responses;
};

export const requestMetadataDeepDive = async (
  appEntries = [],
  lookbackWindow = DEFAULT_LOOKBACK_WINDOWS[0],
  onAggregation,
) => {
  const calls = await buildMetadataCallPlan(appEntries, lookbackWindow);

  if (!calls.length) {
    return;
  }

  await executeMetadataCallPlan(calls, lookbackWindow, onAggregation, 1);
};
