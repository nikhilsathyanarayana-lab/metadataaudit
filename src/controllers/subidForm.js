import {
  createAddButton,
  createDomainSelect,
  createModalControls,
  createRemoveButton,
} from '../ui/components.js';

const storageKey = 'subidLaunchData';

const querySubIdFormElements = () => {
  const fieldsContainer = document.getElementById('subid-fields');
  const launchButton = document.getElementById('launch-button');
  const integrationModal = document.getElementById('integration-modal');
  const integrationBackdrop = document.getElementById('integration-backdrop');
  const integrationInput = document.getElementById('integration-modal-input');
  const integrationSave = document.getElementById('integration-save');
  const integrationClosers = document.querySelectorAll('[data-close-integration]');

  if (!fieldsContainer || !launchButton || !integrationModal || !integrationBackdrop || !integrationInput || !integrationSave) {
    return null;
  }

  return {
    fieldsContainer,
    launchButton,
    integrationModal,
    integrationBackdrop,
    integrationInput,
    integrationSave,
    integrationClosers,
  };
};

class SubIdFormController {
  constructor(elements) {
    this.fieldsContainer = elements.fieldsContainer;
    this.launchButton = elements.launchButton;
    this.integrationModal = elements.integrationModal;
    this.integrationBackdrop = elements.integrationBackdrop;
    this.integrationInput = elements.integrationInput;
    this.integrationSave = elements.integrationSave;
    this.integrationClosers = elements.integrationClosers;

    this.integrationKeys = new Map();
    this.hasClearedStoredDataForSession = false;
    this.activeIntegrationRowId = null;
    this.subIdCount = 0;

    this.addSubIdField = this.addSubIdField.bind(this);
    this.removeSubIdField = this.removeSubIdField.bind(this);
    this.openIntegrationModal = this.openIntegrationModal.bind(this);
    this.closeIntegrationModal = this.closeIntegrationModal.bind(this);
    this.updateLaunchButtonState = this.updateLaunchButtonState.bind(this);

    const { open, close } = createModalControls(this.integrationModal, this.integrationBackdrop);
    this.showIntegrationModal = open;
    this.hideIntegrationModal = close;

    this.bindIntegrationModal();
    this.addSubIdField();
  }

  updateLaunchButtonState() {
    const rows = Array.from(this.fieldsContainer.querySelectorAll('.subid-row'));

    const allComplete =
      rows.length > 0 &&
      rows.every((row) => {
        const input = row.querySelector('input[name="subid[]"]');
        const key = this.integrationKeys.get(row.dataset.subidRow || '');
        return Boolean(input && input.value.trim() && key && key.trim());
      });

    this.launchButton.disabled = !allComplete;
    this.launchButton.setAttribute('aria-disabled', String(!allComplete));
  }

  bindIntegrationModal() {
    this.integrationSave.addEventListener('click', () => {
      if (!this.activeIntegrationRowId) {
        return;
      }

      this.setIntegrationKeyForRow(this.activeIntegrationRowId, this.integrationInput.value.trim());
      this.closeIntegrationModal();
    });

    this.integrationClosers.forEach((button) => button.addEventListener('click', this.closeIntegrationModal));
    this.integrationBackdrop?.addEventListener('click', this.closeIntegrationModal);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.integrationModal?.classList.contains('is-visible')) {
        this.closeIntegrationModal();
      }
    });
  }

  clearStoredRunData() {
    ['subidLaunchData', 'appSelectionResponses', 'metadataFieldRecords'].forEach((key) =>
      sessionStorage.removeItem(key),
    );
  }

  setIntegrationKeyForRow(rowId, key) {
    const normalizedKey = key.trim();
    const existingKey = this.integrationKeys.get(rowId) || '';

    if (normalizedKey && normalizedKey !== existingKey && !this.hasClearedStoredDataForSession) {
      this.clearStoredRunData();
      this.hasClearedStoredDataForSession = true;
    }

    this.integrationKeys.set(rowId, normalizedKey);

    const row = this.fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);
    const keyDisplay = row?.querySelector('.integration-key-value');

    if (row && keyDisplay) {
      if (normalizedKey) {
        keyDisplay.textContent = `Integration key: ${normalizedKey}`;
        keyDisplay.hidden = false;
      } else {
        keyDisplay.textContent = '';
        keyDisplay.hidden = true;
      }
    }

    this.updateLaunchButtonState();
  }

  openIntegrationModal(rowId) {
    this.activeIntegrationRowId = rowId;
    const existingKey = this.integrationKeys.get(rowId) || '';
    this.integrationInput.value = existingKey;

    this.showIntegrationModal();
    this.integrationInput.focus();
  }

  closeIntegrationModal() {
    this.activeIntegrationRowId = null;
    this.hideIntegrationModal();
  }

  serializeLaunchRows() {
    return Array.from(this.fieldsContainer.querySelectorAll('.subid-row'))
      .map((row) => {
        const subIdInput = row.querySelector('input[name="subid[]"]');
        const domainSelect = row.querySelector('.domain-select');
        const integrationKey = this.integrationKeys.get(row.dataset.subidRow || '') || '';

        return {
          subId: subIdInput?.value.trim() || '',
          domain: domainSelect?.value || '',
          integrationKey,
        };
      })
      .filter(({ subId, integrationKey }) => subId && integrationKey);
  }

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

  removeSubIdField(rowId) {
    const row = this.fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);

    if (!row) {
      return;
    }

    this.integrationKeys.delete(rowId);
    row.remove();

    this.renumberRows();
    this.attachAddButton();
    this.updateLaunchButtonState();
  }

  addSubIdField() {
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
    input.placeholder = 'Enter SubID';
    input.required = true;

    const domainSelect = createDomainSelect();

    const integrationButton = document.createElement('button');
    integrationButton.type = 'button';
    integrationButton.className = 'integration-btn';
    integrationButton.textContent = 'Add key';
    integrationButton.addEventListener('click', () => this.openIntegrationModal(rowId));

    inputGroup.append(domainSelect, input, integrationButton);

    if (this.fieldsContainer.children.length > 0) {
      const removeButton = createRemoveButton(() => this.removeSubIdField(rowId));
      inputGroup.appendChild(removeButton);
    }

    row.append(label, inputGroup);

    const integrationKeyValue = document.createElement('p');
    integrationKeyValue.className = 'integration-key-value';
    integrationKeyValue.hidden = true;
    row.appendChild(integrationKeyValue);

    this.fieldsContainer.appendChild(row);

    input.addEventListener('input', this.updateLaunchButtonState);
    input.addEventListener('blur', this.updateLaunchButtonState);

    this.renumberRows();
    this.attachAddButton();
    this.updateLaunchButtonState();
  }

  persistLaunchData() {
    const serializedRows = this.serializeLaunchRows();

    if (serializedRows.length > 0) {
      sessionStorage.setItem(storageKey, JSON.stringify(serializedRows));
    } else {
      sessionStorage.removeItem(storageKey);
    }

    return serializedRows;
  }
}

export const initSubIdForm = () => {
  const elements = querySubIdFormElements();

  if (!elements) {
    return;
  }

  const controller = new SubIdFormController(elements);

  elements.launchButton.addEventListener('click', () => {
    controller.persistLaunchData();
    window.location.href = 'app_selection.html';
  });
};

export { SubIdFormController };
