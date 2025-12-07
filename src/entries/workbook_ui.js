import { bootstrapShared } from './shared.js';
import { initNavigation } from '../pages/navigation.js';
import { initWorkbookUi } from '../pages/workbookUi.js';

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  await bootstrapShared();
  initWorkbookUi();
});
