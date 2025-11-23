const defaultPendoDomains = [
  { label: 'pendo.io', value: 'https://app.pendo.io/' },
  { label: 'eu', value: 'https://app.eu.pendo.io/' },
  { label: 'us1', value: 'https://us1.app.pendo.io/' },
  { label: 'jpn', value: 'https://app.jpn.pendo.io/' },
  { label: 'au', value: 'https://app.au.pendo.io/' },
  { label: 'HSBC', value: 'https://app.HSBC.pendo.io/' },
];

const buildButton = (label, className, onClick, ariaLabel) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;

  if (ariaLabel) {
    button.setAttribute('aria-label', ariaLabel);
  }

  if (onClick) {
    button.addEventListener('click', onClick);
  }

  return button;
};

export const createDomainSelect = (domains = defaultPendoDomains, options = {}) => {
  const { className = 'domain-select', name = 'pendo-domain[]' } = options;
  const select = document.createElement('select');
  select.className = className;
  select.name = name;

  domains.forEach(({ label, value }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });

  return select;
};

export const createAddButton = (onClick, options = {}) => {
  const { label = '+', className = 'add-subid-btn', ariaLabel = 'Add another SubID' } = options;

  return buildButton(label, className, onClick, ariaLabel);
};

export const createRemoveButton = (onClick, options = {}) => {
  const { label = '-', className = 'remove-subid-btn', ariaLabel = 'Remove SubID' } = options;

  return buildButton(label, className, onClick, ariaLabel);
};

export const createModalControls = (modalElement, backdropElement) => {
  const toggleVisibility = (isVisible) => {
    if (!modalElement) {
      return;
    }

    modalElement.hidden = !isVisible;
    modalElement.classList.toggle('is-visible', isVisible);

    if (backdropElement) {
      backdropElement.hidden = !isVisible;
      backdropElement.classList.toggle('is-visible', isVisible);
    }
  };

  const open = () => toggleVisibility(true);
  const close = () => toggleVisibility(false);

  return { open, close };
};
