import { postAggregationWithIntegrationKey } from '../../src/services/requests/network.js';
import { app_names } from './app_names.js';

export const DEFAULT_LOOKBACK_WINDOW = 7;
export const METADATA_NAMESPACES = ['visitor', 'account', 'custom', 'salesforce'];
let metadataCallQueue = [];
let lastDiscoveredApps = [];
const metadataAggregations = {};
const METADATA_WINDOW_PLAN = [
  { lookbackWindow: 7, first: 'now()' },
  { lookbackWindow: 23, first: 'dateAdd(now(), -7, "days")' },
  { lookbackWindow: 150, first: 'dateAdd(now(), -30, "days")' },
];
// Calculate the intended lookback coverage from the configured window plan.
const normalizeWindowPlanCoverage = (windowPlan = METADATA_WINDOW_PLAN) => {
  const normalizedPlan = Array.isArray(windowPlan) ? windowPlan : [];
  const totalCoverage = normalizedPlan.reduce((total, windowConfig) => {
    const normalizedWindow = Number(windowConfig?.lookbackWindow);

    return Number.isFinite(normalizedWindow) && normalizedWindow > 0
      ? total + normalizedWindow
      : total;
  }, 0);
  const largestWindow = normalizedPlan.reduce((largest, windowConfig) => {
    const normalizedWindow = Number(windowConfig?.lookbackWindow);

    return Number.isFinite(normalizedWindow) && normalizedWindow > 0
      ? Math.max(largest, normalizedWindow)
      : largest;
  }, 0);
  const baseline = Number.isFinite(Number(DEFAULT_LOOKBACK_WINDOW)) ? Number(DEFAULT_LOOKBACK_WINDOW) : 0;

  return Math.max(totalCoverage, largestWindow, baseline);
};
let lookbackDays = normalizeWindowPlanCoverage();
// Reset the remaining lookback day balance to cover every planned metadata window.
export const resetLookbackDays = (windowPlan = METADATA_WINDOW_PLAN) => {
  lookbackDays = normalizeWindowPlanCoverage(windowPlan);

  return lookbackDays;
};
// Reduce the remaining lookback day balance by the size of a completed window.
export const decrementLookbackDays = (processedDays = DEFAULT_LOOKBACK_WINDOW) => {
  const normalizedWindow = Number(processedDays);

  if (!Number.isFinite(normalizedWindow) || normalizedWindow <= 0) {
    return lookbackDays;
  }

  lookbackDays = Math.max(lookbackDays - normalizedWindow, 0);

  return lookbackDays;
};

// Return a sorted list of metadata field names for the given SubID/app namespace.
export const getMetadataFields = (subId, appId, namespace) => {
  if (!subId || !appId || !namespace) {
    return [];
  }

  const namespaceBucket = metadataAggregations?.[subId]?.apps?.[appId]?.namespaces?.[namespace];

  if (!namespaceBucket || typeof namespaceBucket !== 'object') {
    return [];
  }

  return Object.keys(namespaceBucket).sort((first, second) => first.localeCompare(second));
};

// Ensure a namespace bucket exists for a SubID + App ID combination.
const getAppAggregationBucket = (subId, appId, appName) => {
  if (!metadataAggregations[subId]) {
    metadataAggregations[subId] = { apps: {} };
  }

  const appBuckets = metadataAggregations[subId].apps;

  if (!appBuckets[appId]) {
    appBuckets[appId] = {
      appId,
      appName,
      timeseriesStart: null,
      lookbackWindow: DEFAULT_LOOKBACK_WINDOW,
      namespaces: METADATA_NAMESPACES.reduce((accumulator, key) => ({
        ...accumulator,
        [key]: {},
      }), {}),
      windows: {},
    };
  }

  return appBuckets[appId];
};

// Guarantee a namespace bucket for a specific lookback window.
const getWindowNamespaceBucket = (appBucket, lookbackWindow) => {
  const normalizedWindow = Number(lookbackWindow);
  const windowKey = Number.isFinite(normalizedWindow) ? normalizedWindow : DEFAULT_LOOKBACK_WINDOW;

  if (!appBucket.windows[windowKey]) {
    appBucket.windows[windowKey] = {
      lookbackWindow: windowKey,
      namespaces: METADATA_NAMESPACES.reduce((accumulator, key) => ({
        ...accumulator,
        [key]: {},
      }), {}),
      timeseriesStart: null,
    };
  }

  return appBucket.windows[windowKey];
};

// Normalize a metadata value to an array of string tokens for counting.
export const normalizeFieldValues = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFieldValues(entry)).flat();
  }

  if (value && typeof value === 'object') {
    return [JSON.stringify(value)];
  }

  if (value === null) {
    return ['null'];
  }

  if (typeof value === 'undefined') {
    return ['undefined'];
  }

  return [`${value}`];
};

// Increment counts for each value within a field bucket.
export const trackFieldValues = (namespaceBucket, fieldName, rawValue) => {
  const values = normalizeFieldValues(rawValue);

  if (!namespaceBucket[fieldName]) {
    namespaceBucket[fieldName] = { values: {}, total: 0 };
  }

  values.forEach((value) => {
    namespaceBucket[fieldName].values[value] = (namespaceBucket[fieldName].values[value] || 0) + 1;
    namespaceBucket[fieldName].total += 1;
  });
};

// Tally visitor/account/custom/Salesforce fields for a single aggregation result.
export const tallyAggregationResult = (namespaces, result, namespaceKeys = ['visitor', 'account', 'custom', 'salesforce']) => {
  namespaceKeys.forEach((namespaceKey) => {
    const namespaceData = result?.[namespaceKey];

    if (!namespaceData || typeof namespaceData !== 'object') {
      return;
    }

    Object.entries(namespaceData).forEach(([fieldName, value]) => {
      trackFieldValues(namespaces[namespaceKey], fieldName, value);
    });
  });
};

// Return the time-series window payload for metadata lookups.
export const timeseriesWindow = (lookbackWindow = DEFAULT_LOOKBACK_WINDOW, first = 'now()') => ({
  first,
  count: -Number(lookbackWindow),
  period: 'dayRange',
});

// Build the aggregation payload to pull metadata events for an app within a lookback window.
const buildMetadataPayload = (
  { appId, appName },
  { lookbackWindow = DEFAULT_LOOKBACK_WINDOW, first = 'now()' } = {},
) => ({
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
          timeSeries: timeseriesWindow(lookbackWindow, first),
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

// Normalize app entries to the fields required for downstream requests.
const normalizeAppEntries = (entries = []) =>
  entries
    .filter((entry) => entry && (entry.subId || entry.appId))
    .map((entry) => ({
      subId: entry.subId || '',
      appId: entry.appId || '',
      appName: entry.appName || entry.appId || '',
    }));

// Map credentials by subId for quick lookup during call planning.
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

// Construct credential-bound API requests for each app to fetch metadata across planned windows.
export const buildMetadataCallPlan = async (appEntries = []) => {
  const normalizedApps = normalizeAppEntries(appEntries);

  if (!normalizedApps.length) {
    return [];
  }

  const credentialResults = await app_names();

  if (!credentialResults.length) {
    return [];
  }

  const credentialLookup = buildCredentialLookup(credentialResults);
  const plannedCalls = [];

  METADATA_WINDOW_PLAN.forEach((windowConfig) => {
    normalizedApps.forEach((appEntry) => {
      const credential = credentialLookup.get(appEntry.subId) || credentialResults[0]?.credential;

      if (!credential) {
        return;
      }

      const payload = buildMetadataPayload(appEntry, windowConfig);

      plannedCalls.push({
        credential: { ...credential, appId: appEntry.appId },
        payload,
        app: appEntry,
        lookbackWindow: windowConfig.lookbackWindow,
        timeseriesFirst: windowConfig.first,
      });
    });
  });

  return plannedCalls;
};

// Prepare a reusable queue of metadata calls for the supplied entries.
export const buildMetadataQueue = async (entries = [], lookbackWindow = DEFAULT_LOOKBACK_WINDOW) => {
  metadataCallQueue = await buildMetadataCallPlan(entries);
  lastDiscoveredApps = entries;
  resetLookbackDays(METADATA_WINDOW_PLAN);

  // eslint-disable-next-line no-console
  console.log('[buildMetadataQueue] Ready', {
    count: metadataCallQueue.length,
    lookbackWindow,
    windowsPerApp: METADATA_WINDOW_PLAN.length,
    plannedWindows: METADATA_WINDOW_PLAN,
  });

  return metadataCallQueue;
};

// Return the current metadata queue entries.
export const getMetadataQueue = () => metadataCallQueue;

// Rebuild the metadata queue using the most recently supplied entries.
export const rebuildMetadataQueue = async (lookbackWindow = DEFAULT_LOOKBACK_WINDOW) =>
  buildMetadataQueue(lastDiscoveredApps, lookbackWindow);

// Execute prepared metadata requests sequentially and relay each aggregation result.
export const executeMetadataCallPlan = async (
  calls = [],
  lookbackWindow = DEFAULT_LOOKBACK_WINDOW,
  onAggregation,
  limit = calls.length,
  queueOffset = 0,
  totalQueued = calls.length,
) => {
  if (!Array.isArray(calls) || !calls.length) {
    return [];
  }

  const maxCalls = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), calls.length)
    : calls.length;

  const responses = [];
  const totalQueueSize = Number.isFinite(Number(totalQueued)) && Number(totalQueued) > 0
    ? Number(totalQueued)
    : maxCalls + queueOffset;

  /* eslint-disable no-await-in-loop */
  for (let index = 0; index < maxCalls; index += 1) {
    const nextCall = calls[index];
    const targetWindow = Number.isFinite(Number(nextCall?.lookbackWindow))
      ? Number(nextCall.lookbackWindow)
      : lookbackWindow;

    try {
      const response = await postAggregationWithIntegrationKey(nextCall.credential, nextCall.payload);

      if (typeof onAggregation === 'function') {
        onAggregation({
          app: nextCall.app,
          lookbackWindow: targetWindow,
          timeseriesFirst: nextCall.timeseriesFirst,
          response,
          queueIndex: index + queueOffset,
          totalQueued: totalQueueSize,
        });
      }

      responses.push({
        app: nextCall.app,
        lookbackWindow: targetWindow,
        timeseriesFirst: nextCall.timeseriesFirst,
        response,
        queueIndex: index + queueOffset,
      });
      decrementLookbackDays(targetWindow);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Unable to request metadata audit payload.', error);
    }
  }
  /* eslint-enable no-await-in-loop */

  return responses;
};

// Log and summarize each aggregated metadata response.
export const processAggregation = ({ app, lookbackWindow, response }) => {
  const subId = app?.subId || 'unknown-subid';
  const appId = app?.appId || 'unknown-appid';
  const appName = app?.appName || appId || 'unknown-app';
  const aggregationResults = Array.isArray(response?.results) ? response.results : [];
  const appBucket = getAppAggregationBucket(subId, appId, appName);
  const windowBucket = getWindowNamespaceBucket(appBucket, lookbackWindow);

  appBucket.appName = appName;
  appBucket.lookbackWindow = lookbackWindow;
  appBucket.timeseriesStart = response?.startTime || appBucket.timeseriesStart;
  windowBucket.timeseriesStart = response?.startTime || windowBucket.timeseriesStart;

  aggregationResults.forEach((result) => {
    tallyAggregationResult(appBucket.namespaces, result, METADATA_NAMESPACES);
    tallyAggregationResult(windowBucket.namespaces, result, METADATA_NAMESPACES);
  });

  if (typeof window !== 'undefined') {
    window.metadataAggregations = metadataAggregations;
  }

  // eslint-disable-next-line no-console
  console.log('[processAggregation]', {
    appId,
    appName,
    lookbackWindow,
    subId,
    timeseriesStart: appBucket.timeseriesStart,
    totalResults: aggregationResults.length,
  });
};

// Execute queued metadata calls in window order with an optional limit to throttle requests.
export const runMetadataQueue = async (
  onAggregation,
  lookbackWindow = DEFAULT_LOOKBACK_WINDOW,
  limit = metadataCallQueue.length,
) => {
  if (!metadataCallQueue.length) {
    // eslint-disable-next-line no-console
    console.warn('[runMetadataQueue] No queued metadata calls to run.');
    return [];
  }

  const plannedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Number(limit)
    : metadataCallQueue.length;
  const totalQueued = metadataCallQueue.length;
  const responses = [];
  let remaining = plannedLimit;
  let windowOffset = 0;

  for (let index = 0; index < METADATA_WINDOW_PLAN.length; index += 1) {
    const targetWindow = METADATA_WINDOW_PLAN[index].lookbackWindow;
    const windowCalls = metadataCallQueue.filter(
      (call) => Number(call.lookbackWindow) === Number(targetWindow),
    );

    if (!windowCalls.length) {
      continue;
    }

    if (remaining <= 0) {
      break;
    }

    const callsToRun = windowCalls.slice(0, remaining);
    const windowResponses = await executeMetadataCallPlan(
      callsToRun,
      lookbackWindow,
      onAggregation,
      callsToRun.length,
      windowOffset,
      totalQueued,
    );

    responses.push(...windowResponses);
    remaining -= callsToRun.length;
    windowOffset += windowCalls.length;
  }

  return responses;
};

// Orchestrate a single metadata audit request per app with optional aggregation callbacks.
export const requestMetadataDeepDive = async (
  appEntries = [],
  lookbackWindow = DEFAULT_LOOKBACK_WINDOW,
  onAggregation,
) => {
  const calls = await buildMetadataCallPlan(appEntries);

  if (!calls.length) {
    return;
  }

  resetLookbackDays(METADATA_WINDOW_PLAN);
  await executeMetadataCallPlan(calls, lookbackWindow, onAggregation, 1);
};
