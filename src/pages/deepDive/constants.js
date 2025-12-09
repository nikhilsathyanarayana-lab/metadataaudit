import { createLogger } from '../../utils/logger.js';

// Deep dive constants and logging utilities for configuring metadata scans.
export const deepDiveGlobalKey = 'deepDiveMetaEvents';
export const metadataFieldGlobalKey = 'metadataFieldRecords';
export const appSelectionGlobalKey = 'appSelectionResponses';

export const LOOKBACK_OPTIONS = [7, 30, 180];
export const TARGET_LOOKBACK = 7;
export const DEEP_DIVE_CONCURRENCY = 1;
export const DEEP_DIVE_AGGREGATION_BATCH_SIZE = 25;
export const DEEP_DIVE_REQUEST_SPACING_MS = 3000;

const deepDiveLogger = createLogger('DeepDive', {
  debugFlag: ['DEBUG_LOGGING', 'DEBUG_DEEP_DIVE'],
});

const deepDiveWatchdogLogger = createLogger('DeepDive Watchdog', {
  debugFlag: ['DEBUG_LOGGING', 'DEBUG_DEEP_DIVE'],
  style: 'color: #1d4ed8; font-weight: 600;',
});

export const logDeepDive = deepDiveLogger.log;
export const logDeepDiveWatchdog = deepDiveWatchdogLogger.log;
export const logDeepDiveFunctionCall = (functionName, details = {}) => {
  logDeepDive('debug', 'Deep dive function invoked', { functionName, ...details });
};
