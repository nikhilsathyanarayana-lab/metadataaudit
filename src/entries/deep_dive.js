import { bootstrapShared } from './shared.js';
import {
  exportDeepDiveJson,
  exportDeepDiveXlsx,
  initDeepDive,
  installDeepDiveGlobalErrorHandlers,
  reportDeepDiveError,
} from '../pages/deepDive.js';

installDeepDiveGlobalErrorHandlers();

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await bootstrapShared({
      enableJsonExport: true,
      additionalFormats: { json: exportDeepDiveJson, xlsx: exportDeepDiveXlsx },
    });
    await initDeepDive();
  } catch (error) {
    reportDeepDiveError('Unable to initialize the deep dive page.', error);
  }
});
