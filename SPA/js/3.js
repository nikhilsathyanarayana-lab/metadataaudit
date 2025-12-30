import { app_names } from '../API/app_names.js';
import {
  DEFAULT_LOOKBACK_WINDOW,
  METADATA_NAMESPACES,
  buildMetadataQueue,
  processAggregation,
  runMetadataQueue,
} from '../API/metadata.js';
import { getAppSelections } from './2.js';
import { openRegexModal } from './regex.js';

// Provide a shared SPA environment object for cached selections.
const getFieldtypesContainer = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  if (!window.FIELDTYPES || typeof window.FIELDTYPES !== 'object') {
    window.FIELDTYPES = {};
  }

  return window.FIELDTYPES;
};

const FIELDTYPES = getFieldtypesContainer();
const METADATA_TABLE_WINDOWS = ['window7', 'window30', 'window180'];
export const tableData = [];
let tableStatusRows = [];
let activeTableConfigs = [];
let fieldTypesModalBound = false;
const fieldTypeSelections = FIELDTYPES.fieldTypeSelections || {};
FIELDTYPES.fieldTypeSelections = fieldTypeSelections;
const FIELD_TYPE_OPTIONS = [
  { key: 'text', label: 'Text' },
  { key: 'num', label: 'Num' },
  { key: 'boolean', label: 'Boolean' },
  { key: 'email', label: 'Email' },
];

// Normalize app selections so they can be compared between renders.
const normalizeAppSelections = (selections = []) => selections
  .filter((entry) => entry && (entry.subId || entry.appId || entry.appName))
  .map((entry) => ({
    subId: String(entry.subId || ''),
    appId: String(entry.appId || ''),
    appName: String(entry.appName || ''),
    isSelected: Boolean(entry.isSelected),
  }))
  .sort((first, second) => {
    return first.subId.localeCompare(second.subId)
      || first.appId.localeCompare(second.appId)
      || first.appName.localeCompare(second.appName);
  });

// Build a stable signature string for the current app selections.
const buildSelectionSignature = (selections = []) => JSON.stringify(normalizeAppSelections(selections));

let lastSelectionSignature = buildSelectionSignature(getAppSelections());

// Return the window bucket for a specific lookback.
const getWindowBucket = (appBucket, lookbackWindow) => {
  return appBucket?.windows?.[String(lookbackWindow)] || appBucket?.windows?.[lookbackWindow];
};

// Collect unique namespace field names from one or more window buckets.
const buildNamespaceFieldSummary = (windowBuckets = []) => {
  return METADATA_NAMESPACES.reduce((summary, namespace) => {
    const combinedFields = windowBuckets.reduce((fieldNames, bucket) => {
      const namespaceBucket = bucket?.namespaces?.[namespace];

      if (namespaceBucket && typeof namespaceBucket === 'object') {
        Object.keys(namespaceBucket).forEach((fieldName) => {
          if (!fieldNames.includes(fieldName)) {
            fieldNames.push(fieldName);
          }
        });
      }

      return fieldNames;
    }, []);

    const uniqueFields = combinedFields.length
      ? [...new Set(combinedFields)].sort((first, second) => first.localeCompare(second))
      : [];

    summary[namespace] = uniqueFields.length ? uniqueFields : null;
    return summary;
  }, {});
};

// Hydrate cached table data with namespace field names as metadata calls finish.
const processAPI = () => {
  const aggregations = getMetadataAggregations();

  if (!aggregations || typeof aggregations !== 'object') {
    return;
  }

  Object.entries(aggregations).forEach(([subId, subBucket]) => {
    const apps = subBucket?.apps;

    if (!apps || typeof apps !== 'object') {
      return;
    }

    Object.entries(apps).forEach(([appId, appBucket]) => {
      const window7Bucket = getWindowBucket(appBucket, 7);
      const window23Bucket = getWindowBucket(appBucket, 23);
      const window150Bucket = getWindowBucket(appBucket, 150);
      const hasWindow7Data = Boolean(window7Bucket?.isProcessed);
      const hasWindow23Data = Boolean(window23Bucket?.isProcessed);
      const hasWindow150Data = Boolean(window150Bucket?.isProcessed);

      if (!hasWindow7Data && !hasWindow23Data && !hasWindow150Data) {
        return;
      }

      const window7Fields = hasWindow7Data ? buildNamespaceFieldSummary([window7Bucket]) : null;
      const window30Fields = (hasWindow7Data && hasWindow23Data)
        ? buildNamespaceFieldSummary([window7Bucket, window23Bucket])
        : null;
      const window180Fields = (hasWindow7Data && hasWindow23Data && hasWindow150Data)
        ? buildNamespaceFieldSummary([window7Bucket, window23Bucket, window150Bucket])
        : null;

      const normalizedSubId = String(subId || '');
      const normalizedAppId = String(appId || '');

      tableData.forEach((entry) => {
        const matchesSubId = String(entry?.subId || '') === normalizedSubId;
        const matchesAppId = String(entry?.appId || '') === normalizedAppId;
        const namespaceKey = entry?.namespace;

        if (!matchesSubId || !matchesAppId || !namespaceKey) {
          return;
        }

        if (window7Fields && Object.prototype.hasOwnProperty.call(window7Fields, namespaceKey)) {
          entry.window7 = window7Fields[namespaceKey];
        }

        if (window30Fields && Object.prototype.hasOwnProperty.call(window30Fields, namespaceKey)) {
          entry.window30 = window30Fields[namespaceKey];
        }

        if (window180Fields && Object.prototype.hasOwnProperty.call(window180Fields, namespaceKey)) {
          entry.window180 = window180Fields[namespaceKey];
        }
      });
    });
  });

  renderTablesFromData();
  updateFieldTypesModal();
};

// Populate an early tableData snapshot and log selected apps for debugging.
const populateTables = () => {
  tableData.length = 0;

  const cachedSelections = getAppSelections();
  const selectedApps = cachedSelections.filter((entry) => entry?.isSelected);

  if (selectedApps.length) {
    selectedApps.forEach((app) => {
      METADATA_NAMESPACES.forEach((namespace) => {
        tableData.push({
          subId: app?.subId || 'Unknown SubID',
          appName: app?.appName || app?.appId || 'Unknown app',
          appId: app?.appId || '',
          namespace,
          window7: 'Pending...',
          window30: 'Pending...',
          window180: 'Pending...',
        });
      });
    });
  }

  // eslint-disable-next-line no-console
  console.log(selectedApps.length ? selectedApps : 'no selected apps');
};

populateTables();

// Expose metadata table cache for console debugging.
const registerTableDataGlobal = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.tableData = tableData;
};

registerTableDataGlobal();

// Normalize a metadata field name for consistent lookups.
const normalizeFieldName = (fieldName) => {
  return typeof fieldName === 'string' ? fieldName.trim() : '';
};

// Read any saved expected value selection for the provided field.
const getFieldTypeSelection = (fieldName) => {
  const normalizedName = normalizeFieldName(fieldName);

  return normalizedName ? fieldTypeSelections[normalizedName] : undefined;
};

// Persist the checkbox selection for a field while keeping any saved regex.
const setFieldTypeSelection = (fieldName, typeKey) => {
  const normalizedName = normalizeFieldName(fieldName);

  if (!normalizedName) {
    return;
  }

  const existingSelection = fieldTypeSelections[normalizedName] || {};
  const nextSelection = { ...existingSelection };

  if (typeKey) {
    nextSelection.type = typeKey;
  } else {
    delete nextSelection.type;
  }

  if (!nextSelection.type && !nextSelection.regex) {
    delete fieldTypeSelections[normalizedName];
    return;
  }

  fieldTypeSelections[normalizedName] = nextSelection;
};

// Persist a saved regex pattern for a field while keeping any selected type.
const setFieldRegexSelection = (fieldName, regexPattern) => {
  const normalizedName = normalizeFieldName(fieldName);
  const normalizedRegex = typeof regexPattern === 'string' ? regexPattern.trim() : '';

  if (!normalizedName) {
    return;
  }

  const existingSelection = fieldTypeSelections[normalizedName] || {};

  if (!normalizedRegex) {
    if (existingSelection.type) {
      fieldTypeSelections[normalizedName] = { type: existingSelection.type };
    } else {
      delete fieldTypeSelections[normalizedName];
    }

    return;
  }

  fieldTypeSelections[normalizedName] = {
    ...existingSelection,
    regex: normalizedRegex,
  };
};

// Find the list item element for a specific field name.
const findFieldTypesRow = (fieldName) => {
  const { list } = getFieldTypesModalElements();

  if (!list) {
    return null;
  }

  return Array.from(list.querySelectorAll('.fieldtypes-row')).find(
    (row) => normalizeFieldName(row?.dataset?.fieldName) === normalizeFieldName(fieldName),
  );
};

// Update the regex status cell for a field row to reflect the saved pattern.
const updateRegexStatus = (fieldName, regexPattern = '') => {
  const fieldRow = findFieldTypesRow(fieldName);

  if (!fieldRow) {
    return;
  }

  const statusCell = fieldRow.querySelector('.fieldtypes-cell--status');
  const normalizedRegex = typeof regexPattern === 'string' ? regexPattern.trim() : '';
  const displayValue = normalizedRegex || getFieldTypeSelection(fieldName)?.regex || '—';

  if (statusCell) {
    statusCell.textContent = displayValue;
    statusCell.title = normalizedRegex || getFieldTypeSelection(fieldName)?.regex
      ? `Saved regex: ${displayValue}`
      : 'No regex saved yet';
  }
};

// Expose expected value selections for console inspection.
const registerFieldTypeSelectionsGlobal = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.fieldTypeSelections = fieldTypeSelections;
};

registerFieldTypeSelectionsGlobal();

// Build a unique, sorted list of field names from 180-day window results.
const getUniqueWindow180Fields = () => {
  const fieldNames = new Set();

  tableData.forEach((entry) => {
    if (!Array.isArray(entry?.window180)) {
      return;
    }

    entry.window180.forEach((fieldName) => {
      if (typeof fieldName === 'string' && fieldName.trim()) {
        fieldNames.add(fieldName);
      }
    });
  });

  return [...fieldNames].sort((first, second) => first.localeCompare(second));
};

// Build a checkbox control for a specific field type option.
const createFieldTypeCheckbox = (fieldName, optionKey, optionLabel, isChecked = false) => {
  const checkboxLabel = document.createElement('label');
  checkboxLabel.className = 'fieldtypes-checkbox';
  checkboxLabel.dataset.fieldtypesOption = optionKey;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.name = `fieldtype-${fieldName}-${optionKey}`;
  checkbox.value = optionKey;
  checkbox.checked = isChecked;
  checkbox.setAttribute('aria-label', `${optionLabel} expected for ${fieldName}`);
  checkboxLabel.appendChild(checkbox);

  return checkboxLabel;
};

// Toggle availability of sibling checkboxes and row highlight state.
const updateFieldTypeRowState = (rowElement, activeCheckbox) => {
  if (!rowElement) {
    return;
  }

  const checkboxes = rowElement.querySelectorAll('input[type="checkbox"]');
  const shouldDisableOthers = Boolean(activeCheckbox?.checked);

  checkboxes.forEach((checkbox) => {
    const isActiveCheckbox = checkbox === activeCheckbox;

    if (!isActiveCheckbox) {
      checkbox.disabled = shouldDisableOthers;
    } else {
      checkbox.disabled = false;
    }
  });

  const hasSelection = Array.from(checkboxes).some((checkbox) => checkbox.checked);
  rowElement.classList.toggle('fieldtypes-row--selected', hasSelection);
};

// Attach change listeners to each checkbox in a field row.
const bindFieldTypeCheckboxes = (rowElement, fieldName) => {
  const checkboxes = rowElement.querySelectorAll('input[type="checkbox"]');

  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      updateFieldTypeRowState(rowElement, checkbox);
      setFieldTypeSelection(fieldName, checkbox.checked ? checkbox.value : '');
    });
  });
};

// Build a row describing one metadata field and its type options.
const createFieldTypesRow = (fieldName) => {
  const listItem = document.createElement('li');
  listItem.className = 'metadata-tree__value fieldtypes-row';
  listItem.setAttribute('role', 'row');
  listItem.dataset.fieldName = fieldName;

  const savedSelection = getFieldTypeSelection(fieldName);

  const fieldLabel = document.createElement('span');
  fieldLabel.className = 'fieldtypes-field-label';
  fieldLabel.setAttribute('role', 'cell');
  fieldLabel.textContent = fieldName;
  fieldLabel.title = fieldName;
  listItem.appendChild(fieldLabel);

  FIELD_TYPE_OPTIONS.forEach((option) => {
    const checkboxCell = document.createElement('div');
    checkboxCell.className = 'fieldtypes-cell fieldtypes-cell--control';
    checkboxCell.setAttribute('role', 'cell');
    const checkbox = createFieldTypeCheckbox(
      fieldName,
      option.key,
      option.label,
      savedSelection?.type === option.key,
    );
    checkboxCell.appendChild(checkbox);
    listItem.appendChild(checkboxCell);
  });

  const regexStatus = document.createElement('span');
  regexStatus.className = 'fieldtypes-cell fieldtypes-cell--status';
  regexStatus.setAttribute('role', 'cell');
  regexStatus.textContent = savedSelection?.regex || '—';
  regexStatus.title = savedSelection?.regex ? `Saved regex: ${savedSelection.regex}` : 'No regex saved yet';
  listItem.appendChild(regexStatus);

  const regexButtonCell = document.createElement('div');
  regexButtonCell.className = 'fieldtypes-cell fieldtypes-cell--action';
  regexButtonCell.setAttribute('role', 'cell');

  const regexButton = document.createElement('button');
  regexButton.type = 'button';
  regexButton.className = 'secondary-btn fieldtypes-regex-btn';
  regexButton.textContent = 'Regex';
  regexButton.addEventListener('click', () => {
    const currentSelection = getFieldTypeSelection(fieldName);

    openRegexModal(fieldName, currentSelection?.regex || '', (regexPattern) => {
      setFieldRegexSelection(fieldName, regexPattern);
      updateRegexStatus(fieldName, regexPattern);
    });
  });
  regexButtonCell.appendChild(regexButton);

  listItem.appendChild(regexButtonCell);

  bindFieldTypeCheckboxes(listItem, fieldName);
  updateFieldTypeRowState(listItem, listItem.querySelector('input[type="checkbox"]:checked'));

  return listItem;
};

// Grab modal, backdrop, and list nodes for the expected values modal.
const getFieldTypesModalElements = () => {
  return {
    modal: document.getElementById('fieldtypes-modal'),
    backdrop: document.getElementById('fieldtypes-backdrop'),
    list: document.getElementById('fieldtypes-list'),
  };
};

// Fetch and inject the expected values modal template when needed.
const loadFieldTypesModal = async () => {
  const existingElements = getFieldTypesModalElements();

  if (existingElements.modal && existingElements.backdrop) {
    return existingElements;
  }

  const modalUrl = new URL('../html/fieldtypes.html', import.meta.url);
  const response = await fetch(modalUrl, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error('Unable to load expected values modal.');
  }

  const template = document.createElement('template');
  template.innerHTML = (await response.text()).trim();
  document.body.appendChild(template.content);

  return getFieldTypesModalElements();
};

// Render the list of window180 fields inside the expected values modal.
const renderFieldTypesList = () => {
  const { list } = getFieldTypesModalElements();

  if (!list) {
    return;
  }

  const uniqueFields = getUniqueWindow180Fields();
  list.innerHTML = '';

  if (!uniqueFields.length) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'metadata-tree__value fieldtypes-row fieldtypes-row--empty';
    emptyItem.setAttribute('role', 'row');
    emptyItem.textContent = 'No fields available yet. Run metadata to populate this list.';
    list.appendChild(emptyItem);
    return;
  }

  const listFragment = document.createDocumentFragment();
  uniqueFields.forEach((fieldName) => listFragment.appendChild(createFieldTypesRow(fieldName)));

  list.appendChild(listFragment);
};

// Hide the expected values modal and backdrop.
const closeFieldTypesModal = () => {
  const { modal, backdrop } = getFieldTypesModalElements();

  if (!modal || !backdrop) {
    return;
  }

  modal.classList.remove('is-visible');
  backdrop.classList.remove('is-visible');
  modal.hidden = true;
  backdrop.hidden = true;
};

// Attach close handlers once the expected values modal loads.
const bindFieldTypesModalHandlers = () => {
  const { modal, backdrop } = getFieldTypesModalElements();

  if (!modal || !backdrop) {
    return;
  }

  const closeButtons = modal.querySelectorAll('[data-close-fieldtypes-modal]');
  closeButtons.forEach((button) => {
    button.addEventListener('click', () => closeFieldTypesModal());
  });

  backdrop.addEventListener('click', () => closeFieldTypesModal());
  fieldTypesModalBound = true;
};

// Show the expected values modal with the latest field list.
const openFieldTypesModal = async () => {
  try {
    const elements = await loadFieldTypesModal();

    if (!fieldTypesModalBound) {
      bindFieldTypesModalHandlers();
    }

    renderFieldTypesList();

    elements.modal.hidden = false;
    elements.backdrop.hidden = false;
    elements.modal.classList.add('is-visible');
    elements.backdrop.classList.add('is-visible');
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Unable to open expected values modal.', error);
  }
};

// Refresh the expected values modal if it already exists.
const updateFieldTypesModal = () => {
  if (!getFieldTypesModalElements().modal) {
    return;
  }

  renderFieldTypesList();
};

// Convert table cell values from cached table data into readable text.
const formatTableDataValue = (value) => {
  const pendingText = 'Pending...';
  const noDataText = 'No Data';

  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : noDataText;
  }

  if (value === null) {
    return noDataText;
  }

  return value || pendingText;
};

// Emit metadata scan lifecycle events for navigation gating.
const emitMetadataScanEvent = (eventName) => {
  if (!eventName || typeof document === 'undefined') {
    return;
  }

  document.dispatchEvent(new Event(eventName));
};

// Signal that metadata scans have started.
const notifyMetadataScanStarted = () => emitMetadataScanEvent('metadata-scan-started');

// Signal that metadata scans have finished.
const notifyMetadataScanCompleted = () => emitMetadataScanEvent('metadata-scan-completed');

// Read metadata aggregations from the browser when available.
const getMetadataAggregations = () => {
  return typeof window !== 'undefined'
    ? window.metadataAggregations || {}
    : {};
};

// Build a metadata row string showing SubID, app details, and lookback values.
const buildMetadataRowMarkup = ({ subId, appId, appName, window7, window30, window180 }) => {
  const valueLookup = {
    window7,
    window30,
    window180,
  };

  const lookbackCells = METADATA_TABLE_WINDOWS
    .map((key) => `<td>${formatTableDataValue(valueLookup[key])}</td>`)
    .join('');

  return [
    '<tr>',
    `<td>${subId || 'Unknown SubID'}</td>`,
    `<td>${appName || appId || 'Unknown app'}</td>`,
    `<td>${appId || ''}</td>`,
    lookbackCells,
    '</tr>',
  ].join('');
};

// Build a status row string spanning the metadata table columns.
const createMetadataStatusRow = (message, columnCount = 6, subId = '') => {
  // eslint-disable-next-line no-console
  console.log('createMetadataStatusRow');

  const statusText = subId ? `${message} (${subId})` : message;
  return `<tr><td colspan="${columnCount}">${statusText}</td></tr>`;
};

// Append shared status rows across all metadata tables.
const addStatusRowForAllTables = (message, columnCount = 6, subId = '') => {
  tableStatusRows.push({ message, columnCount, subId });
};

// Render every metadata table with the latest cached table data.
const renderTablesFromData = () => {
  if (!activeTableConfigs.length) {
    return;
  }

  const statusMarkup = tableStatusRows
    .map(({ message, columnCount, subId }) => createMetadataStatusRow(message, columnCount, subId))
    .join('');

  activeTableConfigs.forEach(({ namespace, element }) => {
    if (!element) {
      return;
    }

    const rowsForNamespace = tableData.filter((entry) => entry?.namespace === namespace);
    const rowMarkup = rowsForNamespace
      .map((rowData) => buildMetadataRowMarkup(rowData))
      .join('');

    if (!rowMarkup && !statusMarkup) {
      element.innerHTML = createMetadataStatusRow('No metadata rows available.');
      return;
    }

    element.innerHTML = `${rowMarkup}${statusMarkup}`;
  });
};

// Run metadata scans while broadcasting status updates for navigation controls.
const runMetadataScansWithStatus = async (appsForMetadata, onAggregation) => {
  if (!Array.isArray(appsForMetadata) || !appsForMetadata.length || typeof onAggregation !== 'function') {
    return;
  }

  let hasCompleted = false;
  notifyMetadataScanStarted();

  try {
    await buildMetadataQueue(appsForMetadata, DEFAULT_LOOKBACK_WINDOW);
    await runMetadataQueue(onAggregation, DEFAULT_LOOKBACK_WINDOW);
    hasCompleted = true;
    notifyMetadataScanCompleted();
  } finally {
    if (!hasCompleted) {
      notifyMetadataScanCompleted();
    }
  }
};

// Render the metadata tables for each credential.
const renderMetadataTables = async (tableConfigs) => {
  // eslint-disable-next-line no-console
  console.log('renderMetadataTables');

  if (!Array.isArray(tableConfigs) || !tableConfigs.length) {
    return;
  }

  tableData.length = 0;
  tableStatusRows = [];
  activeTableConfigs = tableConfigs;

  const handleAggregation = (payload) => {
    processAggregation(payload);
    processAPI();
  };

  const recordTableDataRow = ({ subId, appId, appName, namespace }) => {
    tableData.push({
      subId: subId || 'Unknown SubID',
      appName: appName || appId || 'Unknown app',
      appId: appId || '',
      namespace: namespace || '',
      window7: 'Pending...',
      window30: 'Pending...',
      window180: 'Pending...',
    });
  };

  try {
    const cachedSelections = getAppSelections();
    const selectedApps = cachedSelections.filter((entry) => entry?.isSelected);
    let appsForMetadata = [];

    if (selectedApps.length) {
      selectedApps.forEach((app) => {
        METADATA_NAMESPACES.forEach((namespace) => {
          recordTableDataRow({
            subId: app?.subId,
            appId: app?.appId,
            appName: app?.appName,
            namespace,
          });
        });
      });
      renderTablesFromData();
      appsForMetadata = selectedApps;
      await runMetadataScansWithStatus(appsForMetadata, handleAggregation);
      return;
    }

    if (cachedSelections.length) {
      addStatusRowForAllTables('No apps selected for metadata tables.');
      renderTablesFromData();
      return;
    }

    const credentialResults = await app_names();

    if (!credentialResults.length) {
      addStatusRowForAllTables('No credentials available for app discovery.');
      renderTablesFromData();
      return;
    }

    credentialResults.forEach((result) => {
      const subId = result?.credential?.subId;

      if (result?.errorType || !Array.isArray(result?.results)) {
        const errorHint = result?.errorHint ? `: ${result.errorHint}` : '';
        addStatusRowForAllTables(`Unable to load apps for ${subId || 'unknown SubID'}${errorHint}`);
        return;
      }

      if (!result.results.length) {
        addStatusRowForAllTables('No apps returned for SubID.', 6, subId);
        return;
      }

      result.results.forEach((app) => {
        METADATA_NAMESPACES.forEach((namespace) => {
          recordTableDataRow({
            subId,
            appId: app?.appId,
            appName: app?.appName,
            namespace,
          });
        });
        appsForMetadata.push({
          subId,
          appId: app?.appId,
          appName: app?.appName,
        });
      });
    });

    renderTablesFromData();

    if (appsForMetadata.length) {
      await runMetadataScansWithStatus(appsForMetadata, handleAggregation);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[renderMetadataTables] Unable to load metadata tables.', error);
    addStatusRowForAllTables('Unable to load metadata tables. Please try again.');
    renderTablesFromData();
  }
};

// Build table configuration references from the current section root.
const getTableConfigsFromRoot = (sectionRoot) => METADATA_NAMESPACES
  .map((namespace) => ({
    namespace,
    element: sectionRoot?.querySelector(`#${namespace}-metadata-table-body`),
  }))
  .filter(({ element }) => Boolean(element));

// Populate metadata tables with discovered apps.
export async function initSection(sectionRoot) {
  // eslint-disable-next-line no-console
  console.log('initSection');

  if (!sectionRoot) {
    return;
  }

  const tableConfigs = getTableConfigsFromRoot(sectionRoot);

  if (!tableConfigs.length) {
    return;
  }

  const expectedValuesButton = sectionRoot.querySelector('#expected-values-button');

  if (expectedValuesButton && !expectedValuesButton.dataset.boundExpectedValues) {
    expectedValuesButton.dataset.boundExpectedValues = 'true';
    expectedValuesButton.addEventListener('click', () => openFieldTypesModal());
  }

  lastSelectionSignature = buildSelectionSignature(getAppSelections());
  await renderMetadataTables(tableConfigs);
}

// Refresh metadata tables when returning to the view with new selections.
export async function onShow(sectionRoot) {
  const tableConfigs = getTableConfigsFromRoot(sectionRoot);

  if (!tableConfigs.length) {
    return;
  }

  const currentSelectionSignature = buildSelectionSignature(getAppSelections());

  if (currentSelectionSignature === lastSelectionSignature) {
    return;
  }

  lastSelectionSignature = currentSelectionSignature;
  await renderMetadataTables(tableConfigs);
}
