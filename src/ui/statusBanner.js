const toneConfig = {
  error: { className: 'alert', role: 'alert' },
  warning: { className: 'status-banner', role: 'status' },
  success: { className: 'status-banner', role: 'status' },
  info: { className: 'status-banner', role: 'status' },
};

export const applyBannerTone = (element, tone = 'info') => {
  if (!element) {
    return;
  }

  const config = toneConfig[tone] || toneConfig.info;

  element.className = config.className;
  element.setAttribute('role', config.role);
};

export const setBannerText = (element, message) => {
  if (!element) {
    return;
  }

  element.textContent = message;
};

export const createBanner = (message, tone = 'info', { id, ariaLive } = {}) => {
  const banner = document.createElement('p');
  if (id) {
    banner.id = id;
  }

  applyBannerTone(banner, tone);

  if (ariaLive) {
    banner.setAttribute('aria-live', ariaLive);
  }

  setBannerText(banner, message);
  return banner;
};

export const ensureMessageRegion = (regionId, { className = 'page-messages', beforeSelector = 'main.content' } = {}) => {
  const existing = document.getElementById(regionId);
  if (existing) {
    return existing;
  }

  const existingByClass = document.querySelector(`.${className.split(' ')[0]}`);
  if (existingByClass) {
    existingByClass.id = regionId;
    existingByClass.className = className;
    return existingByClass;
  }

  const region = document.createElement('div');
  region.id = regionId;
  region.className = className;

  const parent = document.querySelector(beforeSelector)?.parentNode || document.body;
  parent?.insertBefore(region, parent.querySelector(beforeSelector) || parent.firstChild);
  return region;
};

export const renderRegionBanner = (region, message, tone = 'info', options = {}) => {
  if (!region) {
    return null;
  }

  region.innerHTML = '';
  if (!message) {
    return null;
  }

  const banner = createBanner(message, tone, options);
  region.appendChild(banner);
  return banner;
};
