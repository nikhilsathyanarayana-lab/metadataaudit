// Modal setup for app-name editing and regex format validation within the deep dive UI.
import { loadTemplate } from '../../../controllers/modalLoader.js';
import { setManualAppName } from '../../../services/appNames.js';
import { applyBannerTone, setBannerText } from '../../../ui/statusBanner.js';

const updateRegexFeedback = (tone, message) => {
  const feedback = document.getElementById('regex-format-modal-feedback');

  if (!feedback) {
    return;
  }

  setBannerText(feedback, message);
  applyBannerTone(feedback, tone);
};

export const setupRegexFormatModal = async () => {
  if (!document.getElementById('regex-format-modal')) {
    await loadTemplate('Modals/regex-format-modal.html');
  }

  const modal = document.getElementById('regex-format-modal');
  const backdrop = document.getElementById('regex-format-backdrop');
  const form = document.getElementById('regex-format-modal-form');
  const regexInput = document.getElementById('regex-format-input');
  const appIdTarget = document.getElementById('regex-format-app-id');
  const appNameTarget = document.getElementById('regex-format-app-name');
  const fieldTarget = document.getElementById('regex-format-field');
  const subIdTarget = document.getElementById('regex-format-sub-id');
  const closeButtons = modal?.querySelectorAll('[data-close-regex-format-modal]') || [];

  if (!modal || !backdrop || !form || !regexInput || !appIdTarget || !fieldTarget) {
    return () => {};
  }

  let activeContext = null;

  const closeModal = (focusButton = true) => {
    modal.classList.remove('is-visible');
    backdrop.classList.remove('is-visible');
    modal.hidden = true;
    backdrop.hidden = true;
    form.reset();

    if (focusButton && activeContext?.select) {
      activeContext.select.focus();
    }

    activeContext = null;
  };

  const openRegexModal = (context) => {
    activeContext = context;

    appIdTarget.textContent = context?.appId || 'Unknown app ID';

    if (appNameTarget) {
      appNameTarget.textContent = context?.appName || 'Unknown app name';
    }

    if (fieldTarget) {
      fieldTarget.textContent = context?.fieldName || 'Unknown field';
    }

    if (subIdTarget) {
      subIdTarget.textContent = context?.subId || 'Unknown Sub ID';
    }

    regexInput.value = context?.select?.dataset?.regexPattern || '';

    updateRegexFeedback('info', 'Enter a JavaScript regular expression for this field.');
    modal.hidden = false;
    backdrop.hidden = false;
    modal.classList.add('is-visible');
    backdrop.classList.add('is-visible');
    regexInput.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!activeContext) {
      updateRegexFeedback('error', 'Select an expected format to configure regex.');
      return;
    }

    const pattern = regexInput.value.trim();

    if (!pattern) {
      updateRegexFeedback('error', 'Provide a regex pattern.');
      return;
    }

    try {
      // Validate the regex pattern without executing it.
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch (error) {
      updateRegexFeedback('error', 'Enter a valid regular expression.');
      return;
    }

    activeContext.select.dataset.regexPattern = pattern;
    activeContext.select.value = 'regex';
    activeContext.select.dataset.previousValue = 'regex';
    activeContext.select.title = `Regex pattern: ${pattern}`;

    closeModal(false);
  };

  const handleCancel = () => closeModal(true);

  form.addEventListener('submit', handleSubmit);
  backdrop.addEventListener('click', handleCancel);
  closeButtons.forEach((button) => button.addEventListener('click', handleCancel));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-visible')) {
      closeModal();
    }
  });

  return openRegexModal;
};

const updateManualAppNameFeedback = (tone, message) => {
  const feedback = document.getElementById('app-name-modal-feedback');

  if (!feedback) {
    return;
  }

  setBannerText(feedback, message);
  applyBannerTone(feedback, tone);
};

export const setupManualAppNameModal = async (manualAppNames, rows, getRenderedRows, syncAppName) => {
  if (!document.getElementById('app-name-modal')) {
    await loadTemplate('Modals/app-name-modal.html');
  }

  const modal = document.getElementById('app-name-modal');
  const backdrop = document.getElementById('app-name-backdrop');
  const form = document.getElementById('app-name-modal-form');
  const appIdTarget = document.getElementById('app-name-modal-app-id');
  const appNameInput = document.getElementById('app-name-modal-input');
  const closeButtons = modal?.querySelectorAll('[data-close-app-name-modal]') || [];

  if (!modal || !backdrop || !form || !appIdTarget || !appNameInput) {
    return () => {};
  }

  let activeRow = null;

  const closeModal = () => {
    modal.classList.remove('is-visible');
    backdrop.classList.remove('is-visible');
    modal.hidden = true;
    backdrop.hidden = true;
    form.reset();
    activeRow = null;
    updateManualAppNameFeedback('info', '');
  };

  const openModal = (rowData) => {
    activeRow = rowData;
    appIdTarget.textContent = rowData?.appId || '';
    const existingName =
      getManualAppName(manualAppNames, rowData?.subId, rowData?.appId) || rowData?.appName || '';
    appNameInput.value = existingName;
    updateManualAppNameFeedback('info', existingName ? 'Update the app name if needed.' : 'Enter an app name.');

    modal.hidden = false;
    backdrop.hidden = false;
    modal.classList.add('is-visible');
    backdrop.classList.add('is-visible');
    appNameInput.focus();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!activeRow) {
      updateManualAppNameFeedback('error', 'Select a row to set an app name.');
      return;
    }

    const appName = appNameInput.value.trim();

    if (!appName) {
      updateManualAppNameFeedback('error', 'Provide an App Name.');
      return;
    }

    setManualAppName(manualAppNames, activeRow.appId, appName, activeRow.subId);

    if (typeof syncAppName === 'function') {
      await syncAppName(activeRow.appId, appName, activeRow.subId);
    }

    rows
      .filter((row) => row.appId === activeRow.appId && row.subId === activeRow.subId)
      .forEach((row) => {
        row.appName = appName;
      });

    const renderedRows = typeof getRenderedRows === 'function' ? getRenderedRows() : [];
    renderedRows
      .filter(({ rowData }) => rowData.appId === activeRow.appId && rowData.subId === activeRow.subId)
      .forEach(({ rowData, appNameButton, appIdCell }) => {
        rowData.appName = appName;

        if (appNameButton) {
          appNameButton.textContent = appName || 'Not set';
        }

        if (appIdCell) {
          appIdCell.title = appName ? `App name: ${appName}` : '';
        }
      });

    updateManualAppNameFeedback('info', `Saved app name for ${activeRow.appId}.`);
    closeModal();
  };

  form.addEventListener('submit', handleSubmit);
  backdrop.addEventListener('click', closeModal);
  closeButtons.forEach((button) => button.addEventListener('click', closeModal));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal.classList.contains('is-visible')) {
      closeModal();
    }
  });

  return openModal;
};
