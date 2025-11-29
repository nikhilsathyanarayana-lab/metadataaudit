import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseExamples } from './workbookUi.js';

describe('parseExamples', () => {
  it('returns account examples even when no field examples are present', () => {
    const response = {
      results: [
        {
          appId: 'app-1',
          account: {
            accountName: 'ExampleCo',
            accountId: 123,
          },
        },
      ],
    };

    const rows = parseExamples(response, 'sub-1');

    assert.equal(rows.length, 2);
    assert.deepEqual(rows, [
      {
        SubID: 'sub-1',
        AppID: 'app-1',
        Field: 'accountName',
        Example: 'ExampleCo',
        Count: '',
      },
      {
        SubID: 'sub-1',
        AppID: 'app-1',
        Field: 'accountId',
        Example: '123',
        Count: '',
      },
    ]);
  });

  it('avoids duplicating account examples when multiple field examples exist', () => {
    const response = {
      results: [
        {
          appId: 'app-2',
          fields: {
            visitorId: { value: 'abc', count: 5 },
            userRegion: { value: 'NA', count: 3 },
          },
          account: {
            tier: 'enterprise',
          },
        },
      ],
    };

    const rows = parseExamples(response, 'sub-2');

    const accountRows = rows.filter(({ Field }) => Field === 'tier');
    assert.equal(accountRows.length, 1, 'account rows should not be duplicated for each field');
  });
});
