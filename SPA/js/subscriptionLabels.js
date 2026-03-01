const subscriptionLabelMap = new Map();

// Store a display label for a subscription identifier in memory.
export const setSubscriptionLabel = (subId, label) => {
  const key = String(subId || '');

  if (!key) {
    return;
  }

  const nextLabel = String(label || '').trim();

  if (!nextLabel) {
    subscriptionLabelMap.delete(key);
    return;
  }

  subscriptionLabelMap.set(key, nextLabel);
};

// Return a saved label for a subscription identifier when one exists.
export const getSubscriptionLabel = (subId) => {
  const key = String(subId || '');
  return subscriptionLabelMap.get(key) || key;
};

// Resolve the display value for a subscription identifier.
export const getSubscriptionDisplay = (subId) => getSubscriptionLabel(subId);

// Clear all in-memory subscription labels.
export const clearSubscriptionLabels = () => {
  subscriptionLabelMap.clear();
};

// Build a plain-object snapshot of labels for cross-frame export payloads.
export const exportSubscriptionLabels = () => {
  return Array.from(subscriptionLabelMap.entries()).reduce((payload, [subId, label]) => {
    payload[subId] = label;
    return payload;
  }, {});
};
