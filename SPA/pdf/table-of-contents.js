/*jslint browser: true */
/*jslint es6: true */

const defaultSubscriptionIds = Array.from({ length: 5 }, (_, index) => `Sub ${String(index + 1).padStart(2, '0')}`);
const tableOfContentsStartPage = 1;
const firstContentPage = tableOfContentsStartPage + 1;
const staticTableOfContentsEntries = [
  {
    entryId: 'toc-entry-overview',
    description: 'Snapshot of subscriptions, scanned applications, and coverage.',
  },
  {
    entryId: 'toc-entry-field-analysis',
    description: 'Field-level completeness analysis across the scanned subscriptions.',
  },
  {
    entryId: 'toc-entry-field-summary',
    description: 'Quick field summary with high-level coverage and readiness signals.',
  },
  {
    entryId: 'toc-entry-subscription-details',
    description: 'Aggregated subscription details with metadata coverage highlights.',
  },
  {
    entryId: 'toc-entry-application-details',
    description: 'Application-level metadata with readiness cues for each subscription.',
  },
];

// Confirm that cached metadata aggregations are available on the window.
const hasMetadataAggregations = () => (
  typeof window !== 'undefined'
    && window.metadataAggregations
    && typeof window.metadataAggregations === 'object'
);

let subscriptionLabels = (typeof window !== 'undefined' && window.subscriptionLabels
  && typeof window.subscriptionLabels === 'object')
  ? window.subscriptionLabels
  : {};

// Resolve SubID display text from the label map with a raw SubID fallback.
const resolveSubscriptionDisplay = (subId) => {
  const key = String(subId || '');
  return subscriptionLabels[key] || key || 'Unknown SubID';
};

// Format a visible SubID label while retaining the raw identifier for structure.
const formatSubscriptionDisplay = (subId) => {
  const rawSubId = String(subId || 'Unknown SubID');
  const label = resolveSubscriptionDisplay(rawSubId);

  if (label !== rawSubId) {
    return `${label} (${rawSubId})`;
  }

  return label;
};

// Collect SubIDs from the metadata cache or return sample identifiers.
const getSubscriptionIds = (aggregations = (hasMetadataAggregations() && window.metadataAggregations)) => {
  if (!aggregations || typeof aggregations !== 'object') {
    return defaultSubscriptionIds;
  }

  const ids = Object.keys(aggregations || {}).filter(Boolean);

  if (!ids.length) {
    return defaultSubscriptionIds;
  }

  return ids.sort((first, second) => formatSubscriptionDisplay(first).localeCompare(formatSubscriptionDisplay(second))
    || first.localeCompare(second));
};

// Populate page numbers and descriptions for the static TOC entries.
const applyStaticEntryMetadata = () => {
  staticTableOfContentsEntries.forEach((entry, index) => {
    const entryElement = document.getElementById(entry.entryId);
    const pageNumber = firstContentPage + index;

    applyEntryDetails(entryElement, pageNumber, entry.description);
  });
};

// Apply page number and description to a table of contents entry.
const applyEntryDetails = (entryElement, pageNumber, description) => {
  if (!entryElement) {
    return;
  }

  const pageNumberSlot = entryElement.querySelector('[data-slot="page-number"]');
  const descriptionSlot = entryElement.querySelector('[data-slot="page-description"]');

  if (pageNumberSlot) {
    pageNumberSlot.textContent = `Page ${pageNumber}`;
  }

  if (descriptionSlot) {
    descriptionSlot.textContent = description;
  }
};

// Create a subscription entry from the template and apply identifiers.
const buildSubscriptionEntry = (template, subId, index, pageNumber) => {
  const clone = template?.content?.firstElementChild?.cloneNode(true);

  if (!clone) {
    return null;
  }

  const listIndex = String(index + 1).padStart(2, '0');
  const listItemId = `toc-entry-subscription-${listIndex}`;
  const linkId = `toc-link-subscription-${listIndex}`;
  const rawSubId = subId || 'Unknown SubID';
  const subDisplay = formatSubscriptionDisplay(rawSubId);
  const anchorTarget = encodeURIComponent(rawSubId);
  const link = clone.querySelector('[data-slot="subscription-link"]');
  const pageNumberElement = clone.querySelector('[data-slot="page-number"]');
  const descriptionElement = clone.querySelector('[data-slot="page-description"]');

  clone.id = listItemId;
  clone.setAttribute('data-subscription-id', rawSubId);

  if (link) {
    link.id = linkId;
    link.textContent = `Subscription details - ${subDisplay}`;
    link.href = `subscription-details.html#subscription-card-${anchorTarget}`;
  }

  if (pageNumberElement) {
    pageNumberElement.id = `toc-number-subscription-${listIndex}`;
  }

  if (descriptionElement) {
    descriptionElement.id = `toc-description-subscription-${listIndex}`;
    descriptionElement.textContent = `Subscription-level metadata details and coverage for ${subDisplay}.`;
  }

  applyEntryDetails(clone, pageNumber, descriptionElement?.textContent || '');

  return clone;
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
  const pageNumberOffset = firstContentPage + staticTableOfContentsEntries.length;

  subIds.forEach((subId, index) => {
    const pageNumber = pageNumberOffset + index;
    const entry = buildSubscriptionEntry(template, subId, index, pageNumber);

    if (entry) {
      tocList.appendChild(entry);
    }
  });
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
  window.fieldTypeSelections = message.fieldTypeSelections || {};
  subscriptionLabels = message.subscriptionLabels && typeof message.subscriptionLabels === 'object'
    ? message.subscriptionLabels
    : {};
  window.subscriptionLabels = subscriptionLabels;
  renderSubscriptionEntries(window.metadataAggregations);
};

// Initialize the table of contents with subscription detail links.
const initTableOfContents = () => {
  applyStaticEntryMetadata();

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
