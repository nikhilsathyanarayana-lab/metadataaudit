// Deep dive constants and logging utilities for configuring metadata scans.
export const deepDiveGlobalKey = 'deepDiveMetaEvents';
export const metadataFieldGlobalKey = 'metadataFieldRecords';
export const appSelectionGlobalKey = 'appSelectionResponses';

export const LOOKBACK_OPTIONS = [7, 30, 180];
export const TARGET_LOOKBACK = 7;
export const DEEP_DIVE_CONCURRENCY = 2;
export const DEEP_DIVE_AGGREGATION_BATCH_SIZE = 25;

const DEBUG_DEEP_DIVE = (typeof window !== 'undefined' && Boolean(window.DEBUG_DEEP_DIVE)) || false;

export const logDeepDive = (level, ...messages) => {
  const normalizedLevel = level === 'error' || level === 'warn' || level === 'debug' ? level : 'info';

  if (!DEBUG_DEEP_DIVE && normalizedLevel !== 'error') {
    return;
  }

  const logger =
    normalizedLevel === 'error' && typeof console?.error === 'function'
      ? console.error
      : typeof console?.[normalizedLevel] === 'function'
        ? console[normalizedLevel]
        : console.log;

  logger('[DeepDive]', ...messages);
};
