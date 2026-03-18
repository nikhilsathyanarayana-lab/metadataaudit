import assert from 'node:assert/strict';
import { test } from 'node:test';

import { activateShortcutAction } from './1.js';
import { AUDIT_MODE_QUICK, AUDIT_MODE_STANDARD } from './auditMode.js';

test('activateShortcutAction emits credential state before navigating for quick audit', () => {
  const calls = [];
  const button = {
    click() {
      calls.push('click');
    },
  };

  activateShortcutAction({
    targetPage: '3',
    auditMode: AUDIT_MODE_QUICK,
    subIdFormController: {
      emitCredentialState() {
        calls.push('emit');
      },
    },
    setAuditModeFn(mode) {
      calls.push(`mode:${mode}`);
    },
    queryDestinationButton(pageId) {
      calls.push(`query:${pageId}`);
      return button;
    },
  });

  assert.deepEqual(calls, [
    `mode:${AUDIT_MODE_QUICK}`,
    'emit',
    'query:3',
    'click',
  ]);
});

test('activateShortcutAction falls back to cached credentials when no emitter exists', () => {
  let capturedMode = '';
  let capturedEntries = null;
  let clicked = false;

  activateShortcutAction({
    targetPage: '2',
    auditMode: AUDIT_MODE_STANDARD,
    subIdFormController: {
      getCredentialEntries() {
        return [{
          subId: 'sub-1',
          domain: 'https://app.eu.pendo.io/',
          integrationKey: 'integration-key',
        }];
      },
    },
    setAuditModeFn(mode) {
      capturedMode = mode;
    },
    setAppCredentialsFn(entries) {
      capturedEntries = entries;
    },
    queryDestinationButton() {
      return {
        click() {
          clicked = true;
        },
      };
    },
  });

  assert.equal(capturedMode, AUDIT_MODE_STANDARD);
  assert.deepEqual(capturedEntries, [{
    subId: 'sub-1',
    domain: 'https://app.eu.pendo.io/',
    integrationKey: 'integration-key',
  }]);
  assert.equal(clicked, true);
});
