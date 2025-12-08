// Data utilities for preparing deep dive metadata inputs and cached results.
import {
  appSelectionGlobalKey,
  deepDiveGlobalKey,
  metadataFieldGlobalKey,
  LOOKBACK_OPTIONS,
  TARGET_LOOKBACK,
  logDeepDive,
} from './constants.js';
import { extractAppIds } from '../../services/appUtils.js';
import { applyManualAppNames, getManualAppName, loadManualAppNames } from '../../services/appNames.js';
import {
  extractAppNamesFromResponse,
  loadStoredAppSelections,
} from '../shared/appSelectionStore.js';

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

const normalizeCollectionRecords = (candidate, key, source) => {
  if (Array.isArray(candidate)) {
    return candidate;
  }

  if (candidate && typeof candidate === 'object') {
    if (Array.isArray(candidate.records)) {
      return candidate.records;
    }

    logDeepDive('warn', `Unexpected ${source} structure for ${key}; expected records array.`, {
      key,
      source,
      shape: Object.keys(candidate),
    });

    return null;
  }

  if (candidate !== undefined && candidate !== null) {
    logDeepDive('warn', `Ignored non-object ${source} data for ${key}.`, {
      key,
      source,
      type: typeof candidate,
    });
  }

  return null;
};

const readSessionCollection = (key) => {
  if (typeof sessionStorage === 'undefined') {
    logDeepDive('debug', 'Session storage unavailable for deep dive collections.', { key });
    return { found: false };
  }

  try {
    const raw = sessionStorage.getItem(key);

    if (!raw) {
      logDeepDive('debug', 'No session storage entry for deep dive collection.', { key });
      return { found: false };
    }

    logDeepDive('debug', 'Found session storage entry for deep dive collection.', {
      key,
      byteLength: raw.length,
    });

    const parsed = JSON.parse(raw);
    return { found: true, value: parsed };
  } catch (error) {
    logDeepDive('error', `Unable to parse session storage collection for ${key}.`, { key, error });
    return { found: true, value: null };
  }
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

const extractMetadataFieldsForApp = (metadataFields, appId, lookback = TARGET_LOOKBACK) => {
  const fields = metadataFields?.[appId];
  const targetLookback = LOOKBACK_OPTIONS.includes(lookback) ? lookback : TARGET_LOOKBACK;

  if (!fields || fields.windowDays !== targetLookback) {
    return { visitorFields: [], accountFields: [] };
  }

  return {
    visitorFields: dedupeAndSortFields(fields.visitorFields),
    accountFields: dedupeAndSortFields(fields.accountFields),
  };
};

const normalizeAppSelections = (selections) =>
  (Array.isArray(selections) ? selections : [])
    .filter((entry) => entry?.subId && (entry?.response || entry?.metadataFields))
    .map((entry) => ({
      subId: entry.subId,
      response: entry.response,
      domain: entry.domain,
      integrationKey: entry.integrationKey,
      metadataFields: normalizeSelectionMetadata(entry.metadataFields),
      selectionState: entry.selectionState,
    }));

const normalizeLaunchSelections = (launchEntries) =>
  (Array.isArray(launchEntries) ? launchEntries : [])
    .filter((entry) => entry?.subId && entry?.domain && entry?.integrationKey)
    .map((entry) => ({
      subId: entry.subId,
      domain: entry.domain,
      integrationKey: entry.integrationKey,
      metadataFields: normalizeSelectionMetadata(entry.metadataFields),
      selected: true,
    }));

const isSelectedEntry = (entry) => {
  const selectedValue = entry?.selected ?? entry;

  if (selectedValue === undefined || selectedValue === null) {
    return true;
  }

  return selectedValue === true || selectedValue === 1 || selectedValue === '1';
};

export const getGlobalCollection = (key) => {
  if (!key) {
    return [];
  }

  const sessionCandidate = readSessionCollection(key);
  if (sessionCandidate.found) {
    const normalizedSessionRecords = normalizeCollectionRecords(
      sessionCandidate.value,
      key,
      'sessionStorage',
    );

    if (Array.isArray(normalizedSessionRecords)) {
      return normalizedSessionRecords;
    }

    logDeepDive('warn', 'Falling back to window collection after malformed session cache.', { key });
  }

  const fromNamespace = window?.deepDiveData?.[key];
  const direct = window?.[key];
  const candidate = normalizeCollectionRecords(fromNamespace ?? direct, key, 'window');

  if (Array.isArray(candidate)) {
    return candidate;
  }

  logDeepDive('warn', 'No deep dive collection available from session storage or window scope.', { key });

  return [];
};

export const loadAppSelections = (lookback = TARGET_LOOKBACK) => {
  const manualAppNames = loadManualAppNames();
  const storedSelections = loadStoredAppSelections({
    storageKey: appSelectionGlobalKey,
    onError: (message, error) => logDeepDive('error', message, { error }),
  });

  let selectionSource = 'appSelectionResponses';
  let selections = normalizeAppSelections(storedSelections);

  if (!selections.length) {
    const cachedSelections = getGlobalCollection(appSelectionGlobalKey);

    if (cachedSelections.length) {
      selections = normalizeAppSelections(cachedSelections);
      selectionSource = 'deepDiveData';
    }
  }

  const entriesFromSelections = selections.flatMap((entry) => {
    const metadataKeys = entry.metadataFields ? Object.keys(entry.metadataFields) : [];
    const appIds = extractAppIds(entry.response);
    const fallbackAppIds = appIds.length ? appIds : metadataKeys;

    if (!fallbackAppIds.length) {
      return [];
    }

    const appNames = extractAppNamesFromResponse(entry.response);

    return fallbackAppIds.map((appId) => ({
      subId: entry.subId,
      appId,
      domain: entry.domain,
      integrationKey: entry.integrationKey,
      appName: appNames.get(appId),
      selected: isSelectedEntry(entry.selectionState?.[appId]),
      ...extractMetadataFieldsForApp(entry.metadataFields, appId, lookback),
    }));
  });

  let selectionEntries = entriesFromSelections;

  if (!entriesFromSelections.length) {
    const launchData = readSessionCollection('subidLaunchData');
    const normalizedLaunchData = normalizeLaunchSelections(launchData.value);

    if (normalizedLaunchData.length) {
      selectionEntries = normalizedLaunchData;
      selectionSource = 'subidLaunchData';
    } else if (!launchData.found) {
      selectionSource = 'none';
    } else {
      selectionSource = 'subidLaunchData';
    }
  }

  const selectionDiagnostics = selectionEntries.reduce(
    (acc, entry) => {
      const missing = [];

      if (!entry?.appId) {
        missing.push('appId');
      }

      if (!entry?.domain) {
        missing.push('domain');
      }

      if (!entry?.integrationKey) {
        missing.push('integrationKey');
      }

      if (missing.length) {
        acc.missingRequired += 1;

        if (acc.missingExamples.length < 3) {
          acc.missingExamples.push({
            appId: entry?.appId,
            subId: entry?.subId,
            missing,
          });
        }
      } else {
        acc.credentialReady += 1;
      }

      return acc;
    },
    { credentialReady: 0, missingRequired: 0, missingExamples: [] },
  );

  logDeepDive('debug', 'Loaded app selections for deep dive.', {
    source: selectionSource,
    count: selectionEntries.length,
    credentialReady: selectionDiagnostics.credentialReady,
    missingRequired: selectionDiagnostics.missingRequired,
    missingExamples: selectionDiagnostics.missingExamples,
  });

  return applyManualAppNames(selectionEntries, manualAppNames);
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
  const incomingRecords = getGlobalCollection(deepDiveGlobalKey)
    .filter((record) => record?.appId)
    .map((record) => ({
      ...record,
      visitorFields: Array.isArray(record.visitorFields) ? record.visitorFields : [],
      accountFields: Array.isArray(record.accountFields) ? record.accountFields : [],
    }));

  if (!incomingRecords.length) {
    return deepDiveRecords;
  }

  const mergedRecords = dedupeMetadataRecords(deepDiveRecords, incomingRecords);

  deepDiveRecords.splice(0, deepDiveRecords.length, ...mergedRecords);

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

export const syncDeepDiveRecordsAppName = (appId, appName, subId) => {
  if (!appId) {
    return;
  }

  deepDiveRecords.forEach((record, index) => {
    if (record.appId !== appId || (subId && record.subId !== subId)) {
      return;
    }

    deepDiveRecords[index] = {
      ...record,
      appName,
      updatedAt: new Date().toISOString(),
    };
  });
};

export const syncMetadataRecordsAppName = (appId, appName, metadataRecords, subId) => {
  if (!appId || !Array.isArray(metadataRecords)) {
    return metadataRecords;
  }

  return metadataRecords.map((record) => {
    if (record?.appId !== appId || (subId && record?.subId !== subId)) {
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
  const lookback = LOOKBACK_OPTIONS.includes(targetLookback) ? targetLookback : TARGET_LOOKBACK;
  const grouped = new Map();

  records.forEach((record) => {
    if (record.windowDays !== lookback) {
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

  const selections = loadAppSelections(lookback).filter(isSelectedEntry);

  return selections.map((entry) => ({
    appId: entry.appId,
    subId: entry.subId,
    visitorFields: [],
    accountFields: [],
    appName: entry.appName || '',
  }));
};

export const buildScanEntries = (records, manualAppNames, targetLookback = TARGET_LOOKBACK) => {
  const lookback = LOOKBACK_OPTIONS.includes(targetLookback) ? targetLookback : TARGET_LOOKBACK;
  const mapped = new Map();
  const selections = loadAppSelections(lookback).filter(isSelectedEntry);
  const selectionLookup = new Map(
    selections.map((selection) => [
      `${selection.subId || ''}::${selection.appId || ''}`,
      selection,
    ]),
  );
  const selectionsByAppId = new Map();
  const selectionsBySubId = new Map();

  selections.forEach((selection) => {
    if (selection?.appId && !selectionsByAppId.has(selection.appId)) {
      selectionsByAppId.set(selection.appId, selection);
    }

    if (selection?.subId && !selectionsBySubId.has(selection.subId)) {
      selectionsBySubId.set(selection.subId, selection);
    }
  });

  const lookbackRecords = (Array.isArray(records) ? records : []).filter(
    (record) => record?.windowDays === lookback,
  );
  const missingAppIdExamples = [];
  const missingCredentialExamples = [];
  const recordDiagnostics = [];

  lookbackRecords.forEach((record) => {
    if (!record?.appId) {
      logDeepDive('warn', 'Skipping deep dive record due to missing appId.', {
        subId: record?.subId,
        windowDays: record?.windowDays,
      });

      if (missingAppIdExamples.length < 3) {
        missingAppIdExamples.push({ subId: record?.subId, windowDays: record?.windowDays });
      }
      return;
    }

    const lookupKey = `${record.subId || ''}::${record.appId}`;
    let selectionSource = 'none';
    const selection =
      selectionLookup.get(lookupKey) ||
      selectionLookup.get(`::${record.appId}`) ||
      selectionsByAppId.get(record.appId) ||
      selectionsBySubId.get(record.subId || '');

    if (selectionLookup.get(lookupKey)) {
      selectionSource = 'subId+appId';
    } else if (selectionLookup.get(`::${record.appId}`)) {
      selectionSource = 'appIdExact';
    } else if (selectionsByAppId.get(record.appId)) {
      selectionSource = 'appIdLookup';
    } else if (selectionsBySubId.get(record.subId || '')) {
      selectionSource = 'subIdLookup';
    }

    const domain = selection?.domain || record.domain;
    const integrationKey = selection?.integrationKey || record.integrationKey;

    if (!domain || !integrationKey) {
      const missingFields = [];

      if (!domain) {
        missingFields.push('domain');
      }

      if (!integrationKey) {
        missingFields.push('integrationKey');
      }

      logDeepDive('warn', 'Skipping scan entry due to missing normalized credentials.', {
        appId: record.appId,
        subId: record.subId,
        hasSelection: Boolean(selection),
        selectionSource,
        domainPresent: Boolean(domain),
        integrationPresent: Boolean(integrationKey),
        missingFields,
      });

      if (missingCredentialExamples.length < 3) {
        missingCredentialExamples.push({
          appId: record?.appId,
          subId: record?.subId,
          missing: missingFields,
        });
      }
      return;
    }

    const appName =
      getManualAppName(manualAppNames, record.subId, record.appId) ||
      record.appName ||
      selection?.appName ||
      '';

    mapped.set(record.appId, {
      appId: record.appId,
      appName,
      subId: record.subId || selection?.subId || '',
      domain,
      integrationKey,
    });

    if (recordDiagnostics.length < 10) {
      recordDiagnostics.push({
        appId: record.appId,
        subId: record.subId,
        selectionSource,
        domainSource: selection?.domain ? 'selection' : record.domain ? 'record' : 'missing',
        integrationKeySource: selection?.integrationKey
          ? 'selection'
          : record.integrationKey
            ? 'record'
            : 'missing',
      });
    }
  });

  logDeepDive('debug', 'Deep dive scan entry build diagnostics', {
    lookback,
    recordCount: lookbackRecords.length,
    skippedMissingAppId: missingAppIdExamples.length,
    skippedMissingCredentials: missingCredentialExamples.length,
    builtFromRecords: mapped.size,
    missingAppIdExamples,
    missingCredentialExamples,
    recordDiagnostics,
  });

  if (!mapped.size && selections.length) {
    const validSelections = [];

    selections.forEach((selection) => {
      const missingFields = [];

      if (!selection?.appId) {
        missingFields.push('appId');
      }

      if (!selection?.domain) {
        missingFields.push('domain');
      }

      if (!selection?.integrationKey) {
        missingFields.push('integrationKey');
      }

      if (missingFields.length) {
        logDeepDive('warn', 'Skipping app selection due to missing required fields.', {
          selectionAppId: selection?.appId,
          selectionSubId: selection?.subId,
          missingFields,
        });
        return;
      }

      validSelections.push(selection);
    });

    validSelections.forEach((selection) => {
      const appName =
        getManualAppName(manualAppNames, selection.subId, selection.appId) ||
        selection.appName ||
        '';

      mapped.set(selection.appId, {
        appId: selection.appId,
        appName,
        subId: selection.subId || '',
        domain: selection.domain,
        integrationKey: selection.integrationKey,
      });
    });

    if (mapped.size) {
      logDeepDive('info', 'Built deep dive scan entries from app selections.', {
        plannedEntries: mapped.size,
        lookback,
      });
    }
  }

  logDeepDive('info', 'Final deep dive scan entry summary.', {
    lookback,
    plannedEntries: mapped.size,
    selectionCount: selections.length,
  });

  return Array.from(mapped.values());
};

export const getDeepDiveRecords = () => deepDiveRecords;
