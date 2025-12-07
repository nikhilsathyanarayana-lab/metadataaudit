import {
  createAddButton,
  createDomainSelect,
  createModalControls,
  createRemoveButton,
} from '../ui/components.js';

const storageKey = 'subidLaunchData';

export const querySubIdFormElements = () => {
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

export const createLaunchButtonStateUpdater = (fieldsContainer, launchButton, integrationKeys) => () => {
  const rows = Array.from(fieldsContainer.querySelectorAll('.subid-row'));

  const allComplete =
    rows.length > 0 &&
    rows.every((row) => {
      const input = row.querySelector('input[name="subid[]"]');
      const key = integrationKeys.get(row.dataset.subidRow || '');
      return Boolean(input && input.value.trim() && key && key.trim());
    });

  launchButton.disabled = !allComplete;
  launchButton.setAttribute('aria-disabled', String(!allComplete));
};

export const bindIntegrationModal = (elements, integrationKeys, updateLaunchButtonState) => {
  const { fieldsContainer, integrationModal, integrationBackdrop, integrationInput, integrationSave, integrationClosers } =
    elements;
  let activeIntegrationRowId = null;
  let hasClearedStoredDataForSession = false;

  const { open: showIntegrationModal, close: hideIntegrationModal } = createModalControls(
    integrationModal,
    integrationBackdrop,
  );

  const setIntegrationKeyForRow = (rowId, key) => {
    const normalizedKey = key.trim();
    const existingKey = integrationKeys.get(rowId) || '';

    if (normalizedKey && normalizedKey !== existingKey && !hasClearedStoredDataForSession) {
      clearStoredRunData();
      hasClearedStoredDataForSession = true;
    }

    integrationKeys.set(rowId, normalizedKey);

    const row = fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);
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

    updateLaunchButtonState();
  };

  const openIntegrationModal = (rowId) => {
    activeIntegrationRowId = rowId;
    const existingKey = integrationKeys.get(rowId) || '';
    integrationInput.value = existingKey;

    showIntegrationModal();
    integrationInput.focus();
  };

  const closeIntegrationModal = () => {
    activeIntegrationRowId = null;
    hideIntegrationModal();
  };

  integrationSave.addEventListener('click', () => {
    if (!activeIntegrationRowId) {
      return;
    }

    setIntegrationKeyForRow(activeIntegrationRowId, integrationInput.value.trim());
    closeIntegrationModal();
  });

  integrationClosers.forEach((button) => button.addEventListener('click', closeIntegrationModal));
  integrationBackdrop?.addEventListener('click', closeIntegrationModal);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && integrationModal?.classList.contains('is-visible')) {
      closeIntegrationModal();
    }
  });

  return { openIntegrationModal, closeIntegrationModal, setIntegrationKeyForRow };
};

const clearStoredRunData = () => {
  ['subidLaunchData', 'appSelectionResponses', 'metadataFieldRecords'].forEach((key) =>
    localStorage.removeItem(key),
  );
};

const createRowSerializer = (fieldsContainer, integrationKeys) => () =>
  Array.from(fieldsContainer.querySelectorAll('.subid-row'))
    .map((row) => {
      const subIdInput = row.querySelector('input[name="subid[]"]');
      const domainSelect = row.querySelector('.domain-select');
      const integrationKey = integrationKeys.get(row.dataset.subidRow || '') || '';

      return {
        subId: subIdInput?.value.trim() || '',
        domain: domainSelect?.value || '',
        integrationKey,
      };
    })
    .filter(({ subId, integrationKey }) => subId && integrationKey);

const createRowNumberingUpdater = (fieldsContainer) => () => {
  Array.from(fieldsContainer.querySelectorAll('.subid-row')).forEach((row, index) => {
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
};

const createAddRemoveButtonManager = (
  fieldsContainer,
  integrationKeys,
  renumberRows,
  updateLaunchButtonState,
) => {
  let handleAddSubId = null;

  const attachAddButton = () => {
    const existingButton = fieldsContainer.querySelector('.add-subid-btn');

    if (existingButton) {
      existingButton.remove();
    }

    const rows = fieldsContainer.querySelectorAll('.subid-row');

    if (!rows.length || !handleAddSubId) {
      return;
    }

    const addButton = createAddButton(handleAddSubId);
    rows[rows.length - 1].querySelector('.input-group')?.appendChild(addButton);
  };

  const removeSubIdField = (rowId) => {
    const row = fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);

    if (!row) {
      return;
    }

    integrationKeys.delete(rowId);
    row.remove();

    renumberRows();
    attachAddButton();
    updateLaunchButtonState();
  };

  const registerAddHandler = (handler) => {
    handleAddSubId = handler;
    attachAddButton();
  };

  return { attachAddButton, removeSubIdField, registerAddHandler };
};

const createSubIdRowFactory = (
  fieldsContainer,
  integrationKeys,
  openIntegrationModal,
  updateLaunchButtonState,
  renumberRows,
  addRemoveButtonManager,
) => {
  let subIdCount = 0;

  return function addSubIdField() {
    subIdCount += 1;
    const rowId = `row-${subIdCount}`;

    const row = document.createElement('div');
    row.className = 'subid-row';
    row.dataset.subidRow = rowId;

    const label = document.createElement('label');
    label.setAttribute('for', `subid-${subIdCount}`);
    label.textContent = `SubID ${subIdCount}`;

    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-group';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `subid-${subIdCount}`;
    input.name = 'subid[]';
    input.placeholder = 'Enter SubID';
    input.required = true;

    const domainSelect = createDomainSelect();

    const integrationButton = document.createElement('button');
    integrationButton.type = 'button';
    integrationButton.className = 'integration-btn';
    integrationButton.textContent = 'Add key';
    integrationButton.addEventListener('click', () => openIntegrationModal(rowId));

    inputGroup.append(domainSelect, input, integrationButton);

    if (fieldsContainer.children.length > 0) {
      const removeButton = createRemoveButton(() => addRemoveButtonManager.removeSubIdField(rowId));
      inputGroup.appendChild(removeButton);
    }

    row.append(label, inputGroup);

    const integrationKeyValue = document.createElement('p');
    integrationKeyValue.className = 'integration-key-value';
    integrationKeyValue.hidden = true;
    row.appendChild(integrationKeyValue);

    fieldsContainer.appendChild(row);

    input.addEventListener('input', updateLaunchButtonState);
    input.addEventListener('blur', updateLaunchButtonState);

    renumberRows();
    addRemoveButtonManager.attachAddButton();
    updateLaunchButtonState();
  };
};

export const setupSubIdRows = (elements, integrationKeys, openIntegrationModal, updateLaunchButtonState) => {
  const { fieldsContainer } = elements;

  const renumberRows = createRowNumberingUpdater(fieldsContainer);
  const serializeLaunchRows = createRowSerializer(fieldsContainer, integrationKeys);
  const addRemoveButtonManager = createAddRemoveButtonManager(
    fieldsContainer,
    integrationKeys,
    renumberRows,
    updateLaunchButtonState,
  );

  const addSubIdField = createSubIdRowFactory(
    fieldsContainer,
    integrationKeys,
    openIntegrationModal,
    updateLaunchButtonState,
    renumberRows,
    addRemoveButtonManager,
  );

  addRemoveButtonManager.registerAddHandler(addSubIdField);

  addSubIdField();

  return { serializeLaunchRows, addSubIdField };
};

export const persistSubIdLaunchData = (serializedRows) => {
  if (serializedRows.length > 0) {
    localStorage.setItem(storageKey, JSON.stringify(serializedRows));
  } else {
    localStorage.removeItem(storageKey);
  }
};

export const initSubIdForm = () => {
  const elements = querySubIdFormElements();

  if (!elements) {
    return;
  }

  const integrationKeys = new Map();
  const updateLaunchButtonState = createLaunchButtonStateUpdater(
    elements.fieldsContainer,
    elements.launchButton,
    integrationKeys,
  );

  const { openIntegrationModal } = bindIntegrationModal(elements, integrationKeys, updateLaunchButtonState);
  const { serializeLaunchRows } = setupSubIdRows(elements, integrationKeys, openIntegrationModal, updateLaunchButtonState);

  elements.launchButton.addEventListener('click', () => {
    const serializedRows = serializeLaunchRows();
    persistSubIdLaunchData(serializedRows);
    window.location.href = 'app_selection.html';
  });
};
