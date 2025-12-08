import { initSubIdForm } from '../controllers/subidForm.js';
import { renderNavigation } from '../pages/navigation.js';
import { bootstrapShared } from './shared.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'integration' });
  await bootstrapShared();
  initSubIdForm();
});
