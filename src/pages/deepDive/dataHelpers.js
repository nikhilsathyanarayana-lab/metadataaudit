// Data utilities for preparing deep dive metadata inputs and cached results.
import {
  appSelectionGlobalKey,
  deepDiveGlobalKey,
  metadataFieldGlobalKey,
  TARGET_LOOKBACK,
} from './constants.js';
import { extractAppIds } from '../../services/appUtils.js';

export { extractAppIds };

export const dedupeAndSortFields = (fields) => {
  if (fields instanceof Set) {
    return Array.from(fields).sort();
  }

  if (Array.isArray(fields)) {
    return Array.from(new Set(fields)).sort();
  }

  return [];
};

export const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

export const scheduleDomUpdate = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => callback());
    return;
  }

  setTimeout(() => callback(), 0);
};

const normalizeSelectionMetadata = (metadataFields) => {
  if (!metadataFields || typeof metadataFields !== 'object') {
    return {};
  }

  return Object.entries(metadataFields).reduce((acc, [appId, fields]) => {
    if (!appId || !fields || typeof fields !== 'object') {
      return acc;
    }

    acc[appId] = {
      windowDays: Number.isFinite(fields.windowDays) ? fields.windowDays : undefined,
      visitorFields: Array.isArray(fields.visitorFields) ? fields.visitorFields : [],
      accountFields: Array.isArray(fields.accountFields) ? fields.accountFields : [],
      updatedAt: typeof fields.updatedAt === 'string' ? fields.updatedAt : undefined,
    };

    return acc;
  }, {});
};

const extractMetadataFieldsForApp = (metadataFields, appId) => {
  const fields = metadataFields?.[appId];

  if (!fields || fields.windowDays !== TARGET_LOOKBACK) {
    return { visitorFields: [], accountFields: [] };
  }

  return {
    visitorFields: dedupeAndSortFields(fields.visitorFields),
    accountFields: dedupeAndSortFields(fields.accountFields),
  };
};

const normalizeAppSelections = (selections) =>
  (Array.isArray(selections) ? selections : [])
    .filter((entry) => entry?.subId && entry?.response)
    .map((entry) => ({
      subId: entry.subId,
      response: entry.response,
      domain: entry.domain || '',
      integrationKey: entry.integrationKey || '',
      metadataFields: normalizeSelectionMetadata(entry.metadataFields),
    }));

export const getGlobalCollection = (key) => {
  if (!key) {
    return [];
  }

  const fromNamespace = window?.deepDiveData?.[key];
  const direct = window?.[key];
  const candidate = fromNamespace ?? direct;

  if (Array.isArray(candidate)) {
    return candidate;
  }

  if (candidate && typeof candidate === 'object' && Array.isArray(candidate.records)) {
    return candidate.records;
  }

  return [];
};

export const loadAppSelections = () => {
  const selections = normalizeAppSelections(getGlobalCollection(appSelectionGlobalKey));

  return selections.flatMap((entry) => {
    const appIds = extractAppIds(entry.response);

    if (!appIds.length) {
      return [];
    }

    return appIds.map((appId) => ({
      subId: entry.subId,
      appId,
      domain: entry.domain,
      integrationKey: entry.integrationKey,
      ...extractMetadataFieldsForApp(entry.metadataFields, appId),
    }));
  });
};

export const normalizeMetadataRecords = (records) =>
  (Array.isArray(records) ? records : []).filter(
    (record) => record?.appId && Number.isFinite(record?.windowDays),
  );

export const dedupeMetadataRecords = (...recordSets) => {
  const deduped = new Map();

  recordSets
    .flat()
    .filter(Boolean)
    .forEach((record) => {
      const key = `${record.appId}::${record.windowDays}`;
      deduped.set(key, record);
    });

  return Array.from(deduped.values());
};

export const loadMetadataRecords = () =>
  dedupeMetadataRecords(normalizeMetadataRecords(getGlobalCollection(metadataFieldGlobalKey)));

const deepDiveRecords = [];

export const loadDeepDiveRecords = () => {
  deepDiveRecords.splice(
    0,
    deepDiveRecords.length,
    ...getGlobalCollection(deepDiveGlobalKey)
      .filter((record) => record?.appId)
      .map((record) => ({
        ...record,
        visitorFields: Array.isArray(record.visitorFields) ? record.visitorFields : [],
        accountFields: Array.isArray(record.accountFields) ? record.accountFields : [],
      })),
  );

  return deepDiveRecords;
};

export const upsertDeepDiveRecord = (
  entry,
  normalizedFields,
  errorMessage = '',
  lookback = TARGET_LOOKBACK,
) => {
  if (!entry?.appId) {
    return;
  }

  const visitorFields = dedupeAndSortFields(normalizedFields?.visitorFields);
  const accountFields = dedupeAndSortFields(normalizedFields?.accountFields);
  const datasetCount = Number.isFinite(normalizedFields?.datasetCount)
    ? normalizedFields.datasetCount
    : 0;
  const status = errorMessage ? 'error' : 'success';

  const record = {
    windowDays: lookback,
    updatedAt: new Date().toISOString(),
    status,
    appId: entry.appId,
    appName: entry.appName || '',
    subId: entry.subId || '',
    domain: entry.domain || '',
    integrationKey: entry.integrationKey || '',
    visitorFields,
    accountFields,
    datasetCount,
    error: errorMessage,
  };

  const nextRecords = deepDiveRecords.filter(
    (existing) => existing.appId !== record.appId || existing.windowDays !== record.windowDays,
  );

  nextRecords.push(record);

  deepDiveRecords.splice(0, deepDiveRecords.length, ...nextRecords);
};

export const syncDeepDiveRecordsAppName = (appId, appName) => {
  if (!appId) {
    return;
  }

  deepDiveRecords.forEach((record, index) => {
    if (record.appId !== appId) {
      return;
    }

    deepDiveRecords[index] = {
      ...record,
      appName,
      updatedAt: new Date().toISOString(),
    };
  });
};

export const syncMetadataRecordsAppName = (appId, appName, metadataRecords) => {
  if (!appId || !Array.isArray(metadataRecords)) {
    return metadataRecords;
  }

  return metadataRecords.map((record) => {
    if (record?.appId !== appId) {
      return record;
    }

    return {
      ...record,
      appName,
      updatedAt: new Date().toISOString(),
    };
  });
};

export const groupMetadataByApp = (records, targetLookback = TARGET_LOOKBACK) => {
  const grouped = new Map();

  records.forEach((record) => {
    if (record.windowDays !== targetLookback) {
      return;
    }

    const appId = record.appId;
    const existing = grouped.get(appId) || {
      appId,
      appName: record.appName || '',
      subId: record.subId || '',
      visitorFields: [],
      accountFields: [],
    };

    existing.appName = existing.appName || record.appName || '';
    existing.subId = existing.subId || record.subId || '';

    if (Array.isArray(record.visitorFields)) {
      existing.visitorFields = record.visitorFields;
    }

    if (Array.isArray(record.accountFields)) {
      existing.accountFields = record.accountFields;
    }

    grouped.set(appId, existing);
  });

  return Array.from(grouped.values());
};

export const buildRowsForLookback = (metadataRecords, lookback) => {
  const groupedRecords = groupMetadataByApp(metadataRecords, lookback);

  if (groupedRecords.length) {
    return groupedRecords;
  }

  const selections = loadAppSelections();
  return selections.map((entry) => ({
    appId: entry.appId,
    subId: entry.subId,
    visitorFields: [],
    accountFields: [],
    appName: entry.appName || '',
  }));
};

export const buildScanEntries = (records, manualAppNames, targetLookback = TARGET_LOOKBACK) => {
  const mapped = new Map();

  records
    .filter((record) => record.windowDays === targetLookback)
    .forEach((record) => {
      if (!record?.appId || !record?.domain || !record?.integrationKey) {
        return;
      }

      const appName = manualAppNames?.get(record.appId) || record.appName || '';

      mapped.set(record.appId, {
        appId: record.appId,
        appName,
        subId: record.subId || '',
        domain: record.domain,
        integrationKey: record.integrationKey,
      });
    });

  return Array.from(mapped.values());
};

export const getDeepDiveRecords = () => deepDiveRecords;
