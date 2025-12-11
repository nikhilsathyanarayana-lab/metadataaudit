import { logDeepDive } from './constants.js';

export const exposeDeepDiveDebugCommands = () => {
  if (typeof window === 'undefined') {
    return;
  }

  const debugEnabled = Boolean(window.DEBUG_LOGGING || window.DEEP_DIVE_DEBUG);
  const status = debugEnabled
    ? 'Deep dive debug console commands removed; nothing to register.'
    : 'Deep dive debug console commands are disabled.';

  logDeepDive('info', status);
};
