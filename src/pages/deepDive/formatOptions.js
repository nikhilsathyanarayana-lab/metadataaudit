import { createLogger } from '../../utils/logger.js';

export const REGEX_FORMAT_OPTION = 'regex';
export const DEFAULT_FORMAT_OPTION = 'unknown';
export const FORMAT_OPTIONS = ['email', 'text', REGEX_FORMAT_OPTION, 'number', DEFAULT_FORMAT_OPTION];

const logger = createLogger('FormatOptions');

export const normalizeFormatOption = (option) => {
  if (FORMAT_OPTIONS.includes(option)) {
    return option;
  }

  logger.debug?.('Unexpected format option encountered; defaulting to unknown.', { option });
  return DEFAULT_FORMAT_OPTION;
};
