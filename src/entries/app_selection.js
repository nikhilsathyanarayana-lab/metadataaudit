import { bootstrapShared } from './shared.js';
import { initAppSelection } from '../pages/appSelection.js';
import { initNavigation } from '../pages/navigation.js';

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  await bootstrapShared();
  await initAppSelection();
});
