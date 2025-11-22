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

  const createSpinner = () => {
    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    return spinner;
  };

  const createProcessingDisplay = (targetElement) => {
    let processing = false;

    const setProcessing = (isProcessing) => {
      processing = Boolean(isProcessing);
    };

    const render = (message) => {
      if (!targetElement) {
        return;
      }

      targetElement.innerHTML = '';

      if (processing) {
        targetElement.appendChild(createSpinner());
      }

      const text = document.createElement('span');
      text.textContent = message;
      targetElement.appendChild(text);
    };

    return { render, setProcessing };
  };

  const initSubIdForm = () => {
    const fieldsContainer = document.getElementById('subid-fields');
    const launchButton = document.getElementById('launch-button');
    const launchStatus = document.getElementById('launch-status');

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

    const launchStatusDisplay = createProcessingDisplay(launchStatus);

    const setFormBusy = (isBusy) => {
      const controls = fieldsContainer.querySelectorAll('input, select, button');

      controls.forEach((control) => {
        if (!isBusy && control === launchButton) {
          return;
        }

        control.disabled = isBusy;
        control.setAttribute('aria-disabled', String(isBusy));
      });

      if (!isBusy) {
        updateLaunchButtonState();
      }
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
              singleEvents: { appId: 'expandAppIds("*")' },
              timeSeries: { first: 'now()', count: -7, period: 'dayRange' },
            },
          },
          { group: { group: ['appId'] } },
          { select: { appId: 'appId' } },
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

      const totalRequests = rows.length;

      setFormBusy(true);
      launchStatusDisplay.setProcessing(true);
      launchStatusDisplay.render(
        `Sending ${totalRequests} request${totalRequests === 1 ? '' : 's'}...`,
      );

      let completed = 0;

      const requests = Array.from(rows).map(async (row) => {
        const domainSelect = row.querySelector('.domain-select');
        const key = integrationKeys.get(row.dataset.subidRow || '') || '';

        await sendAggregationRequest(domainSelect?.value || '', key);
        completed += 1;

        launchStatusDisplay.setProcessing(completed < totalRequests);
        launchStatusDisplay.render(`Fetching data (${completed}/${totalRequests})...`);
      });

      await Promise.all(requests);

      launchStatusDisplay.setProcessing(true);
      launchStatusDisplay.render('Requests complete. Redirecting to app selection...');

      window.location.href = 'app_selection.html';
    });

    addSubIdField();
  };

  const initAppSelection = () => {
    const proceedButton = document.getElementById('app-selection-continue');
    const tableBody = document.getElementById('app-selection-table-body') || document.querySelector('.data-table tbody');
    const messageRegion = document.getElementById('app-selection-messages');
    const progressBanner = document.getElementById('app-selection-progress');

    if (!proceedButton || !tableBody) {
      return;
    }

    const storageKey = 'subidLaunchData';
    const responseStorageKey = 'appSelectionResponses';

    const showError = (message) => {
      if (!messageRegion) {
        return;
      }

      messageRegion.innerHTML = '';
      const alert = document.createElement('p');
      alert.className = 'alert';
      alert.textContent = message;
      messageRegion.appendChild(alert);
    };

    const clearError = () => {
      if (messageRegion) {
        messageRegion.innerHTML = '';
      }
    };

    const progressDisplay = createProcessingDisplay(progressBanner);

    const updateProgress = (completed, total) => {
      if (!progressBanner) {
        return;
      }

      if (!total) {
        progressBanner.textContent = '';
        return;
      }

      const isFetching = completed < total;

      progressDisplay.setProcessing(isFetching);
      progressDisplay.render(
        isFetching ? `Fetching apps (${completed}/${total})...` : `Fetched ${completed} of ${total}`,
      );
    };

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

        return parsed.filter((entry) => entry?.subId && entry?.domain && entry?.integrationKey);
      } catch (error) {
        console.error('Unable to load stored SubID data:', error);
        return [];
      }
    };

    const buildAppAggregationRequest = () => ({
      response: { location: 'request', mimeType: 'application/json' },
      request: {
        requestId: 'apps-list',
        pipeline: [
          {
            source: {
              singleEvents: { appId: 'expandAppIds("*")' },
              timeSeries: { first: 'now()', count: -7, period: 'dayRange' },
            },
          },
          { group: { group: ['appId'] } },
          { select: { appId: 'appId' } },
        ],
      },
    });

    const buildRequestHeaders = (integrationKey) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      'X-Pendo-Integration-Key': integrationKey,
    });

    const fetchAppsForEntry = async ({ domain, integrationKey }) => {
      const endpoint = `${domain.replace(/\/$/, '')}/api/v1/aggregation`;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: buildRequestHeaders(integrationKey),
          body: JSON.stringify(buildAppAggregationRequest()),
        });

        if (!response.ok) {
          throw new Error(`Aggregation request failed (${response.status}) for ${endpoint}`);
        }

        return await response.json();
      } catch (error) {
        console.error('Aggregation request encountered an error:', error);
        return null;
      }
    };

    const extractAppIds = (apiResponse) => {
      if (!apiResponse) {
        return [];
      }

      const candidateLists = [apiResponse?.results, apiResponse?.data, apiResponse?.apps];

      if (Array.isArray(apiResponse)) {
        candidateLists.push(apiResponse);
      }

      const flattened = candidateLists.filter(Array.isArray).flat();

      const appIds = flattened
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry;
          }

          if (entry?.appId) {
            return entry.appId;
          }

          return null;
        })
        .filter(Boolean);

      return Array.from(new Set(appIds));
    };

    const buildCheckbox = (subId, index) => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `Select app for Sub ID ${subId}`);
      checkbox.id = `stored-app-${index}`;

      return checkbox;
    };

    const handleProceedState = () => {
      const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');
      const hasSelection = Array.from(checkboxes).some((box) => box.checked);
      proceedButton.disabled = !hasSelection;
      proceedButton.setAttribute('aria-disabled', String(!hasSelection));
    };

    const attachCheckboxListeners = () => {
      const checkboxes = tableBody.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((box) => box.addEventListener('change', handleProceedState));
      handleProceedState();
    };

    const populateTableFromResponses = (responses) => {
      tableBody.innerHTML = '';

      const rows = [];

      responses.forEach(({ subId, response }) => {
        const appIds = extractAppIds(response);

        if (!appIds.length) {
          rows.push({ subId, appId: 'No apps returned' });
          return;
        }

        appIds.forEach((appId) => rows.push({ subId, appId }));
      });

      if (!rows.length) {
        const row = document.createElement('tr');
        const emptyCell = document.createElement('td');
        emptyCell.colSpan = 3;
        emptyCell.textContent = 'No app data available.';
        row.appendChild(emptyCell);
        tableBody.appendChild(row);
        proceedButton.disabled = true;
        proceedButton.setAttribute('aria-disabled', 'true');
        return;
      }

      rows.forEach(({ subId, appId }, index) => {
        const row = document.createElement('tr');

        const subIdCell = document.createElement('td');
        subIdCell.dataset.label = 'Sub ID';
        subIdCell.textContent = subId;

        const appIdCell = document.createElement('td');
        appIdCell.dataset.label = 'App ID';
        appIdCell.textContent = appId;

        const checkboxCell = document.createElement('td');
        checkboxCell.className = 'checkbox-cell';
        checkboxCell.appendChild(buildCheckbox(subId, index));

        row.append(subIdCell, appIdCell, checkboxCell);
        tableBody.appendChild(row);
      });

      attachCheckboxListeners();
    };

    const fetchAndPopulate = async () => {
      const storedRows = parseStoredLaunchData();

      if (!storedRows.length) {
        showError('API information not found.');
        proceedButton.disabled = true;
        proceedButton.setAttribute('aria-disabled', 'true');
        updateProgress(0, 0);
        return;
      }

      clearError();
      updateProgress(0, storedRows.length);

      let completed = 0;
      const responses = [];

      for (const entry of storedRows) {
        const response = await fetchAppsForEntry(entry);
        completed += 1;
        updateProgress(completed, storedRows.length);

        responses.push({ ...entry, response });
      }

      const successfulResponses = responses.filter(({ response }) => Boolean(response));

      if (successfulResponses.length) {
        localStorage.setItem(responseStorageKey, JSON.stringify(successfulResponses));
      } else {
        localStorage.removeItem(responseStorageKey);
      }

      populateTableFromResponses(successfulResponses);
    };

    proceedButton.addEventListener('click', () => {
      window.location.href = 'metadata_fields.html';
    });

    fetchAndPopulate();
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
