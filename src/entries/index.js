import { initSubIdForm } from '../controllers/subidForm.js';
import { initNavigation } from '../pages/navigation.js';
import { bootstrapShared } from './shared.js';

document.addEventListener('DOMContentLoaded', async () => {
  initNavigation();
  await bootstrapShared();
  initSubIdForm();
});
