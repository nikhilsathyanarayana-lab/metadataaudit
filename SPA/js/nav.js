import { loadTestDataset } from './testDataLoader.js';

const NAV_TEMPLATE_PATH = 'SPA/html/nav.html';
const DEBUG_FLAG = 'DEBUG_LOGGING';
const LEGACY_DEBUG_FLAG = 'DEBUG_DEEP_DIVE';

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

// Show or hide the test data button based on debug mode.
const updateTestDataVisibility = (button, enabled) => {
  if (!button) {
    return;
  }

  button.hidden = !enabled;
};

// Update debug toggle visuals without changing global state.
const updateDebugToggleUi = (enabled, toggleControl, statusTarget, testDataButton) => {
  if (toggleControl) {
    toggleControl.classList.toggle('is-enabled', enabled);
  }

  if (statusTarget) {
    statusTarget.textContent = enabled ? 'On' : 'Off';
  }

  updateTestDataVisibility(testDataButton, enabled);
};

// Apply debug mode and synchronize UI state.
const setDebugModeEnabled = (enabled, toggleControl, statusTarget, testDataButton) => {
  if (typeof window !== 'undefined') {
    window[DEBUG_FLAG] = enabled;
    window[LEGACY_DEBUG_FLAG] = enabled;
    window.dispatchEvent(new CustomEvent('debug-mode-changed', { detail: { enabled } }));
  }

  updateDebugToggleUi(enabled, toggleControl, statusTarget, testDataButton);
};

// Load the default test dataset and signal listeners to refresh.
const handleTestDataLoad = () => {
  loadTestDataset();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('test-data-loaded'));
  }
};

// Initialize the debug toggle and test data button in the SPA navigation.
const initSpaDebugToggle = (navElement) => {
  const toggle = navElement?.querySelector('#debug-toggle');
  const toggleControl = navElement?.querySelector('#debug-toggle-control');
  const statusTarget = navElement?.querySelector('#debug-toggle-status');
  const testDataButton = navElement?.querySelector('#debug-test-data-button');

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
  updateDebugToggleUi(initialState, toggleControl, statusTarget, testDataButton);

  toggle.addEventListener('change', (event) => {
    setDebugModeEnabled(Boolean(event.target.checked), toggleControl, statusTarget, testDataButton);
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('debug-mode-changed', (event) => {
      const enabled = Boolean(event?.detail?.enabled);
      toggle.checked = enabled;
      updateDebugToggleUi(enabled, toggleControl, statusTarget, testDataButton);
    });
  }

  if (testDataButton) {
    testDataButton.addEventListener('click', handleTestDataLoad);
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
  target.replaceChildren(navElement);
};
