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

    if (!fieldsContainer || !launchButton) {
      return;
    }

    let subIdCount = 0;
    const integrationKeys = new Map();
    let activeIntegrationRowId = null;

    const integrationModal = document.getElementById('integration-modal');
    const integrationBackdrop = document.getElementById('integration-backdrop');
    const integrationInput = document.getElementById('integration-modal-input');
    const integrationSave = document.getElementById('integration-save');
    const integrationClosers = document.querySelectorAll('[data-close-integration]');

    if (!integrationModal || !integrationBackdrop || !integrationInput || !integrationSave) {
      return;
    }

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

    integrationSave?.addEventListener('click', () => {
      if (!activeIntegrationRowId) {
        return;
      }

      setIntegrationKeyForRow(activeIntegrationRowId, integrationInput.value.trim());
      closeIntegrationModal();
    });

    integrationClosers.forEach((button) =>
      button.addEventListener('click', () => {
        closeIntegrationModal();
      }),
    );

    integrationBackdrop?.addEventListener('click', closeIntegrationModal);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && integrationModal?.classList.contains('is-visible')) {
        closeIntegrationModal();
      }
    });

    const updateLaunchButtonState = () => {
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

    const buildAggregationRequestBody = () => ({
      response: { location: 'request', mimeType: 'application/json' },
      request: {
        requestId: 'apps-list',
        pipeline: [
          {
            source: {
              singleEvents: {
                appId: 'expandAppIds("*")',
                timeSeries: { first: 'now()', count: -7, period: 'dayRange' },
              },
            },
          },
          { join: { fields: ['appId'] } },
          { select: { appId: 'appId', appName: 'appName' } },
        ],
      },
    });

    const sendAggregationRequest = async (baseUrl, integrationKey) => {
      const endpoint = `${baseUrl.replace(/\/$/, '')}/api/v1/aggregation`;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Pendo-Integration-Key': integrationKey,
          },
          body: JSON.stringify(buildAggregationRequestBody()),
        });

        if (!response.ok) {
          console.error(`Aggregation request failed (${response.status}): ${endpoint}`);
          return;
        }

        const data = await response.json();
        console.log(`Aggregation response for ${endpoint}:`, data);
      } catch (error) {
        console.error('Aggregation request encountered an error:', error);
      }
    };

    const addSubIdField = () => {
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

      inputGroup.appendChild(createAddButton());

      updateLaunchButtonState();
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

    const persistSubIdLaunchData = () => {
      const serializedRows = serializeLaunchRows();

      if (serializedRows.length > 0) {
        localStorage.setItem('subidLaunchData', JSON.stringify(serializedRows));
      } else {
        localStorage.removeItem('subidLaunchData');
      }
    };

    launchButton.addEventListener('click', async () => {
      const rows = fieldsContainer.querySelectorAll('.subid-row');

      persistSubIdLaunchData();

      const requests = Array.from(rows).map((row) => {
        const domainSelect = row.querySelector('.domain-select');
        const key = integrationKeys.get(row.dataset.subidRow || '') || '';
        return sendAggregationRequest(domainSelect?.value || '', key);
      });

      await Promise.all(requests);

      window.location.href = 'app_selection.html';
    });

    addSubIdField();
  };

  const initAppSelection = () => {
    const proceedButton = document.getElementById('app-selection-continue');
    const tableBody = document.querySelector('.data-table tbody');

    if (!proceedButton || !tableBody) {
      return;
    }

    const storageKey = 'subidLaunchData';

    const parseStoredLaunchData = () => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
          return [];
        }

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          return [];
        }

        return parsed.filter((entry) => entry?.subId);
      } catch (error) {
        console.error('Unable to load stored SubID data:', error);
        return [];
      }
    };

    const formatDomain = (domain) => {
      if (!domain) {
        return 'selected domain';
      }

      try {
        return new URL(domain).hostname;
      } catch (error) {
        return domain;
      }
    };

    const formatIntegrationKey = (key) => {
      if (!key) {
        return 'saved key';
      }

      if (key.length <= 8) {
        return key;
      }

      return `${key.slice(0, 4)}…${key.slice(-4)}`;
    };

    const buildCheckbox = (subId, index) => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `Select app for Sub ID ${subId}`);
      checkbox.id = `stored-app-${index}`;

      return checkbox;
    };

    const populateTableFromStorage = () => {
      const storedRows = parseStoredLaunchData();

      if (!storedRows.length) {
        return;
      }

      tableBody.innerHTML = '';

      storedRows.forEach(({ subId, domain, integrationKey }, index) => {
        const row = document.createElement('tr');

        const subIdCell = document.createElement('td');
        subIdCell.dataset.label = 'Sub ID';
        subIdCell.textContent = subId;

        const appIdCell = document.createElement('td');
        appIdCell.dataset.label = 'App ID';
        appIdCell.textContent = `Apps from ${formatDomain(domain)} (${formatIntegrationKey(integrationKey)})`;

        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'checkbox-cell';
        checkboxCell.appendChild(buildCheckbox(subId, index));

        row.append(subIdCell, appIdCell, checkboxCell);
        tableBody.appendChild(row);
      });
    };

    populateTableFromStorage();

    const checkboxes = document.querySelectorAll('.data-table input[type="checkbox"]');

    if (checkboxes.length === 0) {
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

  const initDeepDiveNavigation = () => {
    const deepDiveButton = document.getElementById('deep-dive-button');

    if (!deepDiveButton) {
      return;
    }

    deepDiveButton.addEventListener('click', () => {
      window.location.href = 'deep_dive.html';
    });
  };

  initSubIdForm();
  initAppSelection();
  initDeepDiveNavigation();

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
