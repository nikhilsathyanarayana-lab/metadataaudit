import {
  applyBannerTone,
  ensureMessageRegion as ensureBannerRegion,
  renderRegionBanner,
  setBannerText,
} from './statusBanner.js';

const toneLiveRegion = {
  error: 'assertive',
  warning: 'polite',
  success: 'polite',
  info: 'polite',
};

const resolveAriaLive = (tone) => toneLiveRegion[tone] || toneLiveRegion.info;

export const ensureMessageRegion = (regionId, options) => ensureBannerRegion(regionId, options);

export const showMessage = (region, message, tone = 'info') =>
  renderRegionBanner(region, message, tone, { ariaLive: resolveAriaLive(tone) });

const defaultLogError = (message, error) => {
  if (error !== undefined) {
    console.error(message, error);
    return;
  }

  console.error(message);
};

export const createErrorReporter = ({ logError = defaultLogError, fallbackIds = [] } = {}) => {
  const resolveFallbackTarget = () =>
    fallbackIds
      .map((id) => document.getElementById(id))
      .find((element) => element instanceof HTMLElement);

  return (message, error, region = null) => {
    if (typeof logError === 'function') {
      logError(message, error);
    }

    if (region) {
      showMessage(region, message, 'error');
      return;
    }

    const fallbackTarget = resolveFallbackTarget();
    if (fallbackTarget) {
      setBannerText(fallbackTarget, message);
      applyBannerTone(fallbackTarget, 'error');
    }
  };
};
