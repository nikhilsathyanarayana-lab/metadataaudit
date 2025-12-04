const normalizeLevel = (level) => {
  const normalized = String(level).toLowerCase();
  return ['error', 'warn', 'info', 'debug'].includes(normalized) ? normalized : 'info';
};

const resolveLogger = (level) => {
  if (level === 'error' && typeof console?.error === 'function') {
    return console.error;
  }

  if (typeof console?.[level] === 'function') {
    return console[level];
  }

  return console.log;
};

const isFlagEnabled = (flag) => {
  if (typeof flag === 'boolean') {
    return flag;
  }

  if (typeof flag === 'string' && typeof window !== 'undefined') {
    return Boolean(window[flag]);
  }

  return false;
};

export const createLogger = (scope = 'App', options = {}) => {
  const { debugFlag = 'DEBUG_LOGGING', gateNonErrorLevels = false } = options;
  const prefix = `[${scope}]`;

  const logWithLevel = (level, ...messages) => {
    const normalizedLevel = normalizeLevel(level);
    const debugEnabled = isFlagEnabled(debugFlag);

    if (normalizedLevel === 'debug' && !debugEnabled) {
      return;
    }

    if (gateNonErrorLevels && !debugEnabled && normalizedLevel !== 'error') {
      return;
    }

    const logger = resolveLogger(normalizedLevel);
    logger(prefix, ...messages);
  };

  return {
    log: logWithLevel,
    debug: (...messages) => logWithLevel('debug', ...messages),
    info: (...messages) => logWithLevel('info', ...messages),
    warn: (...messages) => logWithLevel('warn', ...messages),
    error: (...messages) => logWithLevel('error', ...messages),
  };
};

export default createLogger;
