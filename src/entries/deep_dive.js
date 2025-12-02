import { bootstrapShared } from './shared.js';
import { deepDiveGlobalKey, metadataFieldGlobalKey } from '../pages/deepDive/constants.js';
import {
  exportDeepDiveJson,
  exportDeepDivePdf,
  exportDeepDiveXlsx,
  initDeepDive,
  installDeepDiveGlobalErrorHandlers,
  reportDeepDiveError,
} from '../pages/deepDive.js';

const parseStoredRecords = (key) => {
  try {
    const raw = localStorage.getItem(key);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.records) ? parsed.records : parsed;
  } catch (error) {
    console.error(`Unable to read cached ${key}:`, error);
    return null;
  }
};

const hydrateDeepDiveDataFromStorage = () => {
  const deepDiveData = {};

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

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await bootstrapShared({
      enableJsonExport: true,
      pdfHandler: exportDeepDivePdf,
      additionalFormats: { json: exportDeepDiveJson, xlsx: exportDeepDiveXlsx },
    });
    await initDeepDive();
  } catch (error) {
    reportDeepDiveError('Unable to initialize the deep dive page.', error);
  }
});
