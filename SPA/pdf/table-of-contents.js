/*jslint browser: true */
/*jslint es6: true */

// Confirm that cached metadata aggregations are available on the window.
const hasMetadataAggregations = () => (
  typeof window !== 'undefined'
    && window.metadataAggregations
    && typeof window.metadataAggregations === 'object'
);

// Collect SubIDs from the metadata cache or return an empty collection when unavailable.
const getSubscriptionIds = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return [];
  }

  const ids = Object.keys(aggregations || {}).filter(Boolean);

  if (!ids.length) {
    return [];
  }

  return ids.sort((first, second) => first.localeCompare(second));
};

// Create a subscription entry from the template and apply identifiers.
const buildSubscriptionEntry = (template, subId, index) => {
  const clone = template?.content?.firstElementChild?.cloneNode(true);

  if (!clone) {
    return null;
  }

  const listIndex = String(index + 1).padStart(2, '0');
  const listItemId = `toc-entry-subscription-${listIndex}`;
  const linkId = `toc-link-subscription-${listIndex}`;
  const safeSubId = subId || 'Unknown SubID';
  const anchorTarget = encodeURIComponent(safeSubId);
  const link = clone.querySelector('[data-slot="subscription-link"]');

  clone.id = listItemId;
  clone.setAttribute('data-subscription-id', safeSubId);

  if (link) {
    link.id = linkId;
    link.textContent = `Subscription details - ${safeSubId}`;
    link.href = `subscription-details.html#subscription-card-${anchorTarget}`;
  }

  return clone;
};

// Process metadata updates from the parent window and refresh the TOC links.
const handleMetadataMessage = (event) => {
  const message = event?.data;

  if (!message || message.type !== 'metadataAggregations') {
    return;
  }

  const payload = message.payload || {};
  const nextAggregations = payload.metadataAggregations || payload;
  window.metadataAggregations = nextAggregations;
  renderSubscriptionEntries(window.metadataAggregations);
};

// Toggle an error message when the table of contents cannot be populated.
const toggleLoadError = (isVisible) => {
  const tocEntries = document.getElementById('toc-entries');
  const tocList = document.getElementById('toc-list');

  if (!tocEntries || !tocList) {
    return;
  }

  let errorMessage = document.getElementById('toc-load-error');

  if (!errorMessage && isVisible) {
    errorMessage = document.createElement('p');
    errorMessage.id = 'toc-load-error';
    errorMessage.className = 'toc-load-error';
    errorMessage.textContent = 'Table of contents could not be loaded.';
    tocEntries.appendChild(errorMessage);
  }

  if (errorMessage) {
    errorMessage.hidden = !isVisible;
  }

  if (isVisible) {
    tocList.setAttribute('hidden', 'hidden');
  } else {
    tocList.removeAttribute('hidden');
  }
};

// Render subscription detail links inside the table of contents.
const renderSubscriptionEntries = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  const tocList = document.getElementById('toc-list');
  const template = document.getElementById('toc-subscription-template');

  if (!tocList || !template) {
    return;
  }

  tocList.querySelectorAll('[data-subscription-entry]').forEach((entry) => entry.remove());

  const subIds = getSubscriptionIds(aggregations);

  if (!subIds.length) {
    toggleLoadError(true);
    return;
  }

  toggleLoadError(false);

  subIds.forEach((subId, index) => {
    const entry = buildSubscriptionEntry(template, subId, index);

    if (entry) {
      tocList.appendChild(entry);
    }
  });
};

// Initialize the table of contents with subscription detail links.
const initTableOfContents = () => {
  if (hasMetadataAggregations()) {
    renderSubscriptionEntries(window.metadataAggregations);
  } else {
    renderSubscriptionEntries({});
  }
};

window.addEventListener('message', handleMetadataMessage);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTableOfContents);
} else {
  initTableOfContents();
}
