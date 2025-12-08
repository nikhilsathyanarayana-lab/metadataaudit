import { bootstrapShared } from './shared.js';
import { renderNavigation } from '../pages/navigation.js';
import { initWorkbookUi } from '../pages/workbookUi.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'cookie' });
  await bootstrapShared();
  initWorkbookUi();
});
