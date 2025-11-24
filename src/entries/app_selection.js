import { bootstrapShared } from './shared.js';
import { initAppSelection } from '../pages/appSelection.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared();
  initAppSelection();
});
