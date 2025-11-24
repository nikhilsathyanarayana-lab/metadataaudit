import { bootstrapShared } from './shared.js';
import { initWorkbookUi } from '../pages/workbookUi.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared();
  initWorkbookUi();
});
