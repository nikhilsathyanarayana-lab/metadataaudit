import { app_names } from '../API/app_names.js';

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
  const continueButton = sectionRoot.querySelector('#app-selection-continue-btn');
  let selectedAppCount = 0;

  if (!headerToggle || !tableCheckboxes.length) {
    return;
  }

  const updateContinueButtonState = () => {
    if (!continueButton) {
      return;
    }

    const hasSelection = selectedAppCount > 0;
    continueButton.disabled = !hasSelection;
    continueButton.setAttribute('aria-disabled', hasSelection ? 'false' : 'true');
  };

  const updateSelectionCount = () => {
    selectedAppCount = Array.from(tableCheckboxes).filter((checkbox) => checkbox.checked).length;
    const selectionCount = sectionRoot.querySelector('.selection-count');

    if (selectionCount) {
      const appLabel = selectedAppCount === 1 ? 'app' : 'apps';
      selectionCount.textContent = `${selectedAppCount} ${appLabel} selected`;
    }

    updateContinueButtonState();
  };

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
  updateSelectionCount();

  tableCheckboxes.forEach((checkbox) => {
    checkbox.disabled = false;
    checkbox.removeAttribute('aria-disabled');
    checkbox.addEventListener('change', () => {
      syncHeaderState();
      updateSelectionCount();
    });
  });

  headerToggle.addEventListener('change', () => {
    const isChecked = headerToggle.checked;
    headerToggle.setAttribute('aria-checked', isChecked ? 'true' : 'false');
    setRowSelection(isChecked);
    updateSelectionCount();
  });
}
