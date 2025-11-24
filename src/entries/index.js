import { initSubIdForm } from '../controllers/subidForm.js';
import { bootstrapShared } from './shared.js';

document.addEventListener('DOMContentLoaded', async () => {
  await bootstrapShared();
  initSubIdForm();
});
