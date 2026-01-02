// Manage the regex format modal lifecycle for expected value configuration.
let regexFormatModalBound = false;
let regexSaveHandler = null;

// Collect references to regex modal nodes.
const getRegexModalElements = () => {
  return {
    modal: document.getElementById('regex-format-modal'),
    backdrop: document.getElementById('regex-format-backdrop'),
    title: document.getElementById('regex-format-modal-title'),
    subId: document.getElementById('regex-format-sub-id'),
    appId: document.getElementById('regex-format-app-id'),
    field: document.getElementById('regex-format-field'),
    feedback: document.getElementById('regex-format-modal-feedback'),
    form: document.getElementById('regex-format-modal-form'),
    input: document.getElementById('regex-format-input'),
  };
};

// Load the regex modal template into the DOM if it is not present yet.
const loadRegexModal = async () => {
  const existingElements = getRegexModalElements();

  if (existingElements.modal && existingElements.backdrop) {
    return existingElements;
  }

  const modalUrl = new URL('../html/regex.html', import.meta.url);
  const response = await fetch(modalUrl, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error('Unable to load regex modal.');
  }

  const template = document.createElement('template');
  template.innerHTML = (await response.text()).trim();
  document.body.appendChild(template.content);

  return getRegexModalElements();
};

// Reset regex modal inputs and feedback.
const resetRegexModal = () => {
  const { form, feedback, input } = getRegexModalElements();

  if (form) {
    form.reset();
  }

  if (feedback) {
    feedback.textContent = '';
  }

  if (input) {
    input.value = '';
  }

  regexSaveHandler = null;
};

// Track the callback to run when a regex is saved.
const setRegexSaveHandler = (saveHandler) => {
  regexSaveHandler = typeof saveHandler === 'function' ? saveHandler : null;
};

// Hide the regex modal and clear its context.
const closeRegexModal = () => {
  const { modal, backdrop } = getRegexModalElements();

  if (!modal || !backdrop) {
    return;
  }

  modal.classList.remove('is-visible');
  backdrop.classList.remove('is-visible');
  modal.hidden = true;
  backdrop.hidden = true;
  resetRegexModal();
};

// Wire submit and dismiss events for the regex modal.
const bindRegexModalHandlers = () => {
  const { modal, backdrop, form, feedback, input } = getRegexModalElements();

  if (!modal || !backdrop) {
    return;
  }

  const closeButtons = modal.querySelectorAll('[data-close-regex-format-modal]');
  closeButtons.forEach((button) => {
    button.addEventListener('click', () => closeRegexModal());
  });

  backdrop.addEventListener('click', () => closeRegexModal());

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();

      const pattern = (input?.value || '').trim();

      if (!pattern) {
        if (feedback) {
          feedback.textContent = 'Enter a regex pattern to save.';
        }

        return;
      }

      try {
        // Validate the regex pattern without executing it.
        // eslint-disable-next-line no-new
        new RegExp(pattern);
      } catch (error) {
        if (feedback) {
          feedback.textContent = 'Enter a valid regular expression.';
        }

        return;
      }

      if (feedback) {
        feedback.textContent = 'Saved regex pattern.';
      }

      if (typeof regexSaveHandler === 'function') {
        regexSaveHandler(pattern);
      }

      closeRegexModal();
    });
  }

  regexFormatModalBound = true;
};

// Fill modal labels with the current field context.
const setRegexModalContext = (fieldName, existingPattern = '') => {
  const { title, subId, appId, field, feedback, input } = getRegexModalElements();
  const resolvedFieldName = fieldName || 'Unknown field';

  if (title) {
    title.textContent = resolvedFieldName;
  }

  if (subId) {
    subId.textContent = 'N/A';
  }

  if (appId) {
    appId.textContent = 'N/A';
  }

  if (field) {
    field.textContent = resolvedFieldName;
  }

  if (feedback) {
    feedback.textContent = '';
  }

  if (input) {
    input.value = existingPattern || '';
  }
};

// Load and display the regex modal for the supplied field.
export const openRegexModal = async (fieldName = '', existingPattern = '', onSave = null) => {
  try {
    const elements = await loadRegexModal();

    if (!regexFormatModalBound) {
      bindRegexModalHandlers();
    }

    setRegexSaveHandler(onSave);
    setRegexModalContext(fieldName, existingPattern);

    elements.modal.hidden = false;
    elements.backdrop.hidden = false;
    elements.modal.classList.add('is-visible');
    elements.backdrop.classList.add('is-visible');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Unable to open regex modal.', error);
  }
};

export const __test_only__ = {
  closeRegexModal,
  loadRegexModal,
  resetRegexModal,
  setRegexModalContext,
};
