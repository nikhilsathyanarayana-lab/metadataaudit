import { bootstrapShared } from './shared.js';
import { initAppSelection } from '../pages/appSelection.js';
import { renderNavigation } from '../pages/navigation.js';
import { clearPendingCallQueue } from '../pages/deepDive/aggregation.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  clearPendingCallQueue();
  await bootstrapShared();
  await initAppSelection();
});
