// Read metadata aggregations from the SPA cache.
const getMetadataAggregations = () => {
  return typeof window !== 'undefined'
    ? window.metadataAggregations || {}
    : {};
};

// Store the count of unique SubIDs discovered during metadata scans for export consumers.
export const updateSubScanCount = (aggregations = getMetadataAggregations()) => {
  const uniqueSubIds = aggregations && typeof aggregations === 'object'
    ? Object.keys(aggregations)
    : [];

  const subScanCount = uniqueSubIds.length;

  if (typeof window !== 'undefined') {
    window.subScanCount = subScanCount;
  }

  return subScanCount;
};

// Placeholder initializer for page four of the SPA.
export async function initSection() {
  // Page 4 initialization placeholder
}
