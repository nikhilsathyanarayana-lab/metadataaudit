import { getSubscriptionLabel, setSubscriptionLabels } from './subscriptionLabels.js';

const NAV_TEMPLATE_PATH = 'SPA/html/nav.html';
const DEBUG_FLAG = 'DEBUG_LOGGING';
const LEGACY_DEBUG_FLAG = 'DEBUG_DEEP_DIVE';
const CREDENTIAL_STATE_EVENT = 'spa-credentials-changed';
const LABELS_UPDATED_EVENT = 'spa-subid-labels-updated';

// Fetch the SPA navigation markup from the HTML partial.
const fetchNavMarkup = async () => {
  const response = await fetch(NAV_TEMPLATE_PATH, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`Unable to load SPA navigation: ${response.status}`);
  }

  return response.text();
};

// Mark the matching navigation link as the current page.
const setActiveLink = (navElement, activePage) => {
  if (!activePage) {
    return;
  }

  const activeLink = navElement.querySelector(`[data-nav-id="${activePage}"]`);

  if (activeLink) {
    activeLink.setAttribute('aria-current', 'page');
  }
};

// Collect non-empty SubIDs from credential entries.
const getSubIdsFromCredentials = (entries = []) => {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .map((entry) => String(entry?.subId || '').trim())
    .filter((subId) => Boolean(subId));
};

// Build and cache the label modal element.
const ensureLabelsModal = () => {
  let backdrop = document.getElementById('nav-subid-labels-backdrop');
  let modal = document.getElementById('nav-subid-labels-modal');

  if (backdrop && modal) {
    return { backdrop, modal };
  }

  backdrop = document.createElement('div');
  backdrop.id = 'nav-subid-labels-backdrop';
  backdrop.className = 'modal-backdrop nav-labels-backdrop';

  modal = document.createElement('div');
  modal.id = 'nav-subid-labels-modal';
  modal.className = 'modal nav-labels-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'nav-subid-labels-title');

  modal.innerHTML = `
    <div class="modal-content nav-labels-content" id="nav-labels-content">
      <div class="modal-header nav-labels-header" id="nav-labels-header">
        <div class="nav-labels-header-copy" id="nav-labels-header-copy">
          <p class="eyebrow nav-labels-eyebrow" id="nav-labels-eyebrow">SubID Labels</p>
          <h2 class="modal-title" id="nav-subid-labels-title">Manage SubID labels</h2>
        </div>
        <button type="button" class="close-btn nav-labels-close" id="nav-labels-close-btn" aria-label="Close SubID label editor">&times;</button>
      </div>
      <div class="modal-body nav-labels-body" id="nav-labels-body"></div>
      <div class="modal-actions nav-labels-actions" id="nav-labels-actions">
        <button type="button" class="secondary-btn nav-labels-cancel-btn" id="nav-labels-cancel-btn">Cancel</button>
        <button type="button" class="primary-btn nav-labels-save-btn" id="nav-labels-save-btn">Save labels</button>
      </div>
    </div>
  `;

  document.body.append(backdrop, modal);

  return { backdrop, modal };
};

// Show or hide the label management button based on available SubIDs.
const syncLabelsButtonState = (button, subIds = []) => {
  if (!button) {
    return;
  }

  const hasSubIds = Array.isArray(subIds) && subIds.length > 0;
  button.disabled = !hasSubIds;
  button.hidden = !hasSubIds;
  button.setAttribute('aria-disabled', hasSubIds ? 'false' : 'true');
};

// Render one editable label row for each SubID.
const renderLabelInputs = (modalElement, subIds = []) => {
  const body = modalElement.querySelector('#nav-labels-body');

  if (!body) {
    return;
  }

  body.innerHTML = '';

  subIds.forEach((subId, index) => {
    const row = document.createElement('div');
    row.className = 'nav-label-row';
    row.id = `nav-label-row-${index + 1}`;

    const label = document.createElement('label');
    label.className = 'nav-label-input-label';
    label.id = `nav-label-input-label-${index + 1}`;
    label.setAttribute('for', `nav-label-input-${index + 1}`);
    label.textContent = subId;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text-input nav-label-input';
    input.id = `nav-label-input-${index + 1}`;
    input.dataset.subId = subId;
    input.placeholder = `Label for ${subId}`;
    input.value = getSubscriptionLabel(subId) === subId ? '' : getSubscriptionLabel(subId);

    row.append(label, input);
    body.appendChild(row);
  });
};

// Toggle visibility for the SubID label modal and backdrop.
const setLabelModalVisibility = (visible, modal, backdrop) => {
  modal.classList.toggle('is-visible', visible);
  backdrop.classList.toggle('is-visible', visible);
};

// Persist modal input values into the in-memory label store.
const saveLabelInputs = (modal) => {
  const labelInputs = modal.querySelectorAll('.nav-label-input');
  const labelPayload = {};

  labelInputs.forEach((input) => {
    labelPayload[input.dataset.subId] = input.value;
  });

  setSubscriptionLabels(labelPayload);
  document.dispatchEvent(new CustomEvent(LABELS_UPDATED_EVENT));
};

// Wire the SubID label manager button and modal interactions.
const initSubIdLabelManager = (navElement) => {
  const labelsButton = navElement.querySelector('#nav-labels-btn');

  if (!labelsButton) {
    return;
  }

  let currentSubIds = getSubIdsFromCredentials(window?.appCredentials || []);
  syncLabelsButtonState(labelsButton, currentSubIds);

  const { backdrop, modal } = ensureLabelsModal();
  const closeButton = modal.querySelector('#nav-labels-close-btn');
  const cancelButton = modal.querySelector('#nav-labels-cancel-btn');
  const saveButton = modal.querySelector('#nav-labels-save-btn');

  const closeModal = () => {
    setLabelModalVisibility(false, modal, backdrop);
  };

  labelsButton.addEventListener('click', () => {
    if (!currentSubIds.length) {
      return;
    }

    renderLabelInputs(modal, currentSubIds);
    setLabelModalVisibility(true, modal, backdrop);
  });

  closeButton?.addEventListener('click', closeModal);
  cancelButton?.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);

  saveButton?.addEventListener('click', () => {
    saveLabelInputs(modal);
    closeModal();
  });

  document.addEventListener(CREDENTIAL_STATE_EVENT, (event) => {
    const entries = event?.detail?.entries || [];
    currentSubIds = getSubIdsFromCredentials(entries);
    syncLabelsButtonState(labelsButton, currentSubIds);

    if (!currentSubIds.length) {
      closeModal();
    }
  });
};

// Update debug toggle visuals without changing global state.
const updateDebugToggleUi = (enabled, toggleControl, statusTarget) => {
  if (toggleControl) {
    toggleControl.classList.toggle('is-enabled', enabled);
  }

  if (statusTarget) {
    statusTarget.textContent = enabled ? 'On' : 'Off';
  }
};

// Apply debug mode and synchronize UI state.
const setDebugModeEnabled = (enabled, toggleControl, statusTarget) => {
  if (typeof window !== 'undefined') {
    window[DEBUG_FLAG] = enabled;
    window[LEGACY_DEBUG_FLAG] = enabled;
    window.dispatchEvent(new CustomEvent('debug-mode-changed', { detail: { enabled } }));
  }

  updateDebugToggleUi(enabled, toggleControl, statusTarget);
};

// Initialize the debug toggle in the SPA navigation.
const initSpaDebugToggle = (navElement) => {
  const toggle = navElement?.querySelector('#debug-toggle');
  const toggleControl = navElement?.querySelector('#debug-toggle-control');
  const statusTarget = navElement?.querySelector('#debug-toggle-status');

  if (!toggle) {
    return;
  }

  const initialState =
    typeof window !== 'undefined' && typeof window[DEBUG_FLAG] === 'boolean'
      ? Boolean(window[DEBUG_FLAG])
      : typeof window !== 'undefined' && typeof window[LEGACY_DEBUG_FLAG] === 'boolean'
        ? Boolean(window[LEGACY_DEBUG_FLAG])
      : false;

  toggle.checked = initialState;
  updateDebugToggleUi(initialState, toggleControl, statusTarget);

  toggle.addEventListener('change', (event) => {
    setDebugModeEnabled(Boolean(event.target.checked), toggleControl, statusTarget);
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('debug-mode-changed', (event) => {
      const enabled = Boolean(event?.detail?.enabled);
      toggle.checked = enabled;
      updateDebugToggleUi(enabled, toggleControl, statusTarget);
    });
  }
};

// Render the SPA navigation bar into the target element.
export const renderSpaNavigation = async (targetSelector = '#nav-root', options = {}) => {
  const target = document.querySelector(targetSelector);

  if (!target) {
    return;
  }

  const { activePage } = options;
  const markup = await fetchNavMarkup();
  const template = document.createElement('template');
  template.innerHTML = markup.trim();

  const navElement = template.content.firstElementChild;

  if (!navElement) {
    throw new Error('Navigation template did not return valid markup.');
  }

  setActiveLink(navElement, activePage);
  initSpaDebugToggle(navElement);
  initSubIdLabelManager(navElement);
  target.replaceChildren(navElement);
};
