import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindLiveTestFlowRefresh } from './2.js';

test('bindLiveTestFlowRefresh re-renders the page-2 preview when test flow completes', async () => {
  const listeners = new Map();
  const renderCalls = [];
  const sectionRoot = {
    dataset: {},
    isConnected: true,
  };

  const doc = {
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
  };

  bindLiveTestFlowRefresh(sectionRoot, {
    doc,
    async renderPreview(root, options) {
      renderCalls.push({ root, options });
    },
  });

  assert.equal(sectionRoot.dataset.testFlowBound, 'true');
  assert.ok(listeners.has('spa-test-flow-completed'));

  await listeners.get('spa-test-flow-completed')({
    detail: {
      results: [{ credential: { subId: 'sub-1' }, results: [] }],
    },
  });

  assert.equal(renderCalls.length, 1);
  assert.equal(renderCalls[0].root, sectionRoot);
  assert.deepEqual(renderCalls[0].options, {
    credentialResults: [{ credential: { subId: 'sub-1' }, results: [] }],
  });
});

test('bindLiveTestFlowRefresh does not re-render disconnected sections', async () => {
  const listeners = new Map();
  let renderCount = 0;
  const sectionRoot = {
    dataset: {},
    isConnected: false,
  };

  bindLiveTestFlowRefresh(sectionRoot, {
    doc: {
      addEventListener(name, handler) {
        listeners.set(name, handler);
      },
    },
    async renderPreview() {
      renderCount += 1;
    },
  });

  await listeners.get('spa-test-flow-completed')({ detail: { results: [] } });
  assert.equal(renderCount, 0);
});
