import { renderSpaNavigation } from './nav.js';

// Wait for the DOM to be parsed before wiring up SPA navigation and page switching.
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await renderSpaNavigation('#nav-root', { activePage: 'spa' });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Unable to render SPA navigation.', error);
  }

  initPageSwitcher();
});

// Wire up SPA section switching and lazy initialization.
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

  // Toggle button styling and aria state for the active page.
  const setActiveButton = (pageId) => {
    pageButtons.forEach((button) => {
      const isActive = button.dataset.pageBtn === pageId;
      button.classList.toggle('page-switcher__btn--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  // Show loading or error status messages in the UI.
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

  // Retrieve HTML markup for the requested SPA section.
  const fetchSectionMarkup = async (pageId) => {
    const pageUrl = new URL(`../html/${pageId}.html`, import.meta.url);
    const response = await fetch(pageUrl, { cache: 'no-cache' });

    if (!response.ok) {
      throw new Error(`Unable to load view ${pageId}: ${response.status}`);
    }

    return response.text();
  };

  // Resolve the initializer module for a given page ID.
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

  // Swap visible sections and invoke any page-specific initializer.
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
