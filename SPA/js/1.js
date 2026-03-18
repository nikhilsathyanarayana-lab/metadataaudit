import { createAddButton, createDomainSelect, createRemoveButton } from '../../src/ui/components.js';
import { setAppCredentials, setAppCountsBySubId } from '../API/app_names.js';
import { setMetadataAggregations } from '../API/metadata.js';
import {
  AUDIT_MODE_QUICK,
  AUDIT_MODE_STANDARD,
  setAuditMode,
} from './auditMode.js';
import { appSelectionState } from './2.js';

const CREDENTIAL_STATE_EVENT = 'spa-credentials-changed';
const AUDIT_STATE_RESET_EVENT = 'spa-audit-state-reset';

// Return true when a credential row includes every required field.
const isCompleteCredentialEntry = (entry = {}) => {
  return Boolean(
    entry?.subId?.trim?.()
    && entry?.domain
    && entry?.integrationKey?.trim?.(),
  );
};

// Normalize credentials so signature checks ignore incomplete rows and whitespace.
const normalizeCredentialEntries = (entries = []) => {
  return entries
    .filter((entry) => entry && isCompleteCredentialEntry(entry))
    .map((entry) => ({
      subId: entry?.subId?.trim?.() || '',
      domain: entry?.domain || '',
      integrationKey: entry?.integrationKey?.trim?.() || '',
    }));
};

// Build a stable signature for the current credential set.
function buildCredentialSignature(entries = []) {
  return JSON.stringify(normalizeCredentialEntries(entries));
}

let lastCredentialSignature = buildCredentialSignature(
  typeof window !== 'undefined' ? window.appCredentials : [],
);

// Persist credentials and clear cached app selections when the credential set changes.
const syncCredentialState = (entries = [], setAppCredentialsFn = setAppCredentials) => {
  const normalizedEntries = normalizeCredentialEntries(entries);
  const nextSignature = buildCredentialSignature(normalizedEntries);

  if (nextSignature !== lastCredentialSignature) {
    appSelectionState.entries = [];
    setMetadataAggregations({});
    setAppCountsBySubId({});
    document.dispatchEvent(new Event(AUDIT_STATE_RESET_EVENT));
  }

  lastCredentialSignature = nextSignature;
  setAppCredentialsFn(normalizedEntries);
  return normalizedEntries;
};

// Persist credentials, set audit mode, and route a shortcut button click.
export const activateShortcutAction = ({
  targetPage,
  auditMode,
  subIdFormController,
  setAuditModeFn = setAuditMode,
  setAppCredentialsFn = setAppCredentials,
  queryDestinationButton = (pageId) => document.querySelector(`[data-page-btn="${pageId}"]`),
} = {}) => {
  if (!targetPage) {
    return;
  }

  if (subIdFormController?.validateBeforeNavigation && !subIdFormController.validateBeforeNavigation()) {
    return;
  }

  if (auditMode) {
    setAuditModeFn(auditMode);
  }

  if (subIdFormController?.emitCredentialState) {
    subIdFormController.emitCredentialState();
  } else if (subIdFormController?.getCredentialEntries) {
    syncCredentialState(subIdFormController.getCredentialEntries(), setAppCredentialsFn);
  }

  queryDestinationButton(targetPage)?.click?.();
};

// Collect SubID form DOM references needed for the controller.
const querySubIdFormElements = () => {
  const formElement = document.getElementById('subid-form');
  const fieldsContainer = document.getElementById('subid-fields');

  if (!formElement || !fieldsContainer) {
    return null;
  }

  return {
    formElement,
    fieldsContainer,
  };
};

class SubIdFormController {
  // Set up SubID form state and initial hydration.
  constructor(elements) {
    this.formElement = elements.formElement;
    this.fieldsContainer = elements.fieldsContainer;
    this.subIdCount = 0;

    this.addSubIdField = this.addSubIdField.bind(this);
    this.removeSubIdField = this.removeSubIdField.bind(this);
    this.validateBeforeNavigation = this.validateBeforeNavigation.bind(this);

    this.bindInputEvents();
    this.addSubIdField({}, { emitCredentialState: false });
  }

  // Emit normalized credential state so other SPA modules can react.
  emitCredentialState() {
    const entries = syncCredentialState(this.getCredentialEntries());

    document.dispatchEvent(new CustomEvent(CREDENTIAL_STATE_EVENT, { detail: { entries } }));
  }

  // Watch credential row inputs and emit updates as values change.
  bindInputEvents() {
    this.fieldsContainer.addEventListener('input', (event) => {
      const target = event.target;

      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }

      this.emitCredentialState();
    });

    this.fieldsContainer.addEventListener('change', (event) => {
      const target = event.target;

      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
        return;
      }

      this.emitCredentialState();
    });
  }

  // Run browser validity checks before allowing page navigation shortcuts.
  validateBeforeNavigation() {
    return this.formElement?.reportValidity?.() ?? true;
  }

  // Replace SubID rows with the supplied credential list.
  hydrateFromCredentials(entries = []) {
    if (!Array.isArray(entries) || !entries.length) {
      return;
    }

    this.fieldsContainer.innerHTML = '';
    this.subIdCount = 0;

    entries.forEach((entry) => {
      this.addSubIdField({
        subId: entry?.subId || '',
        domain: entry?.domain || '',
        integrationKey: entry?.integrationKey || '',
      }, { emitCredentialState: false });
    });

    this.emitCredentialState();
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
    this.emitCredentialState();
  }

  // Create a SubID row with optional initial values and render it.
  addSubIdField({ subId = '', domain = '', integrationKey = '' } = {}, options = {}) {
    const { emitCredentialState = true } = options;
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
    domainSelect.required = true;
    domainSelect.setAttribute('aria-label', 'Pendo domain');
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

    inputGroup.append(domainSelect, input, integrationInput);

    if (this.fieldsContainer.children.length > 0) {
      const removeButton = createRemoveButton(() => this.removeSubIdField(rowId));
      inputGroup.appendChild(removeButton);
    }

    row.append(label, inputGroup);

    this.fieldsContainer.appendChild(row);

    this.renumberRows();
    this.attachAddButton();
    if (emitCredentialState) {
      this.emitCredentialState();
    }
  }

  // Collect credential entries from the rendered SubID rows.
  getCredentialEntries() {
    return Array.from(this.fieldsContainer.querySelectorAll('.subid-row')).map((row) => {
      const subIdInput = row.querySelector('input[name="subid[]"]');
      const domainSelect = row.querySelector('select');
      const integrationInput = row.querySelector('input[name="integrationKey[]"]');

      return {
        subId: subIdInput?.value?.trim() || '',
        domain: domainSelect?.value || '',
        integrationKey: integrationInput?.value?.trim() || '',
      };
    });
  }
}

// Wire SubID card actions to the SPA page switcher.
const initShortcutButtons = (sectionRoot, subIdFormController) => {
  const selectAppsButton = sectionRoot.querySelector('#subid-select-apps-btn');
  const auditAllButton = sectionRoot.querySelector('#subid-audit-all-btn');
  const quickAuditButton = sectionRoot.querySelector('#subid-quick-audit-btn');

  if (!selectAppsButton && !auditAllButton && !quickAuditButton) {
    return;
  }

  selectAppsButton?.addEventListener('click', () => {
    activateShortcutAction({ targetPage: '2', auditMode: AUDIT_MODE_STANDARD, subIdFormController });
  });

  auditAllButton?.addEventListener('click', () => {
    activateShortcutAction({ targetPage: '3', auditMode: AUDIT_MODE_STANDARD, subIdFormController });
  });

  quickAuditButton?.addEventListener('click', () => {
    activateShortcutAction({ targetPage: '3', auditMode: AUDIT_MODE_QUICK, subIdFormController });
  });
};

// Initialize the SubID form controller.
export const initSubIdForm = () => {
  const elements = querySubIdFormElements();

  if (!elements) {
    return;
  }

  const controller = new SubIdFormController(elements);
  const credentialEntries = typeof window !== 'undefined' ? window.appCredentials : null;

  if (Array.isArray(credentialEntries) && credentialEntries.length) {
    controller.hydrateFromCredentials(credentialEntries);
  } else {
    controller.emitCredentialState();
  }

  return controller;
};

// Entry point for SPA section initialization on page load.
export async function initSection(sectionRoot) {
  if (!sectionRoot) {
    return;
  }

  const subIdFormController = initSubIdForm();
  initShortcutButtons(sectionRoot, subIdFormController);
}
