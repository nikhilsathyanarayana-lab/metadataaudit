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
    const sessionCookies = new Map();
    let activeIntegrationRowId = null;

    const integrationModal = document.getElementById('integration-modal');
    const integrationBackdrop = document.getElementById('integration-backdrop');
    const integrationInput = document.getElementById('integration-modal-input');
    const integrationSave = document.getElementById('integration-save');
    const integrationClosers = document.querySelectorAll('[data-close-integration]');

    if (!integrationModal || !integrationBackdrop || !integrationInput || !integrationSave) {
      return;
    }

    const setSessionCookieForRow = (rowId, cookie) => {
      sessionCookies.set(rowId, cookie);

      const row = fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);
      const keyDisplay = row?.querySelector('.integration-status');

      if (row && keyDisplay) {
        const hasCookie = Boolean(cookie.trim());
        keyDisplay.textContent = hasCookie ? 'Cookie Added' : 'Cookie Required';
        keyDisplay.classList.toggle('integration-status-added', hasCookie);
        keyDisplay.classList.toggle('integration-status-required', !hasCookie);
        keyDisplay.hidden = false;
      }

      updateLaunchButtonState();
    };

    const openIntegrationModal = (rowId) => {
      activeIntegrationRowId = rowId;
      const existingCookie = sessionCookies.get(rowId) || '';
      integrationInput.value = existingCookie;

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

      setSessionCookieForRow(activeIntegrationRowId, integrationInput.value.trim());
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
          const cookie = sessionCookies.get(row.dataset.subidRow || '');
          return Boolean(input && input.value.trim() && cookie && cookie.trim());
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
        { label: 'US', value: 'https://aggregations-dot-pendo-io.gke.us.pendo.io' },
        { label: 'US1', value: 'https://aggregations-dot-pendo-us1.gke.us1.pendo.io' },
        { label: 'EU', value: 'https://aggregations-dot-pendo-eu.gke.eu.pendo.io' },
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
      integrationButton.textContent = 'Add cookie';
      integrationButton.addEventListener('click', () => openIntegrationModal(rowId));

      inputGroup.append(domainSelect, input, integrationButton);
      row.append(label, inputGroup);

      const sessionCookieValue = document.createElement('p');
      sessionCookieValue.className = 'integration-key-value integration-status integration-status-required';
      sessionCookieValue.textContent = 'Cookie Required';
      sessionCookieValue.hidden = false;
      row.appendChild(sessionCookieValue);

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
          const sessionCookie = sessionCookies.get(row.dataset.subidRow || '') || '';

          return {
            subId: subIdInput?.value.trim() || '',
            domain: domainSelect?.value || '',
            sessionCookie,
          };
        })
        .filter(({ subId, sessionCookie }) => subId && sessionCookie);

    const persistSubIdLaunchData = () => {
      const serializedRows = serializeLaunchRows();

      if (serializedRows.length > 0) {
        localStorage.setItem('subidLaunchData', JSON.stringify(serializedRows));
      } else {
        localStorage.removeItem('subidLaunchData');
      }
    };

    launchButton.addEventListener('click', async () => {
      persistSubIdLaunchData();

      window.location.href = 'app_selection.html';
    });

    addSubIdField();
  };

  const initAppSelection = () => {
    const proceedButton = document.getElementById('app-selection-continue');
    const tableBody = document.getElementById('app-selection-table-body') || document.querySelector('.data-table tbody');
    const messageRegion = document.getElementById('app-selection-messages');
    const progressBanner = document.getElementById('app-selection-progress');
    const selectAllCheckbox = document.getElementById('app-selection-select-all');

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

    const updateProgress = (completed, total) => {
      if (!progressBanner) {
        return;
      }

      if (!total) {
        progressBanner.textContent = '';
        return;
      }

      progressBanner.textContent = `Fetched ${completed} of ${total}`;
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

        return parsed.filter((entry) => entry?.subId && entry?.domain && entry?.sessionCookie);
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

    const buildRequestHeaders = (sessionCookie) => ({
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate, br',
      Connection: 'keep-alive',
      Cookie: `pendo.sess.jwt2=${sessionCookie}`,
    });

    const useLiveAggregation = new URLSearchParams(window.location.search).get('live') === 'true';
    const sampleAggregationPath = 'Aggregations/sample-apps.json';

    const fetchAppsForEntry = async ({ domain, subId, sessionCookie }) => {
      if (!useLiveAggregation) {
        try {
          const sampleResponse = await fetch(sampleAggregationPath);

          if (!sampleResponse.ok) {
            throw new Error(`Failed to load sample aggregation data (${sampleResponse.status})`);
          }

          const sampleJson = await sampleResponse.json();
          return sampleJson;
        } catch (error) {
          console.error('Sample aggregation data could not be loaded:', error);
          return null;
        }
      }

      const baseDomain = domain?.replace(/\/?$/, '') || '';
      const endpoint = `${baseDomain}/api/s/${encodeURIComponent(
        subId,
      )}/aggregation?all=true&cachepolicy=all:ignore`;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: buildRequestHeaders(sessionCookie),
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

    const getRowCheckboxes = () => tableBody.querySelectorAll('input[type="checkbox"]');

    const handleProceedState = () => {
      const checkboxes = getRowCheckboxes();
      const hasSelection = Array.from(checkboxes).some((box) => box.checked);
      proceedButton.disabled = !hasSelection;
      proceedButton.setAttribute('aria-disabled', String(!hasSelection));
    };

    const updateSelectAllState = () => {
      if (!selectAllCheckbox) {
        return;
      }

      const checkboxes = getRowCheckboxes();
      const total = checkboxes.length;
      const checkedCount = Array.from(checkboxes).filter((box) => box.checked).length;

      selectAllCheckbox.disabled = total === 0;
      selectAllCheckbox.checked = total > 0 && checkedCount === total;
      selectAllCheckbox.indeterminate = checkedCount > 0 && checkedCount < total;
    };

    const handleCheckboxChange = () => {
      handleProceedState();
      updateSelectAllState();
    };

    const attachCheckboxListeners = () => {
      const checkboxes = getRowCheckboxes();
      checkboxes.forEach((box) => box.addEventListener('change', handleCheckboxChange));
      handleCheckboxChange();
    };

    selectAllCheckbox?.addEventListener('change', (event) => {
      const target = event.target;

      if (!(target instanceof HTMLInputElement)) {
        return;
      }

      const checkboxes = getRowCheckboxes();
      checkboxes.forEach((box) => {
        box.checked = target.checked;
      });

      handleCheckboxChange();
    });

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
        updateSelectAllState();
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

      if (!useLiveAggregation && progressBanner) {
        progressBanner.textContent =
          'Using bundled sample app data (add ?live=true to the URL to call Pendo APIs).';
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

    attachCheckboxListeners();
    updateSelectAllState();
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
