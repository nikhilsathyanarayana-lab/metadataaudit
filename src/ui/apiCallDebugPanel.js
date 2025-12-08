import { createLogger } from '../utils/logger.js';
import {
  metadata_api_calls,
  metadata_pending_api_calls,
  summarizePendingCallProgress,
} from '../pages/deepDive/aggregation.js';

const PANEL_ID = 'api-call-debug-panel';
const PANEL_CLASS = 'debug-call-panel';
const debugPanelLogger = createLogger('ApiCallDebugPanel');

const isDebugEnabled = () => Boolean(window?.DEBUG_LOGGING || window?.DEBUG_DEEP_DIVE);

const formatTimestamp = (timestamp) => {
  if (!timestamp) {
    return '';
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const formatCallLabel = (call) => {
  const parts = [];

  if (call?.operation) {
    parts.push(call.operation);
  }

  if (call?.appId) {
    parts.push(`App ${call.appId}`);
  }

  if (call?.subId) {
    parts.push(`Sub ${call.subId}`);
  }

  const countLabel = call?.requestCount > 1 ? `x${call.requestCount}` : '';
  const statusLabel = call?.status ? call.status : 'unknown';
  const timeLabel = formatTimestamp(call?.startedAt || call?.queuedAt || call?.completedAt);

  return `${parts.join(' · ')} — ${statusLabel} ${countLabel}`.trim() + (timeLabel ? ` (${timeLabel})` : '');
};

const renderList = (target, calls, emptyMessage) => {
  if (!target) {
    return;
  }

  target.innerHTML = '';

  if (!calls.length) {
    const empty = document.createElement('li');
    empty.textContent = emptyMessage;
    target.appendChild(empty);
    return;
  }

  calls.forEach((call) => {
    const item = document.createElement('li');
    item.textContent = formatCallLabel(call);
    target.appendChild(item);
  });
};

const getRecentCompletedCalls = (limit = 5) => {
  const completedPending = metadata_pending_api_calls.filter((call) => call?.status === 'completed');
  const combined = [...completedPending, ...metadata_api_calls];
  return combined.slice(-limit).reverse();
};

const getPendingCalls = () =>
  metadata_pending_api_calls
    .filter((call) => call?.status && call.status !== 'completed')
    .sort((a, b) => (a?.queuedAt || '').localeCompare(b?.queuedAt || ''));

export const initApiCallDebugPanel = (targetSelector = 'body') => {
  if (document.getElementById(PANEL_ID)) {
    return;
  }

  const host = targetSelector === 'body' ? document.body : document.querySelector(targetSelector);

  if (!host) {
    debugPanelLogger.warn('Unable to initialize API call debug panel; host not found.');
    return;
  }

  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.className = PANEL_CLASS;
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;

  const title = document.createElement('h3');
  title.className = 'debug-call-panel__title';
  title.textContent = 'API Calls (Debug)';

  const summary = document.createElement('p');
  summary.className = 'debug-call-panel__summary';

  const pendingList = document.createElement('ul');
  pendingList.className = 'debug-call-panel__list';

  const completedList = document.createElement('ul');
  completedList.className = 'debug-call-panel__list';

  panel.appendChild(title);
  panel.appendChild(summary);

  const pendingHeader = document.createElement('h4');
  pendingHeader.className = 'debug-call-panel__subtitle';
  pendingHeader.textContent = 'Pending / In-flight';
  panel.appendChild(pendingHeader);
  panel.appendChild(pendingList);

  const completedHeader = document.createElement('h4');
  completedHeader.className = 'debug-call-panel__subtitle';
  completedHeader.textContent = 'Recent completions';
  panel.appendChild(completedHeader);
  panel.appendChild(completedList);

  const renderPanel = () => {
    const debugEnabled = isDebugEnabled();
    panel.hidden = !debugEnabled;

    if (!debugEnabled) {
      return;
    }

    const { total, completed } = summarizePendingCallProgress();
    const boundedCompleted = Math.min(completed, total);
    const summaryText = total ? `Calls: ${boundedCompleted} / ${total}` : 'No API calls queued.';
    summary.textContent = summaryText;

    renderList(pendingList, getPendingCalls(), 'No pending calls.');
    renderList(completedList, getRecentCompletedCalls(), 'No completed calls recorded.');
  };

  window.addEventListener('pending-calls-updated', renderPanel);
  window.addEventListener('api-calls-updated', renderPanel);
  window.addEventListener('debug-mode-changed', renderPanel);

  renderPanel();
  host.appendChild(panel);
  debugPanelLogger.info('API call debug panel initialized.');
};
