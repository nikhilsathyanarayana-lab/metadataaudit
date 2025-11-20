document.addEventListener('DOMContentLoaded', () => {
  const initSubIdForm = () => {
    const fieldsContainer = document.getElementById('subid-fields');
    const launchButton = document.getElementById('launch-button');
    const integrationKeyInput = document.getElementById('integration-key');

    if (!fieldsContainer || !launchButton) {
      return;
    }

    let subIdCount = 0;

    const updateLaunchButtonState = () => {
      const firstInput = document.getElementById('subid-1');
      const hasSubId = firstInput && firstInput.value.trim().length > 0;
      const hasIntegrationKey = integrationKeyInput && integrationKeyInput.value.trim().length > 0;
      const isReady = hasSubId && hasIntegrationKey;

      launchButton.disabled = !isReady;
      launchButton.setAttribute('aria-disabled', String(!isReady));
    };

    const handleAddSubId = () => {
      addSubIdField();
    };

    const createAddButton = () => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'add-subid-btn';
      button.setAttribute('aria-label', 'Add another SubID');
      button.textContent = '+';
      button.addEventListener('click', handleAddSubId);
      return button;
    };

    const addSubIdField = () => {
      subIdCount += 1;

      const row = document.createElement('div');
      row.className = 'subid-row';

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

      inputGroup.appendChild(input);
      row.append(label, inputGroup);
      fieldsContainer.appendChild(row);

      if (subIdCount === 1) {
        input.addEventListener('input', updateLaunchButtonState);
        input.addEventListener('blur', updateLaunchButtonState);
      }

      const existingButton = fieldsContainer.querySelector('.add-subid-btn');
      if (existingButton) {
        existingButton.removeEventListener('click', handleAddSubId);
        existingButton.remove();
      }

      inputGroup.appendChild(createAddButton());

      updateLaunchButtonState();
    };

    launchButton.addEventListener('click', () => {
      window.location.href = 'app_selection.html';
    });

    integrationKeyInput?.addEventListener('input', updateLaunchButtonState);
    integrationKeyInput?.addEventListener('blur', updateLaunchButtonState);

    addSubIdField();
  };

  const initAppSelection = () => {
    const proceedButton = document.getElementById('app-selection-continue');
    const checkboxes = document.querySelectorAll('.data-table input[type="checkbox"]');

    if (!proceedButton || checkboxes.length === 0) {
      return;
    }

    const updateProceedState = () => {
      const hasSelection = Array.from(checkboxes).some((box) => box.checked);
      proceedButton.disabled = !hasSelection;
      proceedButton.setAttribute('aria-disabled', String(!hasSelection));
    };

    checkboxes.forEach((box) => box.addEventListener('change', updateProceedState));

    proceedButton.addEventListener('click', () => {
      window.location.href = 'metadata_fields.html';
    });

    updateProceedState();
  };

  initSubIdForm();
  initAppSelection();
});
