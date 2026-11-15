import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { registerReactDomTeardown } from './react-dom-teardown.js';

function makeMinimalDom(t: any) {
  const prev = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    IS_REACT_ACT_ENVIRONMENT: (globalThis as any).IS_REACT_ACT_ENVIRONMENT,
  };
  const teardown = registerReactDomTeardown(t, prev);
  const doc: any = {
    nodeType: 9,
    body: { appendChild() {}, removeChild() {} },
    addEventListener() {},
    removeEventListener() {},
    createElement(tag: string) {
      return {
        nodeType: 1,
        tagName: tag.toUpperCase(),
        ownerDocument: doc,
        childNodes: [],
        appendChild() {},
        removeChild() {},
        addEventListener() {},
        removeEventListener() {},
      };
    },
    createTextNode(v: string) {
      return { nodeType: 3, nodeValue: v, ownerDocument: doc };
    },
  };
  const win: any = {
    document: doc,
    HTMLIFrameElement: class {},
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  doc.defaultView = win;
  Object.assign(globalThis, { window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true });
  const container = doc.createElement('div');
  const root = createRoot(container);
  teardown.setRoot(root);
  return { root, teardown };
}

let settled = false;
let timerFired = false;
let restoredAfterPending = false;

test('teardown waits for unmount, pending fake-client promises, and timers before restoring globals', async (t) => {
  const { root, teardown } = makeMinimalDom(t);
  settled = false;
  timerFired = false;
  restoredAfterPending = false;

  const fakeClient = teardown.trackClient({
    get() {
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          settled = true;
          resolve('ok');
        }, 25);
      });
    },
  });
  teardown.onRestore(() => {
    restoredAfterPending = settled && timerFired && typeof (globalThis as any).window === 'object';
  });

  function PendingComponent() {
    const [, setText] = React.useState('init');
    React.useEffect(() => {
      void fakeClient.get().then((v) => setText(v));
      setTimeout(() => {
        timerFired = true;
        setText('timer');
      }, 25);
    }, []);
    return React.createElement('div', null, 'hello');
  }

  await React.act(async () => {
    root.render(React.createElement(PendingComponent));
  });
});

test('teardown completed all pending work and restored globals before next test', async () => {
  assert.equal(typeof (globalThis as any).window, 'undefined');
  const settledAtTestStart = settled;
  const timerAtTestStart = timerFired;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(settledAtTestStart, true, 'fake-client promise settled before globals restored');
  assert.equal(timerAtTestStart, true, 'pending timer fired before globals restored');
  assert.equal(restoredAfterPending, true, 'onRestore runs after pending work and before globals disappear');
});
