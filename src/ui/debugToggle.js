import { createLogger } from '../utils/logger.js';

const DEBUG_FLAG = 'DEBUG_DEEP_DIVE';
const STORAGE_KEY = 'deepDiveDebugEnabled';

const toggleLogger = createLogger('DebugToggle');

const updateStatusText = (statusTarget, enabled) => {
  if (statusTarget) {
    statusTarget.textContent = enabled ? 'On' : 'Off';
  }
};

const applyPersistedPreference = (enabled) => {
  try {
    if (enabled) {
      sessionStorage.setItem(STORAGE_KEY, 'true');
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    toggleLogger.error('Unable to persist debug toggle preference.', error);
  }
};

const readPersistedPreference = () => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch (error) {
    toggleLogger.error('Unable to read debug toggle preference.', error);
    return false;
  }
};

const applyDebugState = (enabled, toggleControl, statusTarget) => {
  if (typeof window !== 'undefined') {
    window[DEBUG_FLAG] = enabled;
  }

  if (toggleControl) {
    toggleControl.classList.toggle('is-enabled', enabled);
  }

  updateStatusText(statusTarget, enabled);
  applyPersistedPreference(enabled);
};

export const initDebugToggle = () => {
  const toggle = document.getElementById('debug-toggle');
  const toggleControl = document.querySelector('.debug-toggle-control');
  const statusTarget = document.getElementById('debug-toggle-status');

  if (!toggle) {
    return;
  }

  const persistedPreference = readPersistedPreference();
  const initialState =
    typeof window !== 'undefined' && typeof window[DEBUG_FLAG] === 'boolean'
      ? Boolean(window[DEBUG_FLAG])
      : persistedPreference;

  toggle.checked = initialState;
  applyDebugState(initialState, toggleControl, statusTarget);

  toggle.addEventListener('change', (event) => {
    const enabled = Boolean(event.target.checked);
    applyDebugState(enabled, toggleControl, statusTarget);
    toggleLogger.info('Deep dive debug logging toggled.', { enabled });
  });

  toggleLogger.info('Debug toggle initialized.', { enabled: initialState });
};
