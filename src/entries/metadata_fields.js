import { bootstrapShared } from './shared.js';
import { initMetadataFields } from '../pages/metadataFields.js';
import { renderNavigation } from '../pages/navigation.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  await bootstrapShared();
  initMetadataFields();
});
