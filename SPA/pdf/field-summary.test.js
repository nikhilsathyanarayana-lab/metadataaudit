import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildFieldSummaryComparison } from './field-summary.js';

describe('buildFieldSummaryComparison', () => {
  it('marks aligned values as matching', () => {
    const rowsByTable = {
      '7 days': { email: 'present', id: 'present' },
      '30 days': { email: 'present', id: 'present' },
      '180 days': { email: 'present', id: 'present' },
    };

    const comparison = buildFieldSummaryComparison(rowsByTable);
    const emailRow = comparison.find((entry) => entry.field === 'email');
    const idRow = comparison.find((entry) => entry.field === 'id');

    assert.equal(emailRow?.status, 'match');
    assert.equal(idRow?.status, 'match');
  });

  it('tracks missing fields when one table lacks a value', () => {
    const rowsByTable = {
      '7 days': { name: 'present' },
      '30 days': {},
    };

    const comparison = buildFieldSummaryComparison(rowsByTable);
    const nameRow = comparison.find((entry) => entry.field === 'name');

    assert.equal(nameRow?.status, 'missing');
    assert.deepEqual(nameRow?.valuesByTable, {
      '7 days': 'present',
      '30 days': null,
    });
  });

  it('flags conflicting values across tables', () => {
    const rowsByTable = {
      '7 days': { region: 'NA' },
      '30 days': { region: 'EMEA' },
    };

    const comparison = buildFieldSummaryComparison(rowsByTable);
    const regionRow = comparison.find((entry) => entry.field === 'region');

    assert.equal(regionRow?.status, 'delta');
    assert.deepEqual(regionRow?.valuesByTable, {
      '7 days': 'NA',
      '30 days': 'EMEA',
    });
  });
});
