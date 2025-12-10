const RESPONSE_TOO_LARGE_MESSAGE = /too many data files/i;
const AGGREGATION_TIMEOUT_MESSAGE = /aggregation request timed out/i;
const GENERIC_TIMEOUT_MESSAGE = /timeout/i;
const TIMEOUT_STATUS_CODES = [408, 504, 524];

export const createAggregationError = (message, status, body, details = {}) => {
  const error = new Error(message);
  error.responseStatus = status;
  error.responseBody = body;
  error.details = {
    status: status ?? 'unknown status',
    body: body ?? '',
    ...details,
  };

  if (details?.isAbortError) {
    error.isAbortError = true;
  }

  if (details?.hint) {
    error.hint = details.hint;
  }

  return error;
};

export const isTooMuchDataOrTimeout = (error) => {
  const { responseStatus, responseBody, details, message, name, isAbortError } = error || {};
  const status = responseStatus ?? details?.status;
  const normalizedBody = (() => {
    const candidateBody = responseBody ?? details?.body;

    if (typeof candidateBody === 'string') {
      return candidateBody;
    }

    if (candidateBody && typeof candidateBody === 'object') {
      try {
        return JSON.stringify(candidateBody);
      } catch (serializationError) {
        return '';
      }
    }

    return '';
  })();
  const messageText = message || '';

  return (
    status === 413
    || TIMEOUT_STATUS_CODES.includes(status)
    || RESPONSE_TOO_LARGE_MESSAGE.test(messageText)
    || RESPONSE_TOO_LARGE_MESSAGE.test(normalizedBody || '')
    || AGGREGATION_TIMEOUT_MESSAGE.test(messageText)
    || AGGREGATION_TIMEOUT_MESSAGE.test(normalizedBody || '')
    || GENERIC_TIMEOUT_MESSAGE.test(messageText)
    || GENERIC_TIMEOUT_MESSAGE.test(normalizedBody || '')
    || name === 'AbortError'
    || isAbortError === true
  );
};

export const isTooMuchDataError = (error) => isTooMuchDataOrTimeout(error);

export const CHUNKING_TRIGGER_CONDITIONS = [
  'HTTP 413 Payload Too Large status.',
  'HTTP timeout status responses (408, 504, 524).',
  'Error names flagged as AbortError or marked with an abort flag.',
  'Error messages or bodies containing "too many data files".',
  'Error messages or bodies containing "aggregation request timed out".',
  'Error messages or bodies containing generic timeout wording.',
];

export { AGGREGATION_TIMEOUT_MESSAGE, RESPONSE_TOO_LARGE_MESSAGE };
