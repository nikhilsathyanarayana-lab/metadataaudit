import { logDeepDive } from '../../pages/deepDive/constants.js';
import { metadata_accounts, metadata_api_calls, metadata_visitors } from '../../pages/deepDive/aggregation.js';
import { dedupeMetadataRecords, loadDeepDiveRecords, loadMetadataRecords } from '../../pages/deepDive/dataHelpers.js';

const snapshotCollection = (collection) => {
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(collection)
      : JSON.parse(JSON.stringify(collection));
  } catch (error) {
    logDeepDive('warn', 'Falling back to direct collection reference for snapshot', error);
    return collection;
  }
};

export const buildDeepDiveExportState = () => {
  const deepDiveRecords = snapshotCollection(loadDeepDiveRecords());
  const metadataRecords = snapshotCollection(
    dedupeMetadataRecords(loadMetadataRecords(), deepDiveRecords),
  );
  const visitors = snapshotCollection(metadata_visitors);
  const accounts = snapshotCollection(metadata_accounts);
  const apiCalls = snapshotCollection(metadata_api_calls);

  logDeepDive('debug', 'Captured deep-dive export state snapshot', {
    visitors: visitors.length,
    accounts: accounts.length,
    deepDiveRecords: deepDiveRecords.length,
    metadataRecords: metadataRecords.length,
    apiCalls: apiCalls.length,
  });

  return { visitors, accounts, apiCalls, deepDiveRecords, metadataRecords };
};

export const snapshotDeepDiveCollection = snapshotCollection;
