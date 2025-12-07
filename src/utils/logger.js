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

const getTimestamp = () => new Date().toISOString();

const formatPrefix = (scopePrefix, level, debugEnabled) => {
  const levelTag = `[${String(level).toUpperCase()}]`;

  if (!debugEnabled) {
    return `${scopePrefix} ${levelTag}`;
  }

  return `${scopePrefix} ${levelTag} [${getTimestamp()}]`;
};

export const createLogger = (scope = 'App', options = {}) => {
  const { debugFlag = 'DEBUG_LOGGING' } = options;
  const prefix = `[${scope}]`;

  const logWithLevel = (level, ...messages) => {
    const normalizedLevel = normalizeLevel(level);
    const debugEnabled = isFlagEnabled(debugFlag);

    const logger = resolveLogger(normalizedLevel);
    const formattedPrefix = formatPrefix(prefix, normalizedLevel, debugEnabled);
    logger(formattedPrefix, ...messages);
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
