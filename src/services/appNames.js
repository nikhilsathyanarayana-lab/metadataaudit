const MANUAL_APP_NAME_STORAGE_KEY = 'manualAppNames';
let manualAppNameCache = null;

export const loadManualAppNames = (storageKey = MANUAL_APP_NAME_STORAGE_KEY) => {
  if (manualAppNameCache instanceof Map) {
    return manualAppNameCache;
  }

  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    const entries = parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
    manualAppNameCache = new Map(entries);
  } catch (error) {
    console.error('Unable to parse manual app names:', error);
    manualAppNameCache = new Map();
  }

  return manualAppNameCache;
};

export const persistManualAppNames = (appNameMap, storageKey = MANUAL_APP_NAME_STORAGE_KEY) => {
  if (!(appNameMap instanceof Map)) {
    return;
  }

  const serialized = Object.fromEntries(appNameMap.entries());
  localStorage.setItem(storageKey, JSON.stringify(serialized));
  manualAppNameCache = appNameMap;
};

export const setManualAppName = (
  appNames,
  appId,
  appName,
  storageKey = MANUAL_APP_NAME_STORAGE_KEY,
) => {
  if (!appId || !appName) {
    return appNames instanceof Map ? appNames : loadManualAppNames(storageKey);
  }

  const map = appNames instanceof Map ? appNames : loadManualAppNames(storageKey);
  map.set(appId, appName);
  persistManualAppNames(map, storageKey);
  return map;
};

export const applyManualAppNames = (rows, manualAppNames = loadManualAppNames()) => {
  if (!Array.isArray(rows)) {
    return [];
  }

  const appNames = manualAppNames instanceof Map ? manualAppNames : loadManualAppNames();

  return rows.map((row) => ({
    ...row,
    appName: appNames.get(row?.appId) || row?.appName || '',
  }));
};

export const manualAppNameStorageKey = MANUAL_APP_NAME_STORAGE_KEY;
