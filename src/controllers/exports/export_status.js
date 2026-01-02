import { ensureMessageRegion, renderRegionBanner } from '../../ui/statusBanner.js';
import { renderPendingQueueBanner } from '../../ui/pendingQueueBanner.js';

export const createExportStatusHelper = ({
  regionId = 'page-status-banner',
  className = 'page-status-banner page-messages',
  beforeSelector = 'header.page-header',
  buttonId = 'metadata-export-button',
} = {}) => {
  const statusRegion = ensureMessageRegion(regionId, { className, beforeSelector });
  const exportButton = buttonId ? document.getElementById(buttonId) : null;
  const previousButtonDisabled = exportButton?.disabled ?? false;

  const setStatus = (message, { tone = 'info', pending = false } = {}) => {
    if (statusRegion) {
      statusRegion.setAttribute('aria-busy', String(pending));
    }

    renderRegionBanner(statusRegion, message, tone, { ariaLive: tone === 'error' ? 'assertive' : 'polite' });

    if (exportButton) {
      exportButton.disabled = pending;
      exportButton.setAttribute('aria-disabled', String(pending));
      exportButton.setAttribute('aria-busy', String(pending));
    }
  };

  const restore = () => {
    renderPendingQueueBanner({ regionId, className, beforeSelector });
    statusRegion?.removeAttribute('aria-busy');

    if (exportButton) {
      exportButton.disabled = previousButtonDisabled;
      exportButton.setAttribute('aria-disabled', String(previousButtonDisabled));
      exportButton.removeAttribute('aria-busy');
    }
  };

  return { setStatus, restore };
};
