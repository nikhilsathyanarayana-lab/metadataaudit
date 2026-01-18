import { setAppCountsBySubId, setAppCredentials } from '../API/app_names.js';
import { METADATA_NAMESPACES, setMetadataAggregations } from '../API/metadata.js';
import { appSelectionState } from './2.js';
import { tableData } from './3.js';
import { TEST_DATASET } from './testData.js';

// Normalize credential entries for consistent downstream usage.
const normalizeCredentials = (entries = []) =>
  entries
    .filter((entry) => entry && (entry.subId || entry.domain || entry.integrationKey))
    .map((entry) => ({
      subId: entry.subId || '',
      domain: entry.domain || '',
      integrationKey: entry.integrationKey || '',
    }));

// Normalize app selection entries for use in selection-driven flows.
const normalizeSelectionEntries = (entries = []) =>
  entries
    .filter((entry) => entry && (entry.subId || entry.appId || entry.appName))
    .map((entry) => ({
      subId: entry.subId || '',
      appId: entry.appId || '',
      appName: entry.appName || entry.appId || '',
      isSelected: Boolean(entry.isSelected),
    }));

// Ensure the field type selections container exists on the window.
const getFieldTypesContainer = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  if (!window.FIELDTYPES || typeof window.FIELDTYPES !== 'object') {
    window.FIELDTYPES = {};
  }

  return window.FIELDTYPES;
};

// Build table data rows from the selected apps and known namespaces.
const buildTableRows = (selectionEntries = [], namespaces = METADATA_NAMESPACES) => {
  const rows = [];

  selectionEntries
    .filter((entry) => entry?.isSelected)
    .forEach((entry) => {
      namespaces.forEach((namespace) => {
        rows.push({
          subId: entry.subId || 'Unknown SubID',
          appName: entry.appName || entry.appId || 'Unknown app',
          appId: entry.appId || '',
          namespace,
          window7: 'Pending...',
          window30: 'Pending...',
          window180: 'Pending...',
        });
      });
    });

  return rows;
};

// Load a test dataset into the shared SPA state containers.
export const loadTestDataset = (dataset = TEST_DATASET) => {
  if (!dataset || typeof dataset !== 'object') {
    return;
  }

  const credentials = normalizeCredentials(dataset.appCredentials || []);
  setAppCredentials(credentials);

  if (typeof window !== 'undefined') {
    window.spaTestDataset = dataset;
    window.appCredentials = credentials;
  }

  appSelectionState.entries = normalizeSelectionEntries(dataset.appSelectionState?.entries || []);

  setAppCountsBySubId(dataset.appCountsBySubId || {});

  setMetadataAggregations(dataset.metadataAggregations || {});

  const fieldTypesContainer = getFieldTypesContainer();
  fieldTypesContainer.fieldTypeSelections = { ...(dataset.fieldTypeSelections || {}) };

  if (typeof window !== 'undefined') {
    window.fieldTypeSelections = fieldTypesContainer.fieldTypeSelections;
  }

  tableData.length = 0;
  tableData.push(...buildTableRows(appSelectionState.entries));
};
