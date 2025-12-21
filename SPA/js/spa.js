import { initSubIdForm } from '../../src/controllers/subidForm.js';
import { renderNavigation } from '../../src/pages/navigation.js';
import { bootstrapShared } from '../../src/entries/shared.js';
import { clearPendingCallQueue } from '../../src/pages/deepDive/aggregation.js';
import { initApiCallConsoleLogger } from '../../src/ui/apiCallConsoleLogger.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'spa' });
  clearPendingCallQueue();
  initApiCallConsoleLogger();
  await bootstrapShared();
  initSubIdForm();
});
