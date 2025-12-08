import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScanEntries } from './dataHelpers.js';
import { TARGET_LOOKBACK } from './constants.js';

test('buildScanEntries patches missing credentials from selection override', () => {
  const manualAppNames = new Map();
  const records = [
    {
      appId: 'app-1',
      subId: 'sub-1',
      windowDays: TARGET_LOOKBACK,
      appName: '',
    },
  ];
  const selections = [
    {
      appId: 'app-1',
      subId: 'sub-1',
      domain: 'example.com',
      integrationKey: 'integration-key-1',
      selected: true,
      appName: 'Example App',
    },
  ];

  const entries = buildScanEntries(records, manualAppNames, TARGET_LOOKBACK, selections);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    appId: 'app-1',
    appName: 'Example App',
    subId: 'sub-1',
    domain: 'example.com',
    integrationKey: 'integration-key-1',
  });
});

test('buildScanEntries skips entries still missing credentials after patch attempt', () => {
  const manualAppNames = new Map();
  const records = [
    {
      appId: 'app-1',
      windowDays: TARGET_LOOKBACK,
    },
    {
      appId: 'app-2',
      subId: 'sub-2',
      windowDays: TARGET_LOOKBACK,
    },
  ];
  const selections = [
    {
      appId: 'app-2',
      domain: 'app2.example.com',
      integrationKey: 'integration-key-2',
      selected: true,
    },
  ];

  const entries = buildScanEntries(records, manualAppNames, TARGET_LOOKBACK, selections);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].appId, 'app-2');
  assert.equal(entries.some((entry) => entry.appId === 'app-1'), false);
});
