import { buildDeepDiveExportState, snapshotDeepDiveCollection } from './deep_state.js';
import { logDeepDive } from '../../pages/deepDive/constants.js';
import { reportDeepDiveError } from '../../pages/deepDive/ui/render.js';

export const downloadDeepDiveJson = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
};

export const exportDeepDiveJson = () => {
  logDeepDive('info', 'Starting deep-dive JSON export flow');

  let exportState;
  try {
    exportState = buildDeepDiveExportState();
  } catch (error) {
    reportDeepDiveError('Unable to prepare deep-dive JSON export.', error);
    return;
  }

  const payload = {
    visitors: snapshotDeepDiveCollection(exportState.visitors),
    accounts: snapshotDeepDiveCollection(exportState.accounts),
    records: snapshotDeepDiveCollection(exportState.deepDiveRecords),
    apiCalls: snapshotDeepDiveCollection(exportState.apiCalls),
  };

  if (!payload.visitors.length && !payload.accounts.length && !payload.records.length) {
    const message = 'No deep-dive metadata is available to export yet.';
    logDeepDive('warn', message, payload);
    reportDeepDiveError(message, null);
    return;
  }

  try {
    logDeepDive('debug', 'Exporting deep-dive JSON payload', {
      visitors: payload.visitors.length,
      accounts: payload.accounts.length,
      records: payload.records.length,
      apiCalls: payload.apiCalls.length,
    });
    downloadDeepDiveJson(payload, 'metadata-deep-dive.json');
  } catch (error) {
    reportDeepDiveError('Unable to generate deep-dive JSON download.', error);
  }
};
