import { ensureMessageRegion, renderRegionBanner } from './statusBanner.js';
import { getOutstandingPendingCalls, summarizePendingCallProgress } from '../pages/deepDive/aggregation.js';

const defaultFormatMessage = ({ total, completed }) => {
  if (!total) {
    return 'No API calls queued.';
  }

  const boundedCompleted = Math.min(completed, total);
  return `API calls completed ${boundedCompleted} of ${total}`;
};

export const renderPendingQueueBanner = ({
  regionId = 'page-status-banner',
  className = 'page-status-banner page-messages',
  beforeSelector = 'header.page-header',
  idleText = 'No API calls queued.',
  formatMessage = defaultFormatMessage,
  tone,
  ariaLive = 'polite',
} = {}) => {
  const region = ensureMessageRegion(regionId, { className, beforeSelector });
  const { total, completed } = summarizePendingCallProgress();
  const boundedCompleted = Math.max(0, Math.min(Number(completed) || 0, Number(total) || 0));
  const normalizedTotal = Math.max(0, Number(total) || 0);
  const pendingCalls = getOutstandingPendingCalls();
  const hasFailed = pendingCalls.some((call) => call?.status === 'failed');

  const message =
    typeof formatMessage === 'function'
      ? formatMessage({ total: normalizedTotal, completed: boundedCompleted, pendingCalls })
      : normalizedTotal
        ? `API calls completed ${boundedCompleted} of ${normalizedTotal}`
        : idleText;

  const resolvedTone =
    typeof tone === 'function'
      ? tone({ total: normalizedTotal, completed: boundedCompleted, pendingCalls })
      : tone || (hasFailed ? 'warning' : 'info');

  return renderRegionBanner(region, message, resolvedTone, {
    ariaLive: resolvedTone === 'error' ? 'assertive' : ariaLive,
  });
};
