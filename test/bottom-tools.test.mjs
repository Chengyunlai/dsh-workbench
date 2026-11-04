import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createBottomTools } from '../bottom-tools.js';
import { createTerminalDock } from '../terminal-client.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('switching the owning session hides tools and releases its terminal without creating another shell', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://workbench.test' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  const created = [], released = [];
  const useTools = createBottomTools(React);
  const Dock = createTerminalDock(React, async () => ({ mountTerminal: () => ({ update() {}, visible() {}, dispose() {} }) }));
  const model = { state: { getSnapshot: () => ({ phase: 'connected', writable: true }), subscribe: () => () => {} }, mount: () => () => {} };
  function Workbench({ sessionId }) {
    const tools = useTools(sessionId, key => key);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { onClick: () => tools.toggle('terminal'), 'aria-pressed': tools.active === 'terminal' }, 'Terminal'),
      React.createElement(Dock, { key: sessionId, sessionId, available: true, active: tools.active === 'terminal', onClose: tools.hide,
        create: id => { created.push(id); return { sessionId: id, model }; }, release: entry => released.push(entry.sessionId), t: key => key }));
  }
  const container = dom.window.document.getElementById('root'), root = createRoot(container);
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; });
  const render = async sessionId => act(async () => root.render(React.createElement(Workbench, { sessionId })));
  await render('first'); await act(async () => container.querySelector('button').click());
  assert.deepEqual(created, ['first']);
  await render('second');
  assert.deepEqual(released, ['first']); assert.deepEqual(created, ['first']);
  assert.equal(container.querySelector('button').getAttribute('aria-pressed'), 'false');
  await act(async () => container.querySelector('button').click());
  assert.deepEqual(created, ['first', 'second']);
});
