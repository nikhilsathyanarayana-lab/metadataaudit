const TEST_DATA_PATH = 'SPA/data/test-data.json';
let cachedDataset = null;

// Return the in-memory test dataset when one is loaded.
export const getTestDataset = () => (typeof window !== 'undefined' ? window.spaTestDataset : null);

// Fetch and cache the JSON test dataset for reuse.
const fetchTestDataset = async () => {
  if (cachedDataset) {
    return cachedDataset;
  }

  const response = await fetch(TEST_DATA_PATH, { cache: 'no-cache' });

  if (!response.ok) {
    throw new Error(`Unable to load test data: ${response.status}`);
  }

  const dataset = await response.json();
  cachedDataset = dataset;
  return dataset;
};

// Normalize credential entries for use in the SubID form.
export const normalizeTestCredentials = (entries = []) =>
  entries
    .filter((entry) => entry && (entry.subId || entry.domain || entry.integrationKey))
    .map((entry) => ({
      subId: entry.subId || '',
      domain: entry.domain || '',
      integrationKey: entry.integrationKey || '',
    }));

// Load the JSON test dataset and mark the SPA test mode as active.
export const loadTestDataset = async () => {
  const dataset = await fetchTestDataset();

  if (typeof window !== 'undefined') {
    window.spaTestDataset = dataset;
    window.spaTestDataEnabled = true;
  }

  return dataset;
};
