import { initSubIdForm } from '../controllers/subidForm.js';
import { renderNavigation } from '../pages/navigation.js';
import { bootstrapShared } from './shared.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';
import { initApiCallConsoleLogger } from '../ui/apiCallConsoleLogger.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  clearPendingCallQueue();
  initApiCallConsoleLogger();
  await bootstrapShared();
  initSubIdForm();
});
