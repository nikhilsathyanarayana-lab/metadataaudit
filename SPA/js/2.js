import { app_names } from '../API/app.js';

// Initialize the app discovery section with available credentials.
export async function initSection(sectionRoot) {
  // eslint-disable-next-line no-console
  console.log('Initializing app selection preview');

  await app_names();

  if (!sectionRoot) {
    return;
  }

  const tableCheckboxes = sectionRoot.querySelectorAll('tbody input[type="checkbox"]');
  const headerToggle = sectionRoot.querySelector('#app-selection-toggle-all-preview');

  if (!headerToggle || !tableCheckboxes.length) {
    return;
  }

  const syncHeaderState = () => {
    const areAllChecked = Array.from(tableCheckboxes).every((checkbox) => checkbox.checked);
    headerToggle.checked = areAllChecked;
    headerToggle.setAttribute('aria-checked', areAllChecked ? 'true' : 'false');
  };

  const setRowSelection = (isChecked) => {
    tableCheckboxes.forEach((checkbox) => {
      checkbox.checked = isChecked;
      checkbox.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    });
  };

  headerToggle.disabled = false;
  headerToggle.removeAttribute('disabled');
  headerToggle.setAttribute('aria-disabled', 'false');
  headerToggle.setAttribute('aria-checked', 'false');
  setRowSelection(false);

  tableCheckboxes.forEach((checkbox) => {
    checkbox.disabled = false;
    checkbox.removeAttribute('aria-disabled');
    checkbox.addEventListener('change', syncHeaderState);
  });

  headerToggle.addEventListener('change', () => {
    const isChecked = headerToggle.checked;
    headerToggle.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    setRowSelection(isChecked);
  });
}
