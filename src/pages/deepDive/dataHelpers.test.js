import assert from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

const buildSessionStorage = () => {
  const storage = new Map();

  return {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };
};

const { loadAppSelections } = await import('./dataHelpers.js');

describe('loadAppSelections', () => {
  beforeEach(() => {
    global.window = {};
    global.sessionStorage = buildSessionStorage();
  });

  afterEach(() => {
    delete global.window;
    delete global.sessionStorage;
  });

  it('normalizes stored selections into per-app entries', () => {
    const results = loadAppSelections(7, {
      loadManualNames: () => new Map(),
      storedAppSelectionsLoader: () => [
        {
          subId: 'sub-1',
          domain: 'example.test',
          integrationKey: 'ik-1',
          response: { results: [{ appId: 'app-1', appName: 'First App' }] },
          metadataFields: {
            'app-1': {
              windowDays: 7,
              visitorFields: ['email', 'name', 'email'],
              accountFields: ['plan'],
            },
            'app-2': {
              windowDays: 30,
              visitorFields: ['tier'],
              accountFields: ['industry'],
            },
          },
        },
        { subId: 'ignored', domain: 'bad.test', integrationKey: 'ik-2' },
      ],
      appIdExtractor: (response) => (response?.results ? ['app-1', 'app-2'] : []),
      appNameExtractor: () => new Map([
        ['app-1', 'First App'],
        ['app-2', 'Second App'],
      ]),
      manualNameApplier: (rows) => rows,
      collectionLoader: () => [],
    });

    assert.deepStrictEqual(results, [
      {
        subId: 'sub-1',
        appId: 'app-1',
        domain: 'example.test',
        integrationKey: 'ik-1',
        appName: 'First App',
        visitorFields: ['email', 'name'],
        accountFields: ['plan'],
      },
      {
        subId: 'sub-1',
        appId: 'app-2',
        domain: 'example.test',
        integrationKey: 'ik-1',
        appName: 'Second App',
        visitorFields: [],
        accountFields: [],
      },
    ]);
  });

  it('applies manual app names when overrides exist', () => {
    const manualNames = new Map([['manual-sub::app-9', 'Manual Name']]);
    const applyManualAppNames = (rows) =>
      rows.map((row) => ({
        ...row,
        appName: manualNames.get(`${row.subId}::${row.appId}`) || row.appName || '',
      }));

    const results = loadAppSelections(undefined, {
      loadManualNames: () => manualNames,
      storedAppSelectionsLoader: () => [
        {
          subId: 'manual-sub',
          domain: 'manual.example',
          integrationKey: 'ik-manual',
          response: { results: [{ appId: 'app-9', appName: 'API Name' }] },
        },
      ],
      appIdExtractor: () => ['app-9'],
      appNameExtractor: () => new Map([['app-9', 'API Name']]),
      manualNameApplier: applyManualAppNames,
      collectionLoader: () => [],
    });

    assert.strictEqual(results[0]?.appName, 'Manual Name');
  });

  it('fills missing session details from subidLaunchData and skips malformed entries', () => {
    sessionStorage.setItem(
      'subidLaunchData',
      JSON.stringify([
        { subId: 'fallback-sub', domain: 'fallback.test', integrationKey: 'fallback-key' },
        { subId: 'broken-sub' },
      ]),
    );

    const results = loadAppSelections(undefined, {
      storedAppSelectionsLoader: () => [
        { subId: 'fallback-sub', response: { results: [{ appId: 'app-99' }] } },
        { subId: 'missing-response' },
        'not-an-object',
      ],
      appIdExtractor: (response) => (response?.results ? ['app-99'] : []),
      appNameExtractor: () => new Map([['app-99', 'Fallback App']]),
      manualNameApplier: (rows) => rows,
      collectionLoader: (key) => {
        if (key === 'subidLaunchData') {
          const raw = sessionStorage.getItem(key);
          return raw ? JSON.parse(raw) : [];
        }

        return [];
      },
    });

    assert.deepStrictEqual(results, [
      {
        subId: 'fallback-sub',
        appId: 'app-99',
        domain: 'fallback.test',
        integrationKey: 'fallback-key',
        appName: 'Fallback App',
        visitorFields: [],
        accountFields: [],
      },
    ]);
  });
});
