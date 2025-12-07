import { getOutstandingMetadataCalls, getMetadataShapeAnomalies, metadata_accounts, metadata_visitors } from './aggregation.js';
import { loadDeepDiveRecords } from './dataHelpers.js';
import { logDeepDive } from './constants.js';
import { summarizeJsonShape } from './shapeUtils.js';

export const exposeDeepDiveDebugCommands = ({ deepDiveCallPlan = [], calculateStallThreshold } = {}) => {
  if (typeof window === 'undefined') {
    return;
  }

  const getStallThreshold = typeof calculateStallThreshold === 'function' ? calculateStallThreshold : () => null;

  if (!window.showPendingDeepDiveRequests) {
    window.showPendingDeepDiveRequests = () => {
      const outstanding = getOutstandingMetadataCalls();

      if (!outstanding.length) {
        console.info('No pending deep dive requests.');
        return [];
      }

      const summarized = outstanding.map((call) => {
        const queuedAtMs = Date.parse(call.queuedAt);
        const ageMs = Number.isFinite(queuedAtMs) ? Date.now() - queuedAtMs : 0;
        const stallThresholdMs = getStallThreshold(call);

        return {
          appId: call.appId,
          subId: call.subId,
          status: call.status,
          queuedAt: call.queuedAt,
          startedAt: call.startedAt,
          ageMs: Math.round(ageMs),
          stallThresholdMs,
          stalled: Number.isFinite(stallThresholdMs) ? ageMs >= stallThresholdMs : false,
        };
      });

      console.table(summarized);
      return outstanding;
    };
  }

  if (!window.showDeepDiveCallPlan) {
    window.showDeepDiveCallPlan = () => {
      if (!deepDiveCallPlan.length) {
        console.info('No deep dive call plan generated.');
        return [];
      }

      const summarized = deepDiveCallPlan.map((call) => ({
        appId: call.appId,
        subId: call.subId,
        lookbackDays: call.lookbackDays,
        status: call.status,
        detail: call.detail || '',
        updatedAt: call.updatedAt || call.plannedAt,
      }));

      console.table(summarized);
      return deepDiveCallPlan;
    };
  }

  window.validateData = () => {
    const records = loadDeepDiveRecords();
    const successApps = new Set(records.filter((record) => record?.status === 'success').map((r) => r.appId));

    const jsonAppSummaries = new Map();

    const ensureSummary = (appId) => {
      if (!jsonAppSummaries.has(appId)) {
        jsonAppSummaries.set(appId, {
          appId,
          visitors: 0,
          accounts: 0,
          metadataResponses: 0,
          metadataStatus: 'pending',
        });
      }

      return jsonAppSummaries.get(appId);
    };

    metadata_visitors.forEach((visitor) => {
      const summary = ensureSummary(visitor.appId);
      summary.visitors += 1;
    });

    metadata_accounts.forEach((account) => {
      const summary = ensureSummary(account.appId);
      summary.accounts += 1;
    });

    records.forEach((record) => {
      const summary = ensureSummary(record.appId);

      summary.metadataStatus = summary.metadataStatus === 'pending' ? record.status : summary.metadataStatus;
      summary.metadataResponses += 1;
      summary.hasMetadata = true;
      summary.subId = summary.subId || record.subId;
    });

    const summaries = Array.from(jsonAppSummaries.values()).map((summary) => ({
      appId: summary.appId,
      subId: summary.subId,
      visitors: summary.visitors,
      accounts: summary.accounts,
      success: summary.metadataStatus === 'success',
      deepDiveRecords: summary.metadataResponses,
      hasVisitorMetadata: summary.visitors > 0,
      hasAccountMetadata: summary.accounts > 0,
      hasMetadataResponse: summary.hasMetadata === true,
      successInMetadata: successApps.has(summary.appId),
      completeJson: successApps.has(summary.appId) && summary.hasMetadata === true,
    }));

    summaries.sort((a, b) => b.deepDiveRecords - a.deepDiveRecords || a.appId.localeCompare(b.appId));

    console.info('Deep dive validation summary by app:');
    console.table(summaries);

    const shapeAnomalies = getMetadataShapeAnomalies();
    const unexpectedShapes = [];

    const appendAnomalies = (type, anomalies) => {
      anomalies.forEach((anomaly) => {
        unexpectedShapes.push({
          type,
          appId: anomaly.appId,
          subId: anomaly.subId,
          source: anomaly.source,
          shape: anomaly.shape,
          sample: anomaly.sample,
        });
      });
    };

    appendAnomalies('visitor', shapeAnomalies.visitor);
    appendAnomalies('account', shapeAnomalies.account);

    const formatSample = (sample) => {
      try {
        return JSON.stringify(sample);
      } catch (error) {
        return String(sample);
      }
    };

    if (unexpectedShapes.length) {
      console.info('Unexpected deep dive metadata shapes detected during aggregation:');
      console.table(
        unexpectedShapes.map((anomaly) => ({
          type: anomaly.type,
          appId: anomaly.appId,
          subId: anomaly.subId,
          source: anomaly.source,
          shape: anomaly.shape,
          sample: formatSample(anomaly.sample)?.slice(0, 200),
        })),
      );
    } else {
      console.info('No unexpected metadata shapes observed during aggregation.');
    }

    return summaries;
  };

  window.describeJsonFileStructure = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.hidden = true;
    document.body.appendChild(input);

    const selectFile = () =>
      new Promise((resolve, reject) => {
        const cleanup = () => input.remove();

        input.addEventListener('change', () => {
          const [file] = input.files ?? [];
          cleanup();

          if (file) {
            resolve(file);
            return;
          }

          reject(new Error('No file selected.'));
        });

        input.addEventListener('cancel', () => {
          cleanup();
          reject(new Error('File selection was cancelled.'));
        });
      });

    input.click();

    const file = await selectFile();
    const contents = await file.text();

    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      console.error('Unable to parse JSON file.', error);
      return null;
    }

    const shape = summarizeJsonShape(parsed);

    console.info(`JSON structure for ${file.name}:`);
    console.dir(shape, { depth: null });

    return shape;
  };

  logDeepDive('info', 'Deep dive pending request and call plan inspectors installed.');
};
