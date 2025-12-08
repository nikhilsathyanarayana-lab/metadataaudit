import { buildDeepDiveExportState, snapshotDeepDiveCollection } from './deep_state.js';
import { logDeepDive } from '../../pages/deepDive/constants.js';
import { reportDeepDiveError } from '../../pages/deepDive/ui/render.js';
import { createExportStatusHelper } from './export_status.js';

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
  const { setStatus, restore } = createExportStatusHelper();

  try {
    setStatus('Preparing deep-dive JSON export…', { pending: true });
    const exportState = buildDeepDiveExportState();

    const payload = {
      visitors: snapshotDeepDiveCollection(exportState.visitors),
      accounts: snapshotDeepDiveCollection(exportState.accounts),
      records: snapshotDeepDiveCollection(exportState.deepDiveRecords),
      apiCalls: snapshotDeepDiveCollection(exportState.apiCalls),
    };

    if (!payload.visitors.length && !payload.accounts.length && !payload.records.length) {
      const message = 'No deep-dive metadata is available to export yet.';
      logDeepDive('warn', message, payload);
      setStatus(message, { tone: 'warning' });
      reportDeepDiveError(message, null);
      return;
    }

    logDeepDive('debug', 'Exporting deep-dive JSON payload', {
      visitors: payload.visitors.length,
      accounts: payload.accounts.length,
      records: payload.records.length,
      apiCalls: payload.apiCalls.length,
    });

    setStatus('Building deep-dive JSON download…', { pending: true });
    downloadDeepDiveJson(payload, 'metadata-deep-dive.json');
    setStatus('Export ready. Your JSON download should start shortly.', { pending: false, tone: 'success' });
  } catch (error) {
    setStatus('Unable to export deep-dive JSON. Please try again.', { tone: 'error' });
    reportDeepDiveError('Unable to generate deep-dive JSON download.', error);
  } finally {
    setTimeout(() => restore(), 1500);
  }
};
