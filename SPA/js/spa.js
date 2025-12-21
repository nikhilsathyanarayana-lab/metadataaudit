import { initSubIdForm } from '../../src/controllers/subidForm.js';
import { renderNavigation } from '../../src/pages/navigation.js';
import { bootstrapShared } from '../../src/entries/shared.js';
import { clearPendingCallQueue } from '../../src/pages/deepDive/aggregation.js';
import { initApiCallConsoleLogger } from '../../src/ui/apiCallConsoleLogger.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderNavigation('#nav-root', { activePage: 'spa' });
  clearPendingCallQueue();
  initApiCallConsoleLogger();
  await bootstrapShared();
  initSubIdForm();
  initPageSwitcher();
});

function initPageSwitcher() {
  const pageButtons = document.querySelectorAll('[data-page-btn]');
  const pageSections = document.querySelectorAll('[data-page-section]');
  const defaultPageId = '1';

  if (!pageButtons.length || !pageSections.length) {
    return;
  }

  const setActivePage = (pageId) => {
    pageButtons.forEach((button) => {
      const isActive = button.dataset.pageBtn === pageId;
      button.classList.toggle('page-switcher__btn--active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    pageSections.forEach((section) => {
      const isActive = section.dataset.pageSection === pageId;
      section.toggleAttribute('hidden', !isActive);
    });
  };

  pageButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setActivePage(button.dataset.pageBtn);
    });
  });

  setActivePage(defaultPageId);
}
