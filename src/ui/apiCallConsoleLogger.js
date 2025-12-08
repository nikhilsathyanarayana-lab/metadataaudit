import { createLogger } from '../utils/logger.js';
import {
  metadata_api_calls,
  metadata_pending_api_calls,
  summarizePendingCallProgress,
} from '../pages/deepDive/aggregation.js';

const consoleLogger = createLogger('ApiCallConsoleLogger');
const isDebugEnabled = () =>
  typeof window !== 'undefined' && Boolean(window.DEBUG_LOGGING || window.DEBUG_DEEP_DIVE);

const formatPendingCalls = () =>
  metadata_pending_api_calls.map((call) => ({
    key: call?.queueKey || call?.appId || 'unknown',
    operation: call?.operation || 'pending',
    appId: call?.appId ?? '',
    subId: call?.subId ?? '',
    status: call?.status || 'queued',
    requests: call?.requestCount ?? 1,
    queuedAt: call?.queuedAt || '',
    startedAt: call?.startedAt || '',
    completedAt: call?.completedAt || '',
    error: call?.error || '',
  }));

const formatRecentRecordedCalls = (limit = 10) =>
  metadata_api_calls.slice(-limit).map((call) => ({
    appId: call?.appId ?? '',
    subId: call?.subId ?? '',
    status: call?.status || 'unknown',
    datasets: call?.datasetCount ?? 0,
    error: call?.error || '',
    recordedAt: call?.recordedAt || '',
  }));

const logSnapshot = (reason = 'update') => {
  if (!isDebugEnabled()) {
    return;
  }

  const progress = summarizePendingCallProgress();
  const pending = formatPendingCalls();
  const recent = formatRecentRecordedCalls();

  consoleLogger.info('API call debug snapshot', {
    reason,
    progress,
    pending,
    recent,
  });
};

const logPaused = () => consoleLogger.info('API call debug logging disabled.');

export const initApiCallConsoleLogger = () => {
  if (typeof window === 'undefined') {
    return;
  }

  if (window.__apiCallConsoleLoggerInitialized) {
    return;
  }

  window.__apiCallConsoleLoggerInitialized = true;

  window.addEventListener('pending-calls-updated', () => logSnapshot('pending-calls-updated'));
  window.addEventListener('api-calls-updated', () => logSnapshot('api-calls-updated'));

  window.addEventListener('debug-mode-changed', (event) => {
    if (event?.detail?.enabled) {
      logSnapshot('debug-mode-enabled');
      return;
    }

    logPaused();
  });

  if (isDebugEnabled()) {
    logSnapshot('debug-mode-initial');
  }
};
