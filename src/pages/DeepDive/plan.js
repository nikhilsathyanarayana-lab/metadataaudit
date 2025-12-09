// Maintains the deep dive call plan so UI and debug helpers can reflect queued work.
import { DEEP_DIVE_REQUEST_SPACING_MS, logDeepDive } from '../deepDive/constants.js';
import { metadata_pending_api_calls, stagePendingCallTable } from '../deepDive/aggregation.js';

const API_CALL_TIMEOUT_MS = 60_000;

const deepDiveCallPlan = metadata_pending_api_calls;

const syncCallPlanToWindow = () => {
  if (typeof window !== 'undefined') {
    window.deepDiveCallPlan = deepDiveCallPlan;
  }
};

const stageDeepDiveCallPlan = (entries, lookbackDays) => {
  const timestamp = new Date().toISOString();
  const operation = 'deepDiveMetadata';

  const plannedEntries = entries.map((entry) => ({
    ...entry,
    operation: entry?.operation || operation,
  }));

  logDeepDive('debug', 'Staging deep dive call plan', {
    entryCount: plannedEntries.length,
    lookbackDays,
  });

  stagePendingCallTable(plannedEntries, lookbackDays, operation);

  deepDiveCallPlan.forEach((entry) => {
    entry.statusLabel = 'Queued';
    entry.detail = '';
    entry.plannedAt = timestamp;
    entry.updatedAt = timestamp;
  });

  syncCallPlanToWindow();

  if (entries.length) {
    logDeepDive('info', 'Prepared deep dive call plan', { plannedCalls: entries.length, lookbackDays });
  }

  return deepDiveCallPlan;
};

const updateDeepDiveCallPlanStatus = (entry, status, detail = '') => {
  const appId = typeof entry === 'string' ? entry : entry?.appId;

  if (!appId) {
    return null;
  }

  const target = deepDiveCallPlan.find((call) => call?.appId === appId);

  if (!target) {
    return null;
  }

  target.status = status;
  target.statusLabel = status;
  target.detail = detail;
  target.updatedAt = new Date().toISOString();

  syncCallPlanToWindow();

  return target;
};

syncCallPlanToWindow();

const calculateStallThreshold = (call) => {
  const queueIndex = metadata_pending_api_calls.findIndex((item) => item?.appId === call?.appId);
  const position = queueIndex === -1 ? 1 : queueIndex + 1;

  return API_CALL_TIMEOUT_MS + position * DEEP_DIVE_REQUEST_SPACING_MS;
};

export {
  API_CALL_TIMEOUT_MS,
  calculateStallThreshold,
  deepDiveCallPlan,
  stageDeepDiveCallPlan,
  syncCallPlanToWindow,
  updateDeepDiveCallPlanStatus,
};
