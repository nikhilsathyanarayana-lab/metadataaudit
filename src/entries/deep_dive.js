import { bootstrapShared } from './shared.js';
import { exportDeepDiveJson, initDeepDive } from '../pages/deepDive.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared({
    enableJsonExport: true,
    additionalFormats: { json: exportDeepDiveJson },
  });
  initDeepDive();
});
