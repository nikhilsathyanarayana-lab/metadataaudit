import { bootstrapShared } from './shared.js';
import { initMetadataFields } from '../pages/metadataFields.js';
import { initNavigation } from '../pages/navigation.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared();
  initNavigation();
  initMetadataFields();
});
