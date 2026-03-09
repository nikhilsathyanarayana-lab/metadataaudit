import { ensureMessageRegion, renderRegionBanner } from './statusBanner.js';
import {
  getOutstandingPendingCalls,
  metadata_pending_api_calls,
  summarizePendingCallProgress,
} from '../pages/deepDive/aggregation.js';

const defaultFormatMessage = ({ total, completed, pendingCalls }) => {
  if (!total) {
    return 'No API calls queued.';
  }

  const boundedCompleted = Math.min(completed, total);
  const waiting = pendingCalls.filter(
    (call) => call?.status === 'queued' || call?.status === 'in-flight',
  ).length;

  return `API calls waiting: ${waiting} · completed: ${boundedCompleted} of ${total}`;
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
  const failedCount = metadata_pending_api_calls.filter((call) => call?.status === 'failed').length;

  const baseMessage =
    typeof formatMessage === 'function'
      ? formatMessage({ total: normalizedTotal, completed: boundedCompleted, pendingCalls, failedCount })
      : normalizedTotal
        ? `API calls completed ${boundedCompleted} of ${normalizedTotal}`
        : idleText;

  const message = failedCount > 0 ? `${baseMessage} · ${failedCount} failed` : baseMessage;

  const resolvedTone =
    typeof tone === 'function'
      ? tone({ total: normalizedTotal, completed: boundedCompleted, pendingCalls, failedCount })
      : tone || (failedCount > 0 ? 'warning' : 'info');

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
      .filter((part) => part !== undefined && part !== null)
      .map((part) => String(part).trim())
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
      formatMessage: ({ total, completed, pendingCalls, failedCount }) => {
        if (typeof message === 'string') {
          return combineMessage([message, ...resolvedNotes]) || idleText;
        }

        const progressMessage = formatProgressMessage({ total, completed, pendingCalls, failedCount });
        const combined = combineMessage([progressMessage, ...resolvedNotes]);
        return combined || idleText;
      },
      tone: ({ pendingCalls, failedCount }) => {
        if (tone) {
          return tone;
        }

        if (toneOverride) {
          return toneOverride;
        }

        const fallbackTone = failedCount > 0 ? 'warning' : 'info';
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
