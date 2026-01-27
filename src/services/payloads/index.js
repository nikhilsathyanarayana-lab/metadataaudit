import { createLogger } from '../../utils/logger.js';

const requestLogger = createLogger('Requests', {
  debugFlag: ['DEBUG_LOGGING', 'DEBUG_DEEP_DIVE'],
});

// Build a time-series window in day ranges.
const buildWindowTimeSeries = (startOffset, chunkDays) => ({
  first: `dateAdd(now(), -${startOffset + chunkDays}, "days")`,
  count: -chunkDays,
  period: 'dayRange',
});

// Build a time-series window in hour ranges.
const buildHourWindowTimeSeries = (startOffsetHours, chunkHours) => ({
  first: `dateAdd(now(), -${startOffsetHours + chunkHours}, "hours")`,
  count: -chunkHours,
  period: 'hourRange',
});

const applyPrimaryTimeSeriesWindow = (payload, window) => {
  const timeSeries = payload?.request?.pipeline?.[0]?.source?.timeSeries;

  if (timeSeries) {
    Object.assign(timeSeries, window);
  }
};

const applySpawnTimeSeriesWindow = (payload, window) => {
  const spawn = payload?.request?.pipeline?.[0]?.spawn;

  if (!Array.isArray(spawn)) {
    return;
  }

  spawn.forEach((branch) => {
    const source = branch?.[0]?.source;

    if (source?.timeSeries) {
      Object.assign(source.timeSeries, window);
    }
  });
};

const appendChunkSuffix = (payload, chunkIndex, fallbackId = 'request') => {
  if (!payload?.request) {
    return;
  }

  const baseId = payload.request.requestId || payload.request.name || fallbackId;
  payload.request.requestId = `${baseId}-chunk-${chunkIndex}`;
};

/**
 * Factory for chunked payload builders. Normalizes windows, iterates chunk windows,
 * applies time-series adjustments, and decorates request IDs with chunk suffixes.
 * The provided callbacks keep individual payload shapes specific to each requester.
 */
export const createChunkedPayloadBuilder = ({
  parseArgs,
  buildBasePayload,
  applyTimeSeriesUpdates,
  applyRequestIdSuffix,
}) => (...args) => {
  const parsedArgs = typeof parseArgs === 'function' ? parseArgs(args) : {};
  const {
    windowDays,
    windowHours,
    chunkSize = 30,
    chunkHours,
    windowUnit,
    ...context
  } = parsedArgs || {};
  const resolvedWindowUnit = windowUnit || (Number.isFinite(Number(windowHours)) ? 'hours' : 'days');
  const normalizedWindow = Number(resolvedWindowUnit === 'hours' ? windowHours : windowDays);
  const normalizedChunkSize = Number(resolvedWindowUnit === 'hours' ? (chunkHours ?? chunkSize) : chunkSize);

  if (!normalizedWindow || normalizedChunkSize <= 0) {
    return [];
  }

  const payloads = [];
  let chunkRemaining = normalizedWindow;
  let chunkIndex = 1;

  while (chunkRemaining > 0) {
    const startOffset = normalizedWindow - chunkRemaining;
    const chunkValue = Math.min(normalizedChunkSize, chunkRemaining);
    chunkRemaining -= chunkValue;

    const chunkContext = {
      ...context,
      windowUnit: resolvedWindowUnit,
      windowSize: normalizedWindow,
      chunkSize: chunkValue,
      startOffset,
      chunkIndex,
      windowDays: resolvedWindowUnit === 'days' ? normalizedWindow : undefined,
      windowHours: resolvedWindowUnit === 'hours' ? normalizedWindow : undefined,
      chunkDays: resolvedWindowUnit === 'days' ? chunkValue : undefined,
      chunkHours: resolvedWindowUnit === 'hours' ? chunkValue : undefined,
      startOffsetDays: resolvedWindowUnit === 'days' ? startOffset : undefined,
      startOffsetHours: resolvedWindowUnit === 'hours' ? startOffset : undefined,
    };

    const payload = typeof buildBasePayload === 'function'
      ? buildBasePayload(chunkContext)
      : null;

    if (!payload) {
      continue;
    }

    applyTimeSeriesUpdates?.(payload, chunkContext);

    applyRequestIdSuffix?.(payload, chunkContext);

    payloads.push(payload);

    chunkIndex += 1;
  }

  return payloads;
};

export const logAggregationSplit = (contextLabel, windowDays, payloadCount, appIds, windowUnit = 'day') => {
  const label = contextLabel || 'Aggregation';
  const normalizedWindow = Number(windowDays);
  const normalizedPayloadCount = Number(payloadCount);
  const normalizedAppIds = Array.isArray(appIds) ? appIds : [appIds];

  if (!Number.isFinite(normalizedPayloadCount) || normalizedPayloadCount <= 1) {
    return;
  }

  const windowLabel = Number.isFinite(normalizedWindow) && normalizedWindow > 0
    ? `${normalizedWindow}-${windowUnit}`
    : 'unknown-window';

  const appIdLabel = normalizedAppIds
    .map((candidate) => (candidate === undefined || candidate === null ? '' : String(candidate).trim()))
    .filter(Boolean)
    .join(',');

  const logger = appIdLabel ? createLogger(`Request-${appIdLabel}`) : requestLogger;

  logger.info(
    `${label} request split into ${normalizedPayloadCount} window(s) at ${windowLabel} scope.`,
  );
};

export const buildMetaEventsPayload = (appId, windowDays = 7) => {
  const payload = {
    response: { location: 'request', mimeType: 'application/json' },
    request: {
      requestId: `meta-events-${appId}-${windowDays}d`,
      name: 'account-visitor-only',
      pipeline: [
        {
          source: {
            singleEvents: { appId },
            timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
          },
        },
        { filter: 'contains(type,`meta`)' },
        { unmarshal: { metadata: 'title' } },
        {
          select: {
            visitor: 'metadata.visitor',
            account: 'metadata.account',
            visitorId: 'visitorId',
            accountId: 'accountId',
            appId: 'appId',
          },
        },
      ],
    },
  };

  requestLogger.debug('Built meta-events payload', { appId, windowDays });

  return payload;
};

const buildChunkedMetaEventsPayloadsBase = createChunkedPayloadBuilder({
  parseArgs: ([appId, windowDays, chunkSize = 30]) => ({ appId, windowDays, chunkSize }),
  buildBasePayload: ({ appId, chunkDays }) => (appId ? buildMetaEventsPayload(appId, chunkDays) : null),
  applyTimeSeriesUpdates: (payload, { chunkDays, startOffset }) => {
    applyPrimaryTimeSeriesWindow(payload, buildWindowTimeSeries(startOffset, chunkDays));
  },
  applyRequestIdSuffix: (payload, { appId, chunkDays, chunkIndex }) => {
    if (!payload?.request) {
      return;
    }

    const chunkLabel = Number.isFinite(chunkDays) ? `${chunkDays}d` : 'chunk';
    const baseRequestId = appId ? `meta-events-${appId}-${chunkLabel}` : `meta-events-${chunkLabel}`;

    payload.request.requestId = `${baseRequestId}-chunk-${chunkIndex}`;
  },
});

export const buildChunkedMetaEventsPayloads = (appId, windowDays, chunkSize = 30) => {
  const payloads = buildChunkedMetaEventsPayloadsBase(appId, windowDays, chunkSize);

  requestLogger.debug('Built chunked meta-events payloads', {
    appId,
    windowDays,
    chunkSize,
    payloadCount: payloads?.length || 0,
  });

  return payloads;
};

// Configure the hourly chunked meta-events payload builder.
const buildChunkedMetaEventsPayloadsByHourBase = createChunkedPayloadBuilder({
  parseArgs: ([appId, windowHours, chunkSize = 6]) => ({
    appId,
    windowHours,
    chunkSize,
    windowUnit: 'hours',
  }),
  buildBasePayload: ({ appId, chunkHours }) => (appId ? buildMetaEventsPayload(appId, chunkHours) : null),
  applyTimeSeriesUpdates: (payload, { chunkHours, startOffsetHours }) => {
    applyPrimaryTimeSeriesWindow(payload, buildHourWindowTimeSeries(startOffsetHours, chunkHours));
  },
  applyRequestIdSuffix: (payload, { appId, chunkHours, chunkIndex }) => {
    if (!payload?.request) {
      return;
    }

    const chunkLabel = Number.isFinite(chunkHours) ? `${chunkHours}h` : 'chunk';
    const baseRequestId = appId ? `meta-events-${appId}-${chunkLabel}` : `meta-events-${chunkLabel}`;

    payload.request.requestId = `${baseRequestId}-chunk-${chunkIndex}`;
  },
});

// Build hourly chunked payloads for meta-events.
export const buildChunkedMetaEventsPayloadsByHour = (appId, windowHours, chunkSize = 6) => {
  const payloads = buildChunkedMetaEventsPayloadsByHourBase(appId, windowHours, chunkSize);

  logAggregationSplit('Meta-events', windowHours, payloads?.length || 0, appId, 'hour');
  requestLogger.debug('Built hourly chunked meta-events payloads', {
    appId,
    windowHours,
    chunkSize,
    payloadCount: payloads?.length || 0,
  });

  return payloads;
};

export const buildAppListingPayload = (windowDays = 7, requestId = 'app-discovery') => ({
  response: { location: 'request', mimeType: 'application/json' },
  request: {
    requestId,
    pipeline: [
      {
        source: {
          singleEvents: { appId: 'expandAppIds("*")' },
          timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
        },
      },
      { group: { group: ['appId'] } },
      { select: { appId: 'appId' } },
    ],
  },
});

export const buildChunkedAppListingPayloads = createChunkedPayloadBuilder({
  parseArgs: ([windowDays, chunkSize = 30, requestIdPrefix = 'app-discovery']) => ({
    windowDays,
    chunkSize,
    requestIdPrefix,
  }),
  buildBasePayload: ({ chunkDays }) => buildAppListingPayload(chunkDays),
  applyTimeSeriesUpdates: (payload, { chunkDays, startOffset }) => {
    applyPrimaryTimeSeriesWindow(payload, buildWindowTimeSeries(startOffset, chunkDays));
  },
  applyRequestIdSuffix: (payload, { requestIdPrefix, chunkIndex }) => {
    if (payload?.request) {
      payload.request.requestId = `${requestIdPrefix}-chunk-${chunkIndex}`;
    }
  },
});

export const buildMetadataFieldsForAppPayload = (appId, windowDays) => ({
  response: { mimeType: 'application/json' },
  request: {
    requestId: `metadata-fields-for-app-${appId}`,
    name: 'metadata-fields-for-app',
    pipeline: [
      {
        spawn: [
          [
            {
              source: {
                singleEvents: { appId },
                timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
              },
            },
            { filter: 'contains(type,`meta`)' },
            { unmarshal: { metadata: 'title' } },
            { filter: '!isNil(metadata.visitor)' },
            { eval: { visitorMetadata: 'keys(metadata.visitor)' } },
            { unwind: { field: 'visitorMetadata' } },
            { group: { group: ['appId', 'visitorMetadata'] } },
            { group: { group: ['appId'], fields: { visitorMetadata: { list: 'visitorMetadata' } } } },
          ],
          [
            {
              source: {
                singleEvents: { appId },
                timeSeries: { first: 'now()', count: -Number(windowDays), period: 'dayRange' },
              },
            },
            { filter: 'contains(type,`meta`)' },
            { unmarshal: { metadata: 'title' } },
            { filter: '!isNil(metadata.account)' },
            { eval: { accountMetadata: 'keys(metadata.account)' } },
            { unwind: { field: 'accountMetadata' } },
            { group: { group: ['appId', 'accountMetadata'] } },
            { group: { group: ['appId'], fields: { accountMetadata: { list: 'accountMetadata' } } } },
          ],
        ],
      },
      { join: { fields: ['appId'] } },
    ],
  },
});

export const buildChunkedMetadataFieldPayloads = createChunkedPayloadBuilder({
  parseArgs: ([appId, windowDays, chunkSize = 30]) => ({ appId, windowDays, chunkSize }),
  buildBasePayload: ({ appId, windowDays }) => (appId ? buildMetadataFieldsForAppPayload(appId, windowDays) : null),
  applyTimeSeriesUpdates: (payload, { chunkDays, startOffset }) => {
    applySpawnTimeSeriesWindow(payload, buildWindowTimeSeries(startOffset, chunkDays));
  },
  applyRequestIdSuffix: (payload, { chunkIndex }) => {
    appendChunkSuffix(payload, chunkIndex, 'metadata-fields');
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
