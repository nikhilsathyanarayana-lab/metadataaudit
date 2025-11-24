import { bootstrapShared } from './shared.js';
import { initDeepDiveNavigation } from '../pages/navigation.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared();
  initDeepDiveNavigation();
});
