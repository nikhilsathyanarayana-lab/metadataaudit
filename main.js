document.addEventListener('DOMContentLoaded', async () => {
  const loadModalTemplate = async (templatePath) => {
    try {
      const response = await fetch(templatePath);

      if (!response.ok) {
        throw new Error(`Failed to load modal template: ${response.status}`);
      }

      const templateHTML = await response.text();
      const templateWrapper = document.createElement('div');
      templateWrapper.innerHTML = templateHTML.trim();

      const fragment = document.createDocumentFragment();
      Array.from(templateWrapper.childNodes).forEach((node) => fragment.appendChild(node));

      document.body.appendChild(fragment);
    } catch (error) {
      console.error(error);
    }
  };

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

      const domainSelect = buildDomainSelect();

      inputGroup.append(domainSelect, input);
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

  const initExportModal = () => {
    const exportButton = document.getElementById('export-button');
    const modal = document.getElementById('export-modal');
    const backdrop = document.getElementById('export-backdrop');

    if (!exportButton || !modal || !backdrop) {
      return;
    }

    const closeButtons = modal.querySelectorAll('[data-close-modal]');
    const formatButtons = modal.querySelectorAll('[data-format]');

    const openModal = () => {
      modal.hidden = false;
      backdrop.hidden = false;
      modal.classList.add('is-visible');
      backdrop.classList.add('is-visible');
    };

    const closeModal = () => {
      modal.classList.remove('is-visible');
      backdrop.classList.remove('is-visible');
      modal.hidden = true;
      backdrop.hidden = true;
    };

    exportButton.addEventListener('click', openModal);
    backdrop.addEventListener('click', closeModal);
    closeButtons.forEach((button) => button.addEventListener('click', closeModal));

    formatButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const format = button.getAttribute('data-format');
        console.info(`Export selected: ${format?.toUpperCase()}`);
        closeModal();
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('is-visible')) {
        closeModal();
      }
    });
  };

  initSubIdForm();
  initAppSelection();

  const initExportModalWithTemplate = async () => {
    const exportButton = document.getElementById('export-button');

    if (!exportButton) {
      return;
    }

    if (!document.getElementById('export-modal')) {
      await loadModalTemplate('Modals/export-modal.html');
    }

    initExportModal();
  };

  await initExportModalWithTemplate();
});
