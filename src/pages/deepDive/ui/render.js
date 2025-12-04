// UI helpers for rendering deep dive tables, headers, and on-page feedback.
import { LOOKBACK_OPTIONS, TARGET_LOOKBACK, logDeepDive } from '../constants.js';

export const createEmptyRow = (tableBody, message) => {
  const row = document.createElement('tr');
  const emptyCell = document.createElement('td');
  emptyCell.colSpan = 5;
  emptyCell.textContent = message;
  row.appendChild(emptyCell);
  tableBody.appendChild(row);
};

export const updateMetadataFieldHeaders = (lookback) => {
  const label = `Metadata field (${lookback} days)`;

  document.querySelectorAll('.metadata-field-header').forEach((header) => {
    header.textContent = label;
  });
};

export const buildAppNameCell = (rowData, openModal) => {
  const cell = document.createElement('td');
  cell.dataset.label = 'App Name';

  const appNameButton = document.createElement('button');
  appNameButton.type = 'button';
  appNameButton.className = 'app-name-button';
  appNameButton.dataset.appId = rowData.appId;
  appNameButton.textContent = rowData.appName || 'Not set';
  appNameButton.setAttribute('aria-label', `Set app name for ${rowData.appId}`);

  if (typeof openModal === 'function') {
    appNameButton.addEventListener('click', () => openModal(rowData));
  }

  cell.appendChild(appNameButton);
  return { cell, appNameButton };
};

const REGEX_FORMAT_OPTION = 'regex';
const DEFAULT_FORMAT_OPTION = 'unknown';
const FORMAT_OPTIONS = ['email', 'text', REGEX_FORMAT_OPTION, 'number', DEFAULT_FORMAT_OPTION];

export const buildFormatSelect = (appId, subId, appName, fieldName, onRegexSelected) => {
  const select = document.createElement('select');
  select.className = 'format-select';
  const labelParts = [`Sub ID ${subId || 'unknown'}`, `App ID ${appId}`];
  if (appName) {
    labelParts.push(`(${appName})`);
  }
  if (fieldName) {
    labelParts.push(`Field ${fieldName}`);
  }
  select.setAttribute('aria-label', `Expected format for ${labelParts.join(' ')}`);

  FORMAT_OPTIONS.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value.charAt(0).toUpperCase() + value.slice(1);
    select.appendChild(option);
  });

  select.value = DEFAULT_FORMAT_OPTION;
  select.dataset.previousValue = DEFAULT_FORMAT_OPTION;

  select.addEventListener('change', () => {
    const selectedValue = select.value;

    if (selectedValue === REGEX_FORMAT_OPTION) {
      const previousValue = select.dataset.previousValue || DEFAULT_FORMAT_OPTION;
      select.value = previousValue;

      if (typeof onRegexSelected === 'function') {
        onRegexSelected({
          appId,
          appName,
          fieldName,
          select,
          subId,
          previousValue,
        });
      }

      return;
    }

    select.dataset.regexPattern = '';
    select.dataset.previousValue = selectedValue;
    select.title = '';
  });

  return select;
};

export const renderTable = (tableBody, rows, type, openModal, openRegexModal, lookback) => {
  tableBody.innerHTML = '';

  if (!rows.length) {
    createEmptyRow(tableBody, 'No deep-dive data available. Run metadata requests first.');
    return [];
  }

  const renderedRows = [];

  rows.forEach((rowData) => {
    const fields = type === 'visitor' ? rowData.visitorFields : rowData.accountFields;
    const hasFields = Array.isArray(fields) && fields.length;
    const fieldsToRender = hasFields
      ? fields
      : [`No metadata fields captured for ${lookback} days`];

    fieldsToRender.forEach((fieldName, index) => {
      const row = document.createElement('tr');
      const subIdCell = document.createElement('td');
      subIdCell.dataset.label = 'Sub ID';
      subIdCell.textContent = rowData.subId || 'Unknown';

      const appIdCell = document.createElement('td');
      appIdCell.dataset.label = 'App ID';
      appIdCell.textContent = rowData.appId;
      if (rowData.appName) {
        appIdCell.title = `App name: ${rowData.appName}`;
      }

      const { cell: appNameCell, appNameButton } = buildAppNameCell(rowData, openModal);

      row.appendChild(subIdCell);
      row.appendChild(appNameCell);
      row.appendChild(appIdCell);

      const fieldsCell = document.createElement('td');
      fieldsCell.dataset.label = `Metadata field (${lookback} days)`;
      fieldsCell.textContent = fieldName;
      row.appendChild(fieldsCell);

      const formatCell = document.createElement('td');
      formatCell.dataset.label = 'Expected format';

      if (hasFields) {
        formatCell.appendChild(
          buildFormatSelect(
            rowData.appId,
            rowData.subId,
            rowData.appName,
            fieldName,
            openRegexModal,
          ),
        );
      } else {
        formatCell.textContent = index === 0 ? 'N/A' : '';
      }

      row.appendChild(formatCell);

      tableBody.appendChild(row);

      renderedRows.push({ rowData, appNameButton, appIdCell });
    });
  });

  return renderedRows;
};

export const setupLookbackControls = (onChange, initialLookback = TARGET_LOOKBACK) => {
  const controls = document.getElementById('deep-dive-lookback-controls');
  const buttons = controls?.querySelectorAll('[data-lookback-button]') || [];
  let activeLookback = LOOKBACK_OPTIONS.includes(initialLookback)
    ? initialLookback
    : TARGET_LOOKBACK;

  const applyState = (nextLookback) => {
    buttons.forEach((button) => {
      const buttonLookback = Number.parseInt(button.dataset.lookback, 10);
      const isUnavailable = button.hasAttribute('data-unavailable');
      const isActive = buttonLookback === nextLookback;

      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));

      if (isUnavailable) {
        button.classList.add('is-disabled');
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        return;
      }

      button.disabled = isActive;
    });
  };

  applyState(activeLookback);

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.disabled || button.hasAttribute('data-unavailable')) {
        return;
      }

      const nextLookback = Number.parseInt(button.dataset.lookback, 10);

      if (!LOOKBACK_OPTIONS.includes(nextLookback) || nextLookback === activeLookback) {
        return;
      }

      activeLookback = nextLookback;
      applyState(activeLookback);
      onChange?.(activeLookback);
    });
  });

  return activeLookback;
};

export const ensureMessageRegion = () => {
  const existing = document.getElementById('deep-dive-messages');
  if (existing) {
    return existing;
  }

  const region = document.createElement('div');
  region.id = 'deep-dive-messages';
  region.className = 'page-messages';

  const mainContent = document.querySelector('main.content');
  if (mainContent?.parentNode) {
    mainContent.parentNode.insertBefore(region, mainContent);
  } else if (document.body) {
    document.body.insertBefore(region, document.body.firstChild);
  }
  return region;
};

export const showMessage = (region, message, tone = 'info') => {
  if (!region) {
    return;
  }

  region.innerHTML = '';

  if (!message) {
    return;
  }

  const alert = document.createElement('p');
  alert.className = tone === 'error' ? 'alert' : 'status-banner';
  alert.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  alert.textContent = message;

  region.appendChild(alert);
};

export const reportDeepDiveError = (message, error, region = null) => {
  logDeepDive('error', message, error);

  if (region) {
    showMessage(region, message, 'error');
    return;
  }

  const processingProgressText = document.getElementById('deep-dive-processing-progress');
  const apiProgressText = document.getElementById('deep-dive-api-progress');
  const fallbackTarget = processingProgressText || apiProgressText;

  if (fallbackTarget) {
    fallbackTarget.textContent = message;
    fallbackTarget.setAttribute('role', 'alert');
  }
};

let deepDiveGlobalErrorHandlersInstalled = false;
export const installDeepDiveGlobalErrorHandlers = () => {
  if (deepDiveGlobalErrorHandlersInstalled || typeof window === 'undefined') {
    return;
  }

  const handleError = (error) => {
    reportDeepDiveError(
      'An unexpected error occurred while loading the deep dive page. Please refresh and try again.',
      error,
    );
  };

  window.addEventListener('error', (event) => {
    handleError(event?.error ?? event?.message ?? event);
  });

  window.addEventListener('unhandledrejection', (event) => {
    handleError(event?.reason ?? event);
  });

  deepDiveGlobalErrorHandlersInstalled = true;
};

export const setExportAvailability = (enabled) => {
  const exportButton = document.getElementById('export-button');

  if (!exportButton) {
    return;
  }

  exportButton.disabled = !enabled;
  exportButton.setAttribute('aria-disabled', String(!enabled));
};

export const setupProgressTracker = () => {
  const apiProgressText = document.getElementById('deep-dive-api-progress');
  const processingProgressText = document.getElementById('deep-dive-processing-progress');

  const setTone = (target, tone = 'info') => {
    if (!target) {
      return;
    }

    target.classList.toggle('is-error', tone === 'error');
    target.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  };

  const setApiStatus = (message, tone = 'info') => {
    if (!apiProgressText) {
      return;
    }

    apiProgressText.textContent = message;
    setTone(apiProgressText, tone);
  };

  const setProcessingStatus = (message, tone = 'info') => {
    if (!processingProgressText) {
      return;
    }

    processingProgressText.textContent = message;
    setTone(processingProgressText, tone);
  };

  const updateApiProgress = (completed = 0, total = 0) => {
    if (!total) {
      setApiStatus('No API calls queued.');
      return;
    }

    const boundedCompleted = Math.min(completed, total);
    const remaining = Math.max(total - boundedCompleted, 0);
    setApiStatus(`API calls: ${boundedCompleted}/${total} (${remaining} left)`);
  };

  const updateProcessingProgress = (completed = 0, total = 0) => {
    if (!total) {
      setProcessingStatus('Processing queue idle.');
      return;
    }

    const boundedCompleted = Math.min(completed, total);
    const remaining = Math.max(total - boundedCompleted, 0);
    setProcessingStatus(`Processing results: ${boundedCompleted}/${total} (${remaining} remaining)`);
  };

  updateApiProgress(0, 0);
  updateProcessingProgress(0, 0);

  const setApiError = (message) => setApiStatus(message || 'API call failed.', 'error');
  const setProcessingError = (message) =>
    setProcessingStatus(message || 'Processing failed.', 'error');

  return {
    updateApiProgress,
    updateProcessingProgress,
    setApiStatus,
    setProcessingStatus,
    setApiError,
    setProcessingError,
  };
};
