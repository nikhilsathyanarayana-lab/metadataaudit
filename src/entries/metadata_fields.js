import { bootstrapShared } from './shared.js';
import { initMetadataFields } from '../pages/metadataFields.js';
import { renderNavigation } from '../pages/navigation.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  clearPendingCallQueue();
  await bootstrapShared();
  initMetadataFields();
});
