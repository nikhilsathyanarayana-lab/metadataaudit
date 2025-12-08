import { bootstrapShared } from './shared.js';
import { renderNavigation } from '../pages/navigation.js';
import { initWorkbookUi } from '../pages/workbookUi.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';
import { initApiCallConsoleLogger } from '../ui/apiCallConsoleLogger.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'cookie' });
  clearPendingCallQueue();
  initApiCallConsoleLogger();
  await bootstrapShared();
  initWorkbookUi();
});
