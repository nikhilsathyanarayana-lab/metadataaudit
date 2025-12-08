import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { buildScanEntries } from './dataHelpers.js';
import { appSelectionGlobalKey, TARGET_LOOKBACK } from './constants.js';

class MemoryStorage {
  constructor(initial = {}) {
    this.store = { ...initial };
  }

  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key)
      ? this.store[key]
      : null;
  }

  setItem(key, value) {
    this.store[key] = String(value);
  }

  removeItem(key) {
    delete this.store[key];
  }

  clear() {
    this.store = {};
  }
}

const manualAppNames = new Map([
  ['sub-1::app-1', 'Manual Override Name'],
]);

const selectionResponses = [
  {
    subId: 'sub-1',
    domain: 'valid.domain',
    integrationKey: 'integration-one',
    response: { results: [{ appId: 'app-1', appName: 'Selection App One' }] },
  },
  {
    subId: 'sub-2',
    domain: 'another.domain',
    integrationKey: 'integration-two',
    response: { results: [{ appId: 'app-2', appName: 'Selection App Two' }] },
  },
];

const records = [
  { appId: 'app-1', windowDays: TARGET_LOOKBACK, appName: 'Record App One', subId: 'sub-1' },
  { appId: 'app-2', windowDays: TARGET_LOOKBACK, subId: 'unmatched-sub' },
  { appId: 'app-3', windowDays: TARGET_LOOKBACK },
];

let originalWarn;
let originalWindow;

const setupEnvironment = () => {
  const storage = new MemoryStorage({
    [appSelectionGlobalKey]: JSON.stringify(selectionResponses),
  });

  global.sessionStorage = storage;
  global.window = { DEBUG_LOGGING: true };
};

beforeEach(() => {
  originalWarn = console.warn;
  originalWindow = global.window;

  setupEnvironment();
});

afterEach(() => {
  console.warn = originalWarn;
  global.window = originalWindow;
  delete global.sessionStorage;
});

test('buildScanEntries skips missing credentials and builds valid entries', () => {
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  const entries = buildScanEntries(records, manualAppNames, TARGET_LOOKBACK);

  assert.strictEqual(entries.length, 2, 'Only valid selections should produce scan entries');

  const appOne = entries.find((entry) => entry.appId === 'app-1');
  assert.ok(appOne, 'App one entry should be present');
  assert.strictEqual(appOne.appName, 'Manual Override Name');
  assert.strictEqual(appOne.domain, 'valid.domain');
  assert.strictEqual(appOne.integrationKey, 'integration-one');
  assert.strictEqual(appOne.subId, 'sub-1');

  const appTwo = entries.find((entry) => entry.appId === 'app-2');
  assert.ok(appTwo, 'App two entry should be present');
  assert.strictEqual(appTwo.appName, 'Selection App Two');
  assert.strictEqual(appTwo.domain, 'another.domain');
  assert.strictEqual(appTwo.integrationKey, 'integration-two');
  assert.strictEqual(appTwo.subId, 'unmatched-sub');

  assert.strictEqual(warnings.length, 1, 'One record without credentials should be skipped');
  assert.ok(
    warnings[0].some((arg) => typeof arg === 'string' && arg.includes('Skipping scan entry')),
    'Missing credentials should trigger a warning message',
  );
});
