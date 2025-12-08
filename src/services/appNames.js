import { createLogger } from '../utils/logger.js';

const MANUAL_APP_NAME_STORAGE_KEY = 'manualAppNames';
let manualAppNameCache = null;

const appNamesLogger = createLogger('AppNames');

const buildManualAppNameKey = (subId, appId) => {
  const normalizedAppId = appId === undefined || appId === null ? '' : String(appId);
  const normalizedSubId = subId === undefined || subId === null ? '' : String(subId);

  if (!normalizedAppId) {
    return '';
  }

  return normalizedSubId ? `${normalizedSubId}::${normalizedAppId}` : normalizedAppId;
};

export const getManualAppName = (appNames = manualAppNameCache, subId, appId) => {
  if (!(appNames instanceof Map)) {
    return '';
  }

  const key = buildManualAppNameKey(subId, appId);
  return appNames.get(key) || (subId ? appNames.get(buildManualAppNameKey('', appId)) : '');
};

// Retrieves stored manual app name overrides from sessionStorage, caching results for reuse.
export const loadManualAppNames = (storageKey = MANUAL_APP_NAME_STORAGE_KEY) => {
  if (manualAppNameCache instanceof Map) {
    return manualAppNameCache;
  }

  manualAppNameCache = new Map();

  try {
    const raw = sessionStorage.getItem(storageKey);

    if (!raw) {
      return manualAppNameCache;
    }

    const parsed = JSON.parse(raw);
    const entries = parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
    manualAppNameCache = new Map(entries);
  } catch (error) {
    appNamesLogger.warn('Unable to access manual app names from storage:', error);
  }

  return manualAppNameCache;
};

// Writes manual app name overrides to sessionStorage and updates the in-memory cache.
export const persistManualAppNames = (appNameMap, storageKey = MANUAL_APP_NAME_STORAGE_KEY) => {
  if (!(appNameMap instanceof Map)) {
    return;
  }

  const serialized = Object.fromEntries(appNameMap.entries());

  try {
    sessionStorage.setItem(storageKey, JSON.stringify(serialized));
  } catch (error) {
    appNamesLogger.warn('Unable to persist manual app names to storage:', error);
  }

  manualAppNameCache = appNameMap;
};

// Adds or updates a single manual app name override and persists it.
export const setManualAppName = (
  appNames,
  appId,
  appName,
  subId,
  storageKey = MANUAL_APP_NAME_STORAGE_KEY,
) => {
  const key = buildManualAppNameKey(subId, appId);

  if (!key || !appName) {
    return appNames instanceof Map ? appNames : loadManualAppNames(storageKey);
  }

  const map = appNames instanceof Map ? appNames : loadManualAppNames(storageKey);
  map.set(key, appName);
  persistManualAppNames(map, storageKey);
  return map;
};

// Applies manual app name overrides to a result set, filling gaps left by API data.
export const applyManualAppNames = (rows, manualAppNames = loadManualAppNames()) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  const appNames = manualAppNames instanceof Map ? manualAppNames : loadManualAppNames();

  return rows.map((row) => ({
    ...row,
    appName: getManualAppName(appNames, row?.subId, row?.appId) || row?.appName || '',
  }));
};

export const manualAppNameStorageKey = MANUAL_APP_NAME_STORAGE_KEY;
export const buildManualAppNameKeyForTesting = buildManualAppNameKey;
