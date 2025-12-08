import { initSubIdForm } from '../controllers/subidForm.js';
import { renderNavigation } from '../pages/navigation.js';
import { bootstrapShared } from './shared.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';
import { initApiCallDebugPanel } from '../ui/apiCallDebugPanel.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  clearPendingCallQueue();
  initApiCallDebugPanel();
  await bootstrapShared();
  initSubIdForm();
});
