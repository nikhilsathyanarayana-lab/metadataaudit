import { createAddButton, createDomainSelect, createRemoveButton } from '../../src/ui/components.js';
import { setAppCredentials } from '../API/app_names.js';

// Collect SubID form DOM references needed for the controller.
const querySubIdFormElements = () => {
  const fieldsContainer = document.getElementById('subid-fields');

  if (!fieldsContainer) {
    return null;
  }

  return {
    fieldsContainer,
  };
};

class SubIdFormController {
  // Set up SubID form state and initial hydration.
  constructor(elements) {
    this.fieldsContainer = elements.fieldsContainer;
    this.subIdCount = 0;

    this.addSubIdField = this.addSubIdField.bind(this);
    this.removeSubIdField = this.removeSubIdField.bind(this);

    this.addSubIdField();
  }

  // Keep SubID labels/ids in sequence after add/remove actions.
  renumberRows() {
    Array.from(this.fieldsContainer.querySelectorAll('.subid-row')).forEach((row, index) => {
      const label = row.querySelector('label');
      const input = row.querySelector('input[name="subid[]"]');
      const displayIndex = index + 1;

      if (input) {
        input.id = `subid-${displayIndex}`;
      }

      if (label) {
        label.textContent = `SubID ${displayIndex}`;
        if (input?.id) {
          label.setAttribute('for', input.id);
        }
      }
    });
  }

  // Ensure the "Add SubID" button sits on the final row's input group.
  attachAddButton() {
    const existingButton = this.fieldsContainer.querySelector('.add-subid-btn');

    if (existingButton) {
      existingButton.remove();
    }

    const rows = this.fieldsContainer.querySelectorAll('.subid-row');

    if (!rows.length) {
      return;
    }

    const addButton = createAddButton(this.addSubIdField);
    rows[rows.length - 1].querySelector('.input-group')?.appendChild(addButton);
  }

  // Remove a SubID row and refresh numbering and button placement.
  removeSubIdField(rowId) {
    const row = this.fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);

    if (!row) {
      return;
    }

    row.remove();

    this.renumberRows();
    this.attachAddButton();
  }

  // Create a SubID row with optional initial values and render it.
  addSubIdField({ subId = '', domain = '', integrationKey = '' } = {}) {
    this.subIdCount += 1;
    const rowId = `row-${this.subIdCount}`;

    const row = document.createElement('div');
    row.className = 'subid-row';
    row.dataset.subidRow = rowId;

    const label = document.createElement('label');
    label.setAttribute('for', `subid-${this.subIdCount}`);
    label.textContent = `SubID ${this.subIdCount}`;

    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-group';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `subid-${this.subIdCount}`;
    input.name = 'subid[]';
    input.className = 'text-input subid-input';
    input.placeholder = 'Enter SubID';
    input.required = true;
    input.value = subId;

    const domainSelect = createDomainSelect();
    if (domain) {
      domainSelect.value = domain;
    }

    const integrationInput = document.createElement('input');
    integrationInput.type = 'text';
    integrationInput.name = 'integrationKey[]';
    integrationInput.className = 'text-input integration-input';
    integrationInput.placeholder = 'Enter integration key';
    integrationInput.setAttribute('aria-label', 'Integration key');
    integrationInput.required = true;
    integrationInput.value = integrationKey;

    inputGroup.append(domainSelect, input, integrationInput);

    if (this.fieldsContainer.children.length > 0) {
      const removeButton = createRemoveButton(() => this.removeSubIdField(rowId));
      inputGroup.appendChild(removeButton);
    }

    row.append(label, inputGroup);

    this.fieldsContainer.appendChild(row);

    this.renumberRows();
    this.attachAddButton();
  }

  // Collect credential entries from the rendered SubID rows.
  getCredentialEntries() {
    return Array.from(this.fieldsContainer.querySelectorAll('.subid-row')).map((row) => {
      const subIdInput = row.querySelector('input[name="subid[]"]');
      const domainSelect = row.querySelector('select');
      const integrationInput = row.querySelector('input[name="integrationKey[]"]');

      return {
        subId: subIdInput?.value?.trim() || '',
        domain: domainSelect?.value || '',
        integrationKey: integrationInput?.value?.trim() || '',
      };
    });
  }
}

// Wire SubID card actions to the SPA page switcher.
const initShortcutButtons = (sectionRoot, subIdFormController) => {
  const shortcutButtons = sectionRoot.querySelectorAll('[data-target-page]');

  if (!shortcutButtons.length) {
    return;
  }

  shortcutButtons.forEach((button) => {
    const targetPage = button.dataset.targetPage;

    if (!targetPage) {
      return;
    }

    button.addEventListener('click', () => {
      if (subIdFormController) {
        const entries = subIdFormController.getCredentialEntries();
        setAppCredentials(entries);
      }

      const destinationButton = document.querySelector(`[data-page-btn="${targetPage}"]`);

      destinationButton?.click();
    });
  });
};

// Initialize the SubID form controller.
export const initSubIdForm = () => {
  const elements = querySubIdFormElements();

  if (!elements) {
    return;
  }

  return new SubIdFormController(elements);
};

// Entry point for SPA section initialization on page load.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  const subIdFormController = initSubIdForm();
  initShortcutButtons(sectionRoot, subIdFormController);
}
