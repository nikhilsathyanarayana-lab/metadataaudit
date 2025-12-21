import { initSubIdForm } from '../../src/controllers/subidForm.js';

export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  initSubIdForm();
}
