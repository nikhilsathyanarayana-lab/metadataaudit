import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyLocalTestFlowConfig,
  buildQuickAuditSmokeCheckResult,
  deriveDomainFromApiValue,
  normalizeLocalTestFlowConfig,
} from './localTestFlow.js';

test('deriveDomainFromApiValue maps EU API ids to the SPA EU domain', () => {
  assert.equal(
    deriveDomainFromApiValue('929705d6-6b7d-473c-98d8-655ff2716e6f.eu'),
    'https://app.eu.pendo.io/',
  );
});

test('normalizeLocalTestFlowConfig builds complete SPA credentials', () => {
  const config = normalizeLocalTestFlowConfig({
    enabled: true,
    api: '929705d6-6b7d-473c-98d8-655ff2716e6f.eu',
    subKey: 'local-test-key',
    debounceMs: 250,
  });

  assert.deepEqual(config, {
    credentials: [{
      subId: '929705d6-6b7d-473c-98d8-655ff2716e6f.eu',
      domain: 'https://app.eu.pendo.io/',
      integrationKey: 'local-test-key',
    }],
    autoRunOnCredentialChange: true,
    debounceMs: 250,
  });
});

test('applyLocalTestFlowConfig seeds window credentials in memory', () => {
  const originalWindow = global.window;
  global.window = {};

  const config = {
    credentials: [{
      subId: 'sub-1',
      domain: 'https://app.eu.pendo.io/',
      integrationKey: 'integration-key',
    }],
  };

  const appliedConfig = applyLocalTestFlowConfig(config);

  assert.equal(appliedConfig, config);
  assert.deepEqual(global.window.appCredentials, config.credentials);
  assert.equal(global.window.spaLocalTestFlowConfig, config);

  global.window = originalWindow;
});

test('buildQuickAuditSmokeCheckResult validates quick-audit wiring', () => {
  const doc = {
    getElementById(id) {
      if (id === 'subid-quick-audit-btn') {
        return { dataset: { targetPage: '3' } };
      }

      if (id === 'page-switcher-btn-3') {
        return { id };
      }

      return null;
    },
  };

  assert.deepEqual(buildQuickAuditSmokeCheckResult(doc), {
    quickAuditButtonFound: true,
    quickAuditTargetMatches: true,
    pageThreeButtonFound: true,
  });
});

test('local ignored test credentials normalize into a valid SPA credential set', async (t) => {
  let localModule;

  try {
    localModule = await import('./localTestFlow.config.js');
  } catch (error) {
    t.skip('Local test credential file is not present in this workspace.');
    return;
  }

  const config = normalizeLocalTestFlowConfig(localModule.default);

  assert.ok(config, 'Local config should normalize into a usable test-flow config');
  assert.ok(Array.isArray(config.credentials) && config.credentials.length > 0);
  assert.equal(config.credentials[0].domain, 'https://app.eu.pendo.io/');
  assert.ok(config.credentials[0].subId);
  assert.ok(config.credentials[0].integrationKey);
});
