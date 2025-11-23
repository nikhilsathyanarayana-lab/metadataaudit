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

  const setIntegrationKeyForRow = (rowId, key) => {
    integrationKeys.set(rowId, key);

    const row = fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);
    const keyDisplay = row?.querySelector('.integration-key-value');

    if (row && keyDisplay) {
      if (key.trim()) {
        keyDisplay.textContent = `Integration key: ${key}`;
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

    integrationModal.hidden = false;
    integrationBackdrop.hidden = false;
    integrationModal.classList.add('is-visible');
    integrationBackdrop.classList.add('is-visible');
    integrationInput.focus();
  };

  const closeIntegrationModal = () => {
    activeIntegrationRowId = null;
    integrationModal.classList.remove('is-visible');
    integrationBackdrop.classList.remove('is-visible');
    integrationModal.hidden = true;
    integrationBackdrop.hidden = true;
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

export const setupSubIdRows = (elements, integrationKeys, openIntegrationModal, updateLaunchButtonState) => {
  const { fieldsContainer } = elements;
  let subIdCount = 0;

  const buildDomainSelect = () => {
    const select = document.createElement('select');
    select.className = 'domain-select';
    select.name = 'pendo-domain[]';

    const domains = [
      { label: 'pendo.io', value: 'https://app.pendo.io/' },
      { label: 'eu', value: 'https://app.eu.pendo.io/' },
      { label: 'us1', value: 'https://us1.app.pendo.io/' },
      { label: 'jpn', value: 'https://app.jpn.pendo.io/' },
      { label: 'au', value: 'https://app.au.pendo.io/' },
      { label: 'HSBC', value: 'https://app.HSBC.pendo.io/' },
    ];

    domains.forEach(({ label, value }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });

    return select;
  };

  const serializeLaunchRows = () =>
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

  const handleAddSubId = () => addSubIdField();

  function addSubIdField() {
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

    const domainSelect = buildDomainSelect();

    const integrationButton = document.createElement('button');
    integrationButton.type = 'button';
    integrationButton.className = 'integration-btn';
    integrationButton.textContent = 'Add key';
    integrationButton.addEventListener('click', () => openIntegrationModal(rowId));

    inputGroup.append(domainSelect, input, integrationButton);
    row.append(label, inputGroup);

    const integrationKeyValue = document.createElement('p');
    integrationKeyValue.className = 'integration-key-value';
    integrationKeyValue.hidden = true;
    row.appendChild(integrationKeyValue);

    fieldsContainer.appendChild(row);

    input.addEventListener('input', updateLaunchButtonState);
    input.addEventListener('blur', updateLaunchButtonState);

    const existingButton = fieldsContainer.querySelector('.add-subid-btn');

    if (existingButton) {
      existingButton.removeEventListener('click', handleAddSubId);
      existingButton.remove();
    }

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'add-subid-btn';
    addButton.setAttribute('aria-label', 'Add another SubID');
    addButton.textContent = '+';
    addButton.addEventListener('click', handleAddSubId);

    inputGroup.appendChild(addButton);

    updateLaunchButtonState();
  }

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
