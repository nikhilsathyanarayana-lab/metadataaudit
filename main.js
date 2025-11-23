import {
  buildAggregationUrl,
  buildAppDiscoveryPayload,
  buildExamplesPayload,
  buildMetadataFieldsPayload,
  fetchAggregation,
} from './Aggregations/aggregationRequests.js';

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
        window.location.href = 'app_selection.html';
      });

    addSubIdField();
  };

  const initAppSelection = () => {
    const proceedButton = document.getElementById('app-selection-continue');
    const tableBody = document.getElementById('app-selection-table-body') || document.querySelector('.data-table tbody');
    const headerCheckbox = document.getElementById('app-selection-header-checkbox');
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

    const getBodyCheckboxes = () => tableBody.querySelectorAll('input[type="checkbox"]');

    const updateHeaderCheckboxState = (checkboxes) => {
      if (!headerCheckbox) {
        return;
      }

      const bodyCheckboxes = checkboxes || getBodyCheckboxes();

      if (!bodyCheckboxes.length) {
        headerCheckbox.checked = false;
        headerCheckbox.indeterminate = false;
        headerCheckbox.disabled = true;
        return;
      }

      const checkedCount = Array.from(bodyCheckboxes).filter((box) => box.checked).length;
      headerCheckbox.disabled = false;
      headerCheckbox.checked = checkedCount === bodyCheckboxes.length;
      headerCheckbox.indeterminate = checkedCount > 0 && checkedCount < bodyCheckboxes.length;
    };

    const handleProceedState = () => {
      const checkboxes = getBodyCheckboxes();
      const hasSelection = Array.from(checkboxes).some((box) => box.checked);
      proceedButton.disabled = !hasSelection;
      proceedButton.setAttribute('aria-disabled', String(!hasSelection));
      updateHeaderCheckboxState(checkboxes);
    };

    const attachCheckboxListeners = () => {
      const checkboxes = getBodyCheckboxes();
      checkboxes.forEach((box) => box.addEventListener('change', handleProceedState));
      handleProceedState();
    };

    headerCheckbox?.addEventListener('change', () => {
      const checkboxes = getBodyCheckboxes();
      checkboxes.forEach((box) => {
        box.checked = headerCheckbox.checked;
      });
      handleProceedState();
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
        updateHeaderCheckboxState();
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

    const renderLaunchDataRows = (rows) => {
      tableBody.innerHTML = '';

      if (!rows.length) {
        updateHeaderCheckboxState();
        proceedButton.disabled = true;
        proceedButton.setAttribute('aria-disabled', 'true');
        return;
      }

      rows.forEach(({ subId }) => {
        const row = document.createElement('tr');

        const subIdCell = document.createElement('td');
        subIdCell.dataset.label = 'Sub ID';
        subIdCell.textContent = subId;

        const loadingCell = document.createElement('td');
        loadingCell.dataset.label = 'App ID';
        loadingCell.textContent = 'Loading apps…';

        const placeholderCheckboxCell = document.createElement('td');
        placeholderCheckboxCell.className = 'checkbox-cell';
        placeholderCheckboxCell.textContent = '—';

        row.append(subIdCell, loadingCell, placeholderCheckboxCell);
        tableBody.appendChild(row);
      });

      proceedButton.disabled = true;
      proceedButton.setAttribute('aria-disabled', 'true');
      updateHeaderCheckboxState();
    };

    const fetchAndPopulate = async () => {
      const storedRows = parseStoredLaunchData();

      renderLaunchDataRows(storedRows);

      if (!storedRows.length) {
        showError('API information not found.');
        if (progressBanner) {
          progressBanner.textContent = 'Unable to load apps: missing SubID launch data.';
        }
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

    attachCheckboxListeners();
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

  const initWorkbookUi = () => {
    const form = document.getElementById('workbook-form');
    const envSelect = document.getElementById('env-choice');
    const subIdInput = document.getElementById('subid-input');
    const workbookNameInput = document.getElementById('workbook-name-input');
    const cookieInput = document.getElementById('cookie-input');
    const daysSelect = document.getElementById('days-window');
    const examplesToggle = document.getElementById('examples-toggle');
    const runButton = document.getElementById('workbook-run');
    const workbookName = document.getElementById('workbook-name');
    const endpointPreview = document.getElementById('endpoint-preview');
    const cookiePreview = document.getElementById('cookie-preview');
    const endpointBlock = document.getElementById('endpoint-block');
    const workbookBlock = document.getElementById('workbook-block');

    if (!form || !envSelect || !subIdInput || !cookieInput || !runButton || !workbookNameInput) {
      return;
    }

    runButton.textContent = 'Run workbook';

    const envUrls = {
      eu: 'https://aggregations-dot-pendo-io.gke.eu.pendo.io/api/s/{sub_id}/aggregation?all=true&cachepolicy=all:ignore',
      us: 'https://aggregations-dot-pendo-io.gke.us.pendo.io/api/s/{sub_id}/aggregation?all=true&cachepolicy=all:ignore',
    };

    const messageRegion = document.querySelector('.page-messages') || (() => {
      const region = document.createElement('div');
      region.className = 'page-messages';

      const content = document.querySelector('main.content');
      content?.parentNode?.insertBefore(region, content);

      return region;
    })();

    messageRegion.id = messageRegion.id || 'workbook-messages';

    const ensureChild = (selector, createNode) => {
      const existing = messageRegion.querySelector(selector);
      if (existing) {
        return existing;
      }

      const node = createNode();
      messageRegion.appendChild(node);
      return node;
    };

    const progressIndicator = ensureChild('#workbook-progress', () => {
      const progress = document.createElement('p');
      progress.id = 'workbook-progress';
      progress.className = 'status-banner';
      progress.textContent = 'Waiting to start the workbook run.';
      return progress;
    });

    const errorAlert = ensureChild('#workbook-errors', () => {
      const alert = document.createElement('p');
      alert.id = 'workbook-errors';
      alert.className = 'alert';
      alert.setAttribute('role', 'alert');
      alert.hidden = true;
      return alert;
    });

    const statusSteps = Array.from(document.querySelectorAll('[data-step]')).reduce((acc, element) => {
      const stepId = element.getAttribute('data-step');

      if (!stepId) {
        return acc;
      }

      const pill = element.querySelector('.status-pill');
      const detail = element.querySelector('[data-status-detail]');

      acc[stepId] = {
        element,
        pill,
        detail,
        defaultDetail: detail?.textContent?.trim() || '',
      };

      return acc;
    }, {});

    const setStatus = (stepId, state, detailText) => {
      const step = statusSteps[stepId];

      if (!step) {
        return;
      }

      step.element.dataset.status = state;

      if (step.pill) {
        const labelMap = {
          pending: 'Pending',
          running: 'Running',
          success: 'Done',
          error: 'Error',
          fail: 'Failed',
        };

        step.pill.textContent = labelMap[state] || 'Pending';
      }

      if (step.detail) {
        step.detail.textContent = detailText || step.defaultDetail;
      }
    };

    const resetStatuses = () => {
      Object.keys(statusSteps).forEach((stepId) => setStatus(stepId, 'pending'));
    };

    const setProgress = (message) => {
      if (progressIndicator) {
        progressIndicator.textContent = message;
      }
    };

    const showMessage = (message, tone = 'error') => {
      if (!messageRegion) {
        return;
      }

      if (tone === 'error' && errorAlert) {
        errorAlert.textContent = message;
        errorAlert.hidden = false;
        return;
      }

      setProgress(message);
    };

    const clearMessage = () => {
      if (errorAlert) {
        errorAlert.hidden = true;
        errorAlert.textContent = '';
      }
    };

    const getWorkbookName = () => {
      const subIdValue = subIdInput.value.trim() || '<sub_id>';
      const workbookValue = workbookNameInput.value.trim();

      return workbookValue || `pendo_metadata_${subIdValue}.xlsx`;
    };

    let previewTimeout;

    const applyPreviews = () => {
      const subIdValue = subIdInput.value.trim() || '<sub_id>';
      const envValue = envSelect.value;

      const endpointTemplate = envUrls[envValue];
      const endpointText = endpointTemplate
        ? endpointTemplate.replace('{sub_id}', subIdValue)
        : 'Select an environment to see the URL';

      const workbookLabel = getWorkbookName();

      workbookName.textContent = workbookLabel;
      workbookBlock.textContent = workbookLabel;
      endpointPreview.textContent = endpointText;
      endpointBlock.textContent = endpointText;
      cookiePreview.textContent = cookieInput.value.trim() ? 'Cookie captured locally' : 'Waiting for cookie';

      const ready = Boolean(envValue && subIdInput.value.trim() && cookieInput.value.trim());
      runButton.disabled = !ready;
      runButton.setAttribute('aria-disabled', String(!ready));
    };

    const updatePreviews = () => {
      if (previewTimeout) {
        clearTimeout(previewTimeout);
      }

      previewTimeout = setTimeout(applyPreviews, 150);
    };

    const extractJwtToken = (rawCookie) => {
      const trimmed = rawCookie.trim();

      if (!trimmed) {
        return '';
      }

      const regexMatch = trimmed.match(/pendo\.sess\.jwt2\s*=\s*([^;\s]+)/i);

      if (regexMatch?.[1]) {
        return regexMatch[1].trim();
      }

      if (!trimmed.includes('=')) {
        return trimmed;
      }

      const cookieSegment = trimmed
        .split(';')
        .map((segment) => segment.trim())
        .find((segment) => segment.toLowerCase().startsWith('pendo.sess.jwt2='));

      return cookieSegment?.split('=')[1] || '';
    };

    const ensureArray = (value) => {
      if (!value) {
        return [];
      }

      if (Array.isArray(value)) {
        return value;
      }

      if (typeof value === 'object') {
        return Object.values(value);
      }

      if (typeof value === 'string') {
        return value.split(',').map((entry) => entry.trim());
      }

      return [];
    };

    const extractAppIds = (apiResponse) => {
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

          if (entry?.id) {
            return entry.id;
          }

          return null;
        })
        .filter(Boolean);

      return Array.from(new Set(appIds));
    };

    const normalizeFields = (value) => {
      if (!value) {
        return [];
      }

      if (Array.isArray(value)) {
        return value.map((field) => (typeof field === 'string' ? field : JSON.stringify(field))).filter(Boolean);
      }

      if (typeof value === 'object') {
        return Object.keys(value);
      }

      if (typeof value === 'string') {
        return value.split(',').map((field) => field.trim()).filter(Boolean);
      }

      return [];
    };

    const parseMetadataFields = (response, subId, windowDays) => {
      const rows = [];
      const records = ensureArray(response?.results).length ? ensureArray(response?.results) : ensureArray(response);

      records.forEach((record) => {
        const appId = record?.appId || record?.id || record?.app || 'Unknown app';
        const visitorFields = normalizeFields(record?.visitorFields || record?.visitor || record?.visitorMetadata);
        const accountFields = normalizeFields(record?.accountFields || record?.account || record?.accountMetadata);

        visitorFields.forEach((field) =>
          rows.push({ SubID: subId, AppID: appId, Scope: 'visitor', Field: field, WindowDays: windowDays }),
        );

        accountFields.forEach((field) =>
          rows.push({ SubID: subId, AppID: appId, Scope: 'account', Field: field, WindowDays: windowDays }),
        );
      });

      if (!rows.length && response) {
        rows.push({
          SubID: subId,
          AppID: 'n/a',
          Scope: 'visitor/account',
          Field: 'No fields parsed',
          WindowDays: windowDays,
          Raw: JSON.stringify(response).slice(0, 2000),
        });
      }

      return rows;
    };

    const parseExamples = (response, subId) => {
      const rows = [];
      const records = ensureArray(response?.results).length ? ensureArray(response?.results) : ensureArray(response);

      records.forEach((record) => {
        const appId = record?.appId || record?.id || record?.app || 'Unknown app';
        const examples = ensureArray(record?.examples || record?.metadata || record?.values);

        examples.forEach((example) => {
          const fieldKey = example?.key || example?.field || example?.name || example?.id;
          const exampleValue =
            example?.value !== undefined
              ? example.value
              : example?.example ?? example?.sample ?? JSON.stringify(example ?? {});
          const count = example?.count || example?.total || example?.occurrences || '';

          if (fieldKey) {
            rows.push({
              SubID: subId,
              AppID: appId,
              Field: fieldKey,
              Example: typeof exampleValue === 'string' ? exampleValue : JSON.stringify(exampleValue),
              Count: count,
            });
          }
        });

        if (!examples.length && (record?.visitor || record?.account)) {
          const visitorExamples = record?.visitor || {};
          Object.entries(visitorExamples).forEach(([key, value]) =>
            rows.push({
              SubID: subId,
              AppID: appId,
              Field: key,
              Example: typeof value === 'string' ? value : JSON.stringify(value),
              Count: '',
            }),
          );

          const accountExamples = record?.account || {};
          Object.entries(accountExamples).forEach(([key, value]) =>
            rows.push({
              SubID: subId,
              AppID: appId,
              Field: key,
              Example: typeof value === 'string' ? value : JSON.stringify(value),
              Count: '',
            }),
          );
        }
      });

      if (!rows.length && response) {
        rows.push({
          SubID: subId,
          AppID: 'n/a',
          Field: 'No examples returned',
          Example: 'Examples were requested but no fields were parsed.',
          Count: '',
        });
      }

      return rows;
    };

    let workbookLibsPromise;

    const loadScript = (src, globalName) =>
      new Promise((resolve, reject) => {
        if (globalName && window[globalName]) {
          resolve(window[globalName]);
          return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve(window[globalName]);
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(script);
      });

    const ensureWorkbookLibs = () => {
      if (!workbookLibsPromise) {
        workbookLibsPromise = Promise.all([
          loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', 'XLSX'),
          loadScript('https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js', 'saveAs'),
        ]);
      }

      return workbookLibsPromise;
    };

    const summarizeError = (error) => {
      const rawMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const message = rawMessage || 'Unknown workbook error.';
      const lowered = message.toLowerCase();

      if (lowered.includes('jwt2')) {
        return 'Missing or invalid pendo.sess.jwt2 cookie.';
      }

      if (message.includes('401')) {
        return 'Authentication failed (401). Check the environment and cookie.';
      }

      if (lowered.includes('failed to fetch') || lowered.includes('network')) {
        return 'Network error while contacting the Aggregations API.';
      }

      return message;
    };

    const markStepFailure = (stepId, error, fallbackDetail) => {
      const summary = summarizeError(error);
      const detail = fallbackDetail ? `${fallbackDetail} ${summary}` : summary;

      setStatus(stepId, 'fail', detail);
      showMessage(summary, 'error');
      setProgress(`Workbook failed during ${stepId}: ${summary}`);

      return summary;
    };

    const runWorkbook = async () => {
      if (runButton.disabled) {
        return;
      }

      clearMessage();
      resetStatuses();
      setProgress('Running workbook flow…');
      runButton.textContent = 'Running…';
      runButton.disabled = true;
      runButton.setAttribute('aria-disabled', 'true');

      let lastErrorSummary = '';

      try {
        const envValue = envSelect.value;
        const subIdValue = subIdInput.value.trim();
        const jwtToken = extractJwtToken(cookieInput.value);
        const includeExamples = examplesToggle?.value !== 'off';
        const lookback = Number(daysSelect?.value || '180');

        if (!envValue || !subIdValue || !jwtToken) {
          const summary = !jwtToken
            ? 'Missing pendo.sess.jwt2 cookie. Paste the cookie before running.'
            : 'Please provide an environment and Sub ID.';

          setStatus('env', 'fail', summary);
          showMessage(summary, 'error');
          setProgress(`Workbook failed: ${summary}`);
          throw new Error(summary);
        }

        setStatus('env', 'running', 'Resolving aggregation endpoint…');
        const aggregationUrl = buildAggregationUrl(envUrls, envValue, subIdValue);

        if (!aggregationUrl) {
          const summary = 'Unable to resolve the aggregation URL.';
          setStatus('env', 'fail', summary);
          showMessage(summary, 'error');
          setProgress(`Workbook failed: ${summary}`);
          throw new Error(summary);
        }

        setStatus('env', 'success', aggregationUrl);

        setStatus('apps', 'running', 'Discovering appIds via expandAppIds("*").');
        let appsResponse;

        try {
          appsResponse = await fetchAggregation(aggregationUrl, buildAppDiscoveryPayload(), jwtToken);
        } catch (error) {
          lastErrorSummary = markStepFailure('apps', error, 'App discovery failed.');
          throw error;
        }

        const appIds = extractAppIds(appsResponse);

        if (!appIds.length) {
          const summary = 'No appIds were returned from the aggregation API.';
          setStatus('apps', 'fail', 'No apps returned for this Sub ID.');
          showMessage(summary, 'error');
          setProgress(`Workbook failed: ${summary}`);
          lastErrorSummary = summary;
          throw new Error(summary);
        }

        setStatus('apps', 'success', `Found ${appIds.length} app(s) for ${subIdValue}.`);

        setStatus('fields', 'running', `Requesting metadata fields for 7d${lookback !== 7 ? ` and ${lookback}d` : ''}.`);
        const fieldWindows = [7];
        if (lookback !== 7) {
          fieldWindows.push(lookback);
        }

        const fieldResponses = [];

        for (const windowDays of fieldWindows) {
          try {
            const response = await fetchAggregation(aggregationUrl, buildMetadataFieldsPayload(windowDays), jwtToken);
            fieldResponses.push({ windowDays, response });
          } catch (error) {
            lastErrorSummary = markStepFailure(
              'fields',
              error,
              `Metadata field fetch failed for the ${windowDays} day window.`,
            );
            throw error;
          }
        }

        setStatus('fields', 'success', `Collected metadata fields for ${fieldWindows.join(' & ')} days.`);

        let examplesRows = [];

        if (includeExamples) {
          setStatus('meta', 'running', 'Requesting metadata value examples.');
          try {
            const examplesResponse = await fetchAggregation(aggregationUrl, buildExamplesPayload(), jwtToken);
            examplesRows = parseExamples(examplesResponse, subIdValue);
            setStatus('meta', 'success', `Parsed ${examplesRows.length} example rows.`);
          } catch (error) {
            lastErrorSummary = markStepFailure('meta', error, 'Example metadata fetch failed.');
            throw error;
          }
        } else {
          setStatus('meta', 'success', 'Skipped meta event examples per settings.');
        }

        const fieldsRows = fieldResponses.flatMap(({ windowDays, response }) =>
          parseMetadataFields(response, subIdValue, windowDays),
        );

        setStatus('excel', 'running', 'Building workbook…');
        await ensureWorkbookLibs();

        const workbook = XLSX.utils.book_new();

        const fieldsSheet = XLSX.utils.json_to_sheet(
          fieldsRows.length ? fieldsRows : [{ Note: 'No metadata fields returned from the Aggregations API.' }],
        );
        XLSX.utils.book_append_sheet(workbook, fieldsSheet, 'Fields');

        const examplesSheet = XLSX.utils.json_to_sheet(
          includeExamples
            ? examplesRows.length
              ? examplesRows
              : [{ Note: 'Examples were requested but no values were parsed.' }]
            : [{ Note: 'Examples were skipped per settings.' }],
        );
        XLSX.utils.book_append_sheet(workbook, examplesSheet, 'Examples');

        const workbookLabel = getWorkbookName();
        const workbookArray = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        saveAs(
          new Blob([workbookArray], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
          workbookLabel,
        );

        setStatus('excel', 'success', `Workbook ready: ${workbookLabel}`);
        showMessage(`Workbook downloaded as ${workbookLabel}.`, 'info');
        setProgress(`Workbook downloaded as ${workbookLabel}.`);
      } catch (error) {
        console.error('Workbook run failed:', error);
        const message = summarizeError(error);
        lastErrorSummary = lastErrorSummary || message;
        showMessage(message, 'error');
        setProgress(`Workbook failed: ${message}`);

        ['env', 'apps', 'fields', 'meta', 'excel'].forEach((stepId) => {
          const step = statusSteps[stepId];
          if (step?.element.dataset.status === 'running' || step?.element.dataset.status === 'pending') {
            setStatus(stepId, 'fail', message);
          }
        });
      } finally {
        const truncatedError = lastErrorSummary && lastErrorSummary.length > 90
          ? `${lastErrorSummary.slice(0, 87)}…`
          : lastErrorSummary;

        runButton.textContent = truncatedError ? `Retry run (${truncatedError})` : 'Run workbook';

        if (truncatedError) {
          runButton.setAttribute('aria-label', `Retry workbook run. Last error: ${truncatedError}`);
        } else {
          runButton.removeAttribute('aria-label');
        }
        runButton.disabled = false;
        runButton.setAttribute('aria-disabled', 'false');
        updatePreviews();
      }
    };

    [envSelect, subIdInput, workbookNameInput, cookieInput, daysSelect, examplesToggle].forEach((element) =>
      element?.addEventListener('input', updatePreviews),
    );

    runButton.addEventListener('click', (event) => {
      event.preventDefault();
      runWorkbook();
    });

    updatePreviews();
  };

  initSubIdForm();
  initAppSelection();
  initDeepDiveNavigation();
  initWorkbookUi();

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
