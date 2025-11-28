import { bootstrapShared } from './shared.js';
import { initDeepDiveNavigation } from '../pages/navigation.js';
import { initMetadataFields } from '../pages/metadataFields.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared();
  initDeepDiveNavigation();
  initMetadataFields();
});
