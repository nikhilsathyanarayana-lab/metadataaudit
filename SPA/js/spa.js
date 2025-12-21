import { renderNavigation } from '../../src/pages/navigation.js';
import { bootstrapShared } from '../../src/entries/shared.js';
import { clearPendingCallQueue } from '../../src/pages/deepDive/aggregation.js';
import { initApiCallConsoleLogger } from '../../src/ui/apiCallConsoleLogger.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'spa' });
  clearPendingCallQueue();
  initApiCallConsoleLogger();
  await bootstrapShared();
  initPageSwitcher();
});

function initPageSwitcher() {
  const pageButtons = document.querySelectorAll('[data-page-btn]');
  const sectionContainer = document.querySelector('[data-page-container]');
  const statusElement = document.querySelector('[data-page-status]');
  const sectionCache = new Map();
  const defaultPageId = pageButtons[0]?.dataset.pageBtn ?? '1';

  if (!pageButtons.length || !sectionContainer) {
    return;
  }

  let activePageId = null;

  const setActiveButton = (pageId) => {
    pageButtons.forEach((button) => {
      const isActive = button.dataset.pageBtn === pageId;
      button.classList.toggle('page-switcher__btn--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const showStatus = (message) => {
    if (!statusElement) {
      return;
    }

    if (message) {
      statusElement.textContent = message;
      statusElement.hidden = false;
    } else {
      statusElement.textContent = '';
      statusElement.hidden = true;
    }
  };

  const fetchSectionMarkup = async (pageId) => {
    const response = await fetch(`../html/${pageId}.html`, { cache: 'no-cache' });

    if (!response.ok) {
      throw new Error(`Unable to load view ${pageId}: ${response.status}`);
    }

    return response.text();
  };

  const getInitializer = (pageId) => {
    const loaders = {
      1: () => import('./1.js'),
      2: () => import('./2.js'),
      3: () => import('./3.js'),
      4: () => import('./4.js'),
      5: () => import('./5.js'),
    };

    return loaders[pageId] || null;
  };

  const renderPage = async (pageId) => {
    if (pageId === activePageId) {
      return;
    }

    setActiveButton(pageId);
    showStatus('Loading view...');

    try {
      let sectionEntry = sectionCache.get(pageId);

      if (!sectionEntry) {
        const markup = await fetchSectionMarkup(pageId);
        const template = document.createElement('template');
        template.innerHTML = markup.trim();
        const element = template.content.firstElementChild;

        if (!element) {
          throw new Error(`View ${pageId} did not return any markup.`);
        }

        const initializerLoader = getInitializer(pageId);
        sectionEntry = { element, initialized: false, initializerLoader };
        sectionCache.set(pageId, sectionEntry);
      }

      sectionContainer.replaceChildren(sectionEntry.element);
      activePageId = pageId;

      if (!sectionEntry.initialized && sectionEntry.initializerLoader) {
        const module = await sectionEntry.initializerLoader();
        if (module?.initSection) {
          await module.initSection(sectionEntry.element);
        }
        sectionEntry.initialized = true;
      }
      showStatus('');
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error);
      showStatus('There was a problem loading this view.');
    }
  };

  pageButtons.forEach((button) => {
    button.addEventListener('click', () => {
      renderPage(button.dataset.pageBtn);
    });
  });

  renderPage(defaultPageId);
}
