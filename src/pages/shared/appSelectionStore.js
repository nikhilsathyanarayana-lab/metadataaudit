import { createLogger } from '../../utils/logger.js';

const appSelectionStoreLogger = createLogger('AppSelectionStore');
const defaultStorageKey = 'appSelectionResponses';

const normalizeAppSelectionEntries = (entries) =>
  (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry?.subId && entry?.domain && entry?.integrationKey,
  );

export const extractAppNamesFromResponse = (apiResponse) => {
  if (!apiResponse) {
    return new Map();
  }

  const candidateLists = [apiResponse?.results, apiResponse?.data, apiResponse?.apps];

  if (Array.isArray(apiResponse)) {
    candidateLists.push(apiResponse);
  }

  const flattened = candidateLists.filter(Array.isArray).flat();
  const appNameMap = new Map();

  flattened.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || !entry.appId) {
      return;
    }

    const candidateName = entry.appName || entry.name || entry.label || entry.title;
    if (candidateName) {
      appNameMap.set(entry.appId, candidateName);
    }
  });

  return appNameMap;
};

export const loadStoredAppSelections = ({ storageKey = defaultStorageKey, onError } = {}) => {
  try {
    const raw = sessionStorage.getItem(storageKey);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return normalizeAppSelectionEntries(parsed);
  } catch (error) {
    const message = 'Unable to parse stored app selection data.';

    if (typeof onError === 'function') {
      onError(message, error);
    } else {
      appSelectionStoreLogger.error(message, error);
    }

    return [];
  }
};
