import { createAddButton, createDomainSelect, createRemoveButton } from '../../src/ui/components.js';
import { createLogger } from '../../src/utils/logger.js';

const storageKey = '__ENV_SUBID_LAUNCH_DATA__';
const envClearKeys = [storageKey, '__ENV_APP_SELECTION_RESPONSES__', '__ENV_METADATA_FIELD_RECORDS__'];
const subidFormLogger = createLogger('SubIdForm', { alwaysInfo: true });

// Ensure a shared SPA-local env object exists for temporary state.
const getEnv = () => {
  if (!window.__ENV) {
    window.__ENV = {};
  }

  return window.__ENV;
};

// Load any previously stored SubID launch rows from the env object.
const parseStoredLaunchData = () => {
  try {
    const env = getEnv();
    const raw = env[storageKey];

    if (!raw) {
      return [];
    }

    const parsed = Array.isArray(raw)
      ? raw
      : JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry) => entry?.subId && entry?.domain && entry?.integrationKey);
  } catch (error) {
    subidFormLogger.warn('Unable to load stored SubID data:', error);
    return [];
  }
};

// Collect SubID form DOM references needed for the controller.
const querySubIdFormElements = () => {
  const fieldsContainer = document.getElementById('subid-fields');
  const launchButton = document.getElementById('launch-button');
  if (!fieldsContainer || !launchButton) {
    return null;
  }

  return {
    fieldsContainer,
    launchButton,
  };
};

class SubIdFormController {
  // Set up SubID form state, inline integration inputs, and initial hydration.
  constructor(elements) {
    this.fieldsContainer = elements.fieldsContainer;
    this.launchButton = elements.launchButton;
    this.hasClearedStoredDataForSession = false;
    this.subIdCount = 0;

    this.addSubIdField = this.addSubIdField.bind(this);
    this.removeSubIdField = this.removeSubIdField.bind(this);
    this.handleIntegrationKeyChange = this.handleIntegrationKeyChange.bind(this);
    this.updateLaunchButtonState = this.updateLaunchButtonState.bind(this);
    const hydrated = this.hydrateStoredLaunchRows();

    if (!hydrated) {
      this.addSubIdField();
    }
  }

  // Toggle the launch button based on SubID and integration key completeness.
  updateLaunchButtonState() {
    const rows = Array.from(this.fieldsContainer.querySelectorAll('.subid-row'));

    const allComplete =
      rows.length > 0 &&
      rows.every((row) => {
        const input = row.querySelector('input[name="subid[]"]');
        const keyInput = row.querySelector('input[name="integrationKey[]"]');
        return Boolean(input && input.value.trim() && keyInput && keyInput.value.trim());
      });

    this.launchButton.disabled = !allComplete;
    this.launchButton.setAttribute('aria-disabled', String(!allComplete));
  }

  // Track integration key edits and clear env state when keys change mid-session.
  handleIntegrationKeyChange(input) {
    const normalizedKey = input.value.trim();
    const previousKey = input.dataset.previousIntegrationKey || '';

    if (normalizedKey !== previousKey && normalizedKey && !this.hasClearedStoredDataForSession) {
      this.clearStoredRunData();
      this.hasClearedStoredDataForSession = true;
    }

    input.dataset.previousIntegrationKey = normalizedKey;
    this.updateLaunchButtonState();
  }

  // Rebuild SubID rows from stored env data when available.
  hydrateStoredLaunchRows() {
    const storedEntries = parseStoredLaunchData();

    if (!storedEntries.length) {
      this.updateLaunchButtonState();
      return false;
    }

    this.fieldsContainer.innerHTML = '';
    this.subIdCount = 0;

    storedEntries.forEach((entry) => {
      this.addSubIdField({
        subId: entry?.subId || '',
        domain: entry?.domain || '',
        integrationKey: entry?.integrationKey || '',
      });
    });

    this.updateLaunchButtonState();
    return true;
  }

  // Drop SPA-local state keys when integration keys change mid-session.
  clearStoredRunData() {
    const env = getEnv();
    envClearKeys.forEach((key) => {
      if (key in env) {
        delete env[key];
      }
    });
  }

  // Capture SubID row values and integration keys for persistence.
  serializeLaunchRows() {
    return Array.from(this.fieldsContainer.querySelectorAll('.subid-row'))
      .map((row) => {
        const subIdInput = row.querySelector('input[name="subid[]"]');
        const domainSelect = row.querySelector('.domain-select');
        const integrationInput = row.querySelector('input[name="integrationKey[]"]');

        return {
          subId: subIdInput?.value.trim() || '',
          domain: domainSelect?.value || '',
          integrationKey: integrationInput?.value.trim() || '',
        };
      })
      .filter(({ subId, integrationKey }) => subId && integrationKey);
  }

  // Keep SubID labels/ids in sequence after add/remove actions.
  renumberRows() {
    Array.from(this.fieldsContainer.querySelectorAll('.subid-row')).forEach((row, index) => {
      const label = row.querySelector('label');
      const input = row.querySelector('input[name="subid[]"]');
      const displayIndex = index + 1;

      if (input) {
        input.id = `subid-${displayIndex}`;
      }

      if (label) {
        label.textContent = `SubID ${displayIndex}`;
        if (input?.id) {
          label.setAttribute('for', input.id);
        }
      }
    });
  }

  // Ensure the "Add SubID" button sits on the final row's input group.
  attachAddButton() {
    const existingButton = this.fieldsContainer.querySelector('.add-subid-btn');

    if (existingButton) {
      existingButton.remove();
    }

    const rows = this.fieldsContainer.querySelectorAll('.subid-row');

    if (!rows.length) {
      return;
    }

    const addButton = createAddButton(this.addSubIdField);
    rows[rows.length - 1].querySelector('.input-group')?.appendChild(addButton);
  }

  // Remove a SubID row and refresh numbering and button placement.
  removeSubIdField(rowId) {
    const row = this.fieldsContainer.querySelector(`[data-subid-row="${rowId}"]`);

    if (!row) {
      return;
    }

    row.remove();

    this.renumberRows();
    this.attachAddButton();
    this.updateLaunchButtonState();
  }

  // Create a SubID row with optional initial values and render it.
  addSubIdField({ subId = '', domain = '', integrationKey = '' } = {}) {
    this.subIdCount += 1;
    const rowId = `row-${this.subIdCount}`;

    const row = document.createElement('div');
    row.className = 'subid-row';
    row.dataset.subidRow = rowId;

    const label = document.createElement('label');
    label.setAttribute('for', `subid-${this.subIdCount}`);
    label.textContent = `SubID ${this.subIdCount}`;

    const inputGroup = document.createElement('div');
    inputGroup.className = 'input-group';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `subid-${this.subIdCount}`;
    input.name = 'subid[]';
    input.className = 'text-input subid-input';
    input.placeholder = 'Enter SubID';
    input.required = true;
    input.value = subId;

    const domainSelect = createDomainSelect();
    if (domain) {
      domainSelect.value = domain;
    }

    const integrationInput = document.createElement('input');
    integrationInput.type = 'text';
    integrationInput.name = 'integrationKey[]';
    integrationInput.className = 'text-input integration-input';
    integrationInput.placeholder = 'Enter integration key';
    integrationInput.setAttribute('aria-label', 'Integration key');
    integrationInput.required = true;
    integrationInput.value = integrationKey;
    integrationInput.dataset.previousIntegrationKey = integrationKey.trim();

    inputGroup.append(domainSelect, input, integrationInput);

    if (this.fieldsContainer.children.length > 0) {
      const removeButton = createRemoveButton(() => this.removeSubIdField(rowId));
      inputGroup.appendChild(removeButton);
    }

    row.append(label, inputGroup);

    this.fieldsContainer.appendChild(row);

    input.addEventListener('input', this.updateLaunchButtonState);
    input.addEventListener('blur', this.updateLaunchButtonState);

    integrationInput.addEventListener('input', () => this.handleIntegrationKeyChange(integrationInput));
    integrationInput.addEventListener('blur', () => this.handleIntegrationKeyChange(integrationInput));

    this.renumberRows();
    this.attachAddButton();
    this.updateLaunchButtonState();
  }

  // Store serialized SubID launch data in the SPA env.
  persistLaunchData() {
    const serializedRows = this.serializeLaunchRows();
    const env = getEnv();

    if (serializedRows.length > 0) {
      env[storageKey] = serializedRows;
    } else if (storageKey in env) {
      delete env[storageKey];
    }

    return serializedRows;
  }
}

// Initialize the SubID form controller and bind launch navigation.
export const initSubIdForm = () => {
  const elements = querySubIdFormElements();

  if (!elements) {
    return;
  }

  const controller = new SubIdFormController(elements);

  elements.launchButton.addEventListener('click', () => {
    controller.persistLaunchData();
    window.location.href = 'app_selection.html';
  });
};

// Entry point for SPA section initialization on page load.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  initSubIdForm();
}
