const RESPONSE_TOO_LARGE_MESSAGE = /too many data files/i;
const AGGREGATION_TIMEOUT_MESSAGE = /aggregation request timed out/i;

export const createAggregationError = (message, status, body) => {
  const error = new Error(message);
  error.responseStatus = status;
  error.responseBody = body;
  error.details = {
    status: status ?? 'unknown status',
    body: body ?? '',
  };
  return error;
};

export const isTooMuchDataOrTimeout = (error) => {
  const { responseStatus, responseBody, details, message, name, isAbortError } = error || {};
  const status = responseStatus ?? details?.status;
  const bodyText = typeof (responseBody ?? details?.body) === 'string' ? responseBody ?? details?.body : '';
  const messageText = message || '';

  return (
    status === 413
    || RESPONSE_TOO_LARGE_MESSAGE.test(messageText)
    || RESPONSE_TOO_LARGE_MESSAGE.test(bodyText || '')
    || AGGREGATION_TIMEOUT_MESSAGE.test(messageText)
    || AGGREGATION_TIMEOUT_MESSAGE.test(bodyText || '')
    || name === 'AbortError'
    || isAbortError === true
  );
};

export const isTooMuchDataError = (error) => isTooMuchDataOrTimeout(error);

export { AGGREGATION_TIMEOUT_MESSAGE, RESPONSE_TOO_LARGE_MESSAGE };
