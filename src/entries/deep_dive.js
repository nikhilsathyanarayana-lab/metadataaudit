import { bootstrapShared } from './shared.js';
import {
  appSelectionGlobalKey,
  deepDiveGlobalKey,
  metadataFieldGlobalKey,
  logDeepDive,
} from '../pages/deepDive/constants.js';
import {
  exportDeepDiveJson,
  exportDeepDiveXlsx,
  initDeepDive,
  installDeepDiveGlobalErrorHandlers,
  reportDeepDiveError,
} from '../pages/deepDive.js';
import { renderNavigation } from '../pages/navigation.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';
import { initApiCallConsoleLogger } from '../ui/apiCallConsoleLogger.js';

const parseStoredRecords = (key) => {
  try {
    const raw = sessionStorage.getItem(key);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.records) ? parsed.records : parsed;
  } catch (error) {
    logDeepDive('error', `Unable to read cached ${key}:`, error);
    return null;
  }
};

const hydrateDeepDiveDataFromStorage = () => {
  const deepDiveData = {};

  const storedAppSelections = parseStoredRecords(appSelectionGlobalKey);
  if (storedAppSelections) {
    deepDiveData[appSelectionGlobalKey] = storedAppSelections;
  }

  const storedMetadataFields = parseStoredRecords(metadataFieldGlobalKey);
  if (storedMetadataFields) {
    deepDiveData[metadataFieldGlobalKey] = storedMetadataFields;
  }

  const storedDeepDiveEvents = parseStoredRecords(deepDiveGlobalKey);
  if (storedDeepDiveEvents) {
    deepDiveData[deepDiveGlobalKey] = storedDeepDiveEvents;
  }

  if (Object.keys(deepDiveData).length > 0) {
    window.deepDiveData = deepDiveData;
  }
};

hydrateDeepDiveDataFromStorage();
installDeepDiveGlobalErrorHandlers();

const registerApiResponseNotification = () => {
  if (typeof window === 'undefined') {
    return;
  }

  if (window.__deepDiveApiResponseNotificationInstalled) {
    return;
  }

  window.__deepDiveApiResponseNotificationInstalled = true;

  window.addEventListener('api-calls-updated', (event) => {
    const calls = event?.detail?.calls;
    const latestCall = Array.isArray(calls) && calls.length ? calls[calls.length - 1] : null;
    const targetLabel = latestCall?.appId ? `app ${latestCall.appId}` : 'an app';
    const statusLabel = latestCall?.status ? ` (${latestCall.status})` : '';

    console.info(`Deep dive API response received for ${targetLabel}${statusLabel}.`);
  });
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    renderNavigation('#nav-root', { activePage: 'integration' });
    clearPendingCallQueue();
    initApiCallConsoleLogger();
    registerApiResponseNotification();
    await bootstrapShared({
      enableJsonExport: true,
      additionalFormats: { json: exportDeepDiveJson, xlsx: exportDeepDiveXlsx },
    });
    await initDeepDive();
  } catch (error) {
    reportDeepDiveError('Unable to initialize the deep dive page.', error);
  }
});
