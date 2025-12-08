import { bootstrapShared } from './shared.js';
import { renderNavigation } from '../pages/navigation.js';
import { initWorkbookUi } from '../pages/workbookUi.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';
import { initApiCallDebugPanel } from '../ui/apiCallDebugPanel.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'cookie' });
  clearPendingCallQueue();
  initApiCallDebugPanel();
  await bootstrapShared();
  initWorkbookUi();
});
