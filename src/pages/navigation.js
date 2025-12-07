import { initDebugToggle } from '../ui/debugToggle.js';

export const initDeepDiveNavigation = () => {
  const deepDiveButton = document.getElementById('deep-dive-button');

  if (!deepDiveButton) {
    return;
  }

  deepDiveButton.addEventListener('click', () => {
    window.location.href = 'deep_dive.html';
  });
};

export const initNavigation = () => {
  initDebugToggle();
  initDeepDiveNavigation();
};
