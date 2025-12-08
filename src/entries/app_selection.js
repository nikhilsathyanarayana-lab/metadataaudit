import { bootstrapShared } from './shared.js';
import { initAppSelection } from '../pages/appSelection.js';
import { renderNavigation } from '../pages/navigation.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';
import { initApiCallDebugPanel } from '../ui/apiCallDebugPanel.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  clearPendingCallQueue();
  initApiCallDebugPanel();
  await bootstrapShared();
  await initAppSelection();
});
