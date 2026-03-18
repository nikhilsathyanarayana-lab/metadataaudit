import { app_names } from '../API/app_names.js';

const CREDENTIAL_STATE_EVENT = 'spa-credentials-changed';
const TEST_FLOW_STARTED_EVENT = 'spa-test-flow-started';
const TEST_FLOW_COMPLETED_EVENT = 'spa-test-flow-completed';
const TEST_FLOW_FAILED_EVENT = 'spa-test-flow-failed';
const DEFAULT_DEBOUNCE_MS = 600;

// Choose the closest SPA domain from the API identifier suffix.
const deriveDomainFromApiValue = (apiValue = '') => {
  const normalizedApiValue = String(apiValue || '').trim().toLowerCase();

  if (normalizedApiValue.endsWith('.eu')) {
    return 'https://app.eu.pendo.io/';
  }

  if (normalizedApiValue.endsWith('.jpn')) {
    return 'https://app.jpn.pendo.io/';
  }

  if (normalizedApiValue.endsWith('.au')) {
    return 'https://app.au.pendo.io/';
  }

  if (normalizedApiValue.endsWith('.us1')) {
    return 'https://us1.app.pendo.io/';
  }

  return 'https://app.pendo.io/';
};

// Normalize local test-flow settings into SPA credential entries.
const normalizeLocalTestFlowConfig = (rawConfig = {}) => {
  if (!rawConfig || typeof rawConfig !== 'object' || rawConfig.enabled !== true) {
    return null;
  }

  const configuredCredentials = Array.isArray(rawConfig.credentials)
    ? rawConfig.credentials
    : rawConfig.api && rawConfig.subKey
      ? [{
        subId: String(rawConfig.api || '').trim(),
        domain: deriveDomainFromApiValue(rawConfig.api),
        integrationKey: String(rawConfig.subKey || '').trim(),
      }]
      : [];

  const credentials = configuredCredentials
    .map((entry) => ({
      subId: String(entry?.subId || '').trim(),
      domain: String(entry?.domain || '').trim(),
      integrationKey: String(entry?.integrationKey || '').trim(),
    }))
    .filter((entry) => entry.subId && entry.domain && entry.integrationKey);

  if (!credentials.length) {
    return null;
  }

  return {
    credentials,
    autoRunOnCredentialChange: rawConfig.autoRunOnCredentialChange !== false,
    debounceMs: Number(rawConfig.debounceMs) || DEFAULT_DEBOUNCE_MS,
  };
};

// Load the ignored local test-flow module when it exists.
export const loadLocalTestFlowConfig = async () => {
  try {
    const module = await import('./localTestFlow.config.js');
    const rawConfig = module?.default || module?.localTestFlowConfig || null;
    return normalizeLocalTestFlowConfig(rawConfig);
  } catch (error) {
    return null;
  }
};

// Seed the shared in-memory SPA credentials from local test-flow settings.
export const applyLocalTestFlowConfig = (config) => {
  if (!config || typeof window === 'undefined') {
    return null;
  }

  window.spaLocalTestFlowConfig = config;
  window.appCredentials = config.credentials.map((entry) => ({
    subId: entry.subId,
    domain: entry.domain,
    integrationKey: entry.integrationKey,
  }));

  return config;
};

// Broadcast the latest real app-discovery results for local testing.
export const initLocalTestFlow = (config) => {
  if (!config || typeof document === 'undefined' || config.autoRunOnCredentialChange !== true) {
    return;
  }

  let activeRunId = 0;
  let debounceTimer = null;

  const runCredentialTestFlow = async (entries = []) => {
    const runId = activeRunId + 1;
    activeRunId = runId;

    document.dispatchEvent(new CustomEvent(TEST_FLOW_STARTED_EVENT, {
      detail: {
        entries,
        runId,
      },
    }));

    try {
      const results = await app_names(entries);

      if (runId !== activeRunId) {
        return;
      }

      if (typeof window !== 'undefined') {
        window.spaTestFlowLastResults = results;
      }

      document.dispatchEvent(new CustomEvent(TEST_FLOW_COMPLETED_EVENT, {
        detail: {
          entries,
          results,
          runId,
        },
      }));
    } catch (error) {
      if (runId !== activeRunId) {
        return;
      }

      document.dispatchEvent(new CustomEvent(TEST_FLOW_FAILED_EVENT, {
        detail: {
          entries,
          error,
          runId,
        },
      }));
    }
  };

  // Debounce rapid edits so the test flow waits for a stable credential snapshot.
  document.addEventListener(CREDENTIAL_STATE_EVENT, (event) => {
    const entries = Array.isArray(event?.detail?.entries) ? event.detail.entries : [];

    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      runCredentialTestFlow(entries);
    }, config.debounceMs);
  });
};

export { TEST_FLOW_COMPLETED_EVENT };
