import { bootstrapShared } from './shared.js';
import { initDeepDive } from '../pages/deepDive.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared();
  initDeepDive();
});
