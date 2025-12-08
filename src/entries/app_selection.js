import { bootstrapShared } from './shared.js';
import { initAppSelection } from '../pages/appSelection.js';
import { renderNavigation } from '../pages/navigation.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  await bootstrapShared();
  await initAppSelection();
});
