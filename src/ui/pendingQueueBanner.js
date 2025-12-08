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

export const createSharedApiStatusBanner = (options = {}) =>
  createPendingQueueStatusHelper({
    regionId: 'page-status-banner',
    className: 'page-status-banner page-messages',
    beforeSelector: 'header.page-header',
    ...options,
  });

export const createPendingQueueStatusHelper = ({
  regionId = 'page-status-banner',
  className = 'page-status-banner page-messages',
  beforeSelector = 'header.page-header',
  idleText = 'No API calls queued.',
  ariaLive = 'polite',
  formatProgressMessage = defaultFormatMessage,
  toneResolver,
} = {}) => {
  const notes = new Map();
  let toneOverride = '';

  const combineMessage = (messageParts) =>
    messageParts
      .filter(Boolean)
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' · ');

  const render = ({ message, tone } = {}) => {
    const resolvedNotes = Array.from(notes.values()).filter(Boolean);

    return renderPendingQueueBanner({
      regionId,
      className,
      beforeSelector,
      idleText,
      ariaLive,
      formatMessage: ({ total, completed, pendingCalls }) => {
        if (typeof message === 'string') {
          return combineMessage([message, ...resolvedNotes]) || idleText;
        }

        const progressMessage = formatProgressMessage({ total, completed, pendingCalls });
        const combined = combineMessage([progressMessage, ...resolvedNotes]);
        return combined || idleText;
      },
      tone: ({ pendingCalls }) => {
        if (tone) {
          return tone;
        }

        if (toneOverride) {
          return toneOverride;
        }

        const pendingFailure = pendingCalls?.some((call) => call?.status === 'failed');
        const fallbackTone = pendingFailure ? 'warning' : 'info';
        return typeof toneResolver === 'function'
          ? toneResolver({ pendingCalls, notes: resolvedNotes, fallbackTone })
          : fallbackTone;
      },
    });
  };

  const setNote = (key, value) => {
    if (key === undefined || key === null) {
      return;
    }

    if (value) {
      notes.set(key, value);
    } else {
      notes.delete(key);
    }

    render();
  };

  const setNotes = (noteList = []) => {
    notes.clear();
    noteList.filter(Boolean).forEach((note, index) => notes.set(index, note));
    render();
  };

  const setToneOverride = (tone) => {
    toneOverride = tone || '';
    render();
  };

  const clearNotes = () => {
    notes.clear();
    render();
  };

  return {
    render,
    setNote,
    setNotes,
    clearNotes,
    setToneOverride,
  };
};
