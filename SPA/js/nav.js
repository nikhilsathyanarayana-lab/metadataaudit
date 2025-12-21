import { initDebugToggle } from '../../src/ui/debugToggle.js';

const NAV_TEMPLATE_PATH = 'SPA/html/nav.html';

const fetchNavMarkup = async () => {
  const response = await fetch(NAV_TEMPLATE_PATH, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`Unable to load SPA navigation: ${response.status}`);
  }

  return response.text();
};

const setActiveLink = (navElement, activePage) => {
  if (!activePage) {
    return;
  }

  const activeLink = navElement.querySelector(`[data-nav-id="${activePage}"]`);

  if (activeLink) {
    activeLink.setAttribute('aria-current', 'page');
  }
};

export const renderSpaNavigation = async (targetSelector = '#nav-root', options = {}) => {
  const target = document.querySelector(targetSelector);

  if (!target) {
    return;
  }

  const { activePage } = options;
  const markup = await fetchNavMarkup();
  const template = document.createElement('template');
  template.innerHTML = markup.trim();

  const navElement = template.content.firstElementChild;

  if (!navElement) {
    throw new Error('Navigation template did not return valid markup.');
  }

  setActiveLink(navElement, activePage);
  target.replaceChildren(navElement);

  initDebugToggle();
};
