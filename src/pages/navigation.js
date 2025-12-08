import { initDebugToggle } from '../ui/debugToggle.js';
import { buildNavigation } from '../ui/navigation.js';

const initDeepDiveNavigation = () => {
  const deepDiveButton = document.getElementById('deep-dive-button');

  if (!deepDiveButton) {
    return;
  }

  deepDiveButton.addEventListener('click', () => {
    window.location.href = 'deep_dive.html';
  });
};

export const renderNavigation = (targetSelector = '#nav-root', options = {}) => {
  const target = document.querySelector(targetSelector);

  if (!target) {
    return;
  }

  const nav = buildNavigation(options);
  target.replaceChildren(nav);

  initDebugToggle();
  initDeepDiveNavigation();
};
