const NAV_LINKS = [
  { id: 'integration', href: 'index.html', label: 'Integration API' },
  { id: 'cookie', href: 'cookie_method.html', label: 'Cookie' },
];

const buildLink = ({ id, href, label }, activePage) => {
  const link = document.createElement('a');
  link.className = 'nav-link';
  link.href = href;
  link.textContent = label;

  if (id === activePage) {
    link.setAttribute('aria-current', 'page');
  }

  return link;
};

export const buildNavigation = (options = {}) => {
  const { activePage } = options;
  const nav = document.createElement('nav');
  nav.className = 'global-nav';
  nav.setAttribute('aria-label', 'Primary');

  const inner = document.createElement('div');
  inner.className = 'nav-inner';

  const linksContainer = document.createElement('div');
  linksContainer.className = 'nav-links';

  NAV_LINKS.map((linkConfig) => buildLink(linkConfig, activePage)).forEach((link) =>
    linksContainer.appendChild(link)
  );

  const debugToggle = document.createElement('label');
  debugToggle.className = 'debug-toggle';
  debugToggle.htmlFor = 'debug-toggle';
  debugToggle.innerHTML = `
    <span class="debug-toggle-text">Debug</span>
    <span class="debug-toggle-control">
      <input
        type="checkbox"
        id="debug-toggle"
        aria-label="Toggle deep dive debug logging"
      />
      <span class="debug-toggle-slider" aria-hidden="true"></span>
    </span>
    <span class="debug-toggle-status" id="debug-toggle-status">Off</span>
  `;

  inner.appendChild(linksContainer);
  inner.appendChild(debugToggle);
  nav.appendChild(inner);

  return nav;
};
