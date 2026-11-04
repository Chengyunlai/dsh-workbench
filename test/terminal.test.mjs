import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createTerminalDock } from '../terminal-client.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function fixture(t, loader) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://workbench.test' });
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  let state = { phase: 'connected', writable: true }, loads = 0, creates = 0, closes = 0, mounted = 0, disposed = 0, connected = 0, interrupted = 0;
  const subscribers = new Set();
  const runtime = { mountTerminal(parent, model, label) { parent.dataset.label = label; return { update() {}, visible() {}, dispose() { disposed++; } }; } };
  const Dock = createTerminalDock(React, async () => { loads++; return loader ? loader(runtime) : runtime; });
  const container = dom.window.document.getElementById('root'), root = createRoot(container);
  const model = { state: { getSnapshot: () => state, subscribe: callback => { subscribers.add(callback); return () => subscribers.delete(callback); } }, mount: () => { mounted++; return () => mounted--; }, write: text => { assert.equal(text, '\x03'); interrupted++; }, connect: () => connected++, refresh: async () => connected++ };
  const props = { sessionId: 'own', cwd: '/sample/shop', available: true, create: sessionId => { assert.equal(sessionId, 'own'); creates++; return { model }; }, release: () => closes++, t: key => key };
  const render = async overrides => act(async () => root.render(React.createElement(Dock, { ...props, ...overrides })));
  let unmounted = false;
  const unmount = async () => { if (unmounted) return; unmounted = true; await act(async () => root.unmount()); };
  t.after(async () => { await unmount(); dom.window.close(); globalThis.window = previous.window; globalThis.document = previous.document; });
  const click = async label => { const button = [...container.querySelectorAll('button')].find(node => node.textContent.includes(label)); assert.ok(button, label); await act(async () => button.click()); };
  await render();
  return { container, click, render, unmount, counts: () => ({ loads, creates, closes, mounted, disposed, connected, interrupted, subscribers: subscribers.size }), patch: async next => act(async () => { state = { ...state, ...next }; for (const callback of subscribers) callback(); }), dom };
}

test('terminal loads only on request, retains the shell while collapsed, and closes it explicitly or on panel disposal', async t => {
  const ui = await fixture(t);
  assert.equal(ui.counts().loads, 0); assert.equal(ui.counts().creates, 0);
  await ui.click('terminal.title');
  assert.equal(ui.counts().loads, 1); assert.equal(ui.counts().creates, 1); assert.equal(ui.counts().mounted, 1); await ui.click('terminal.interrupt'); assert.equal(ui.counts().interrupted, 1);
  await ui.click('terminal.title');
  assert.equal(ui.container.querySelector('.jb-terminal-screen').hidden, true); assert.equal(ui.counts().closes, 0);
  await ui.click('terminal.title'); assert.equal(ui.counts().creates, 1);
  await ui.click('terminal.close'); assert.equal(ui.counts().closes, 1); assert.equal(ui.counts().subscribers, 0);
  await ui.click('terminal.title'); await ui.unmount();
  assert.equal(ui.counts().closes, 2); assert.equal(ui.counts().mounted, 0); assert.equal(ui.counts().disposed, 2);
});

test('late chunk completion after unmount never creates a shell; failed chunks can be retried', async t => {
  let finish;
  const ui = await fixture(t, runtime => new Promise(resolve => { finish = () => resolve(runtime); }));
  await ui.click('terminal.title'); await ui.unmount(); await act(async () => finish());
  assert.equal(ui.counts().creates, 0);
});

test('unavailable terminals allocate nothing, failures remain actionable, and disconnected or readonly terminals reconnect explicitly', async t => {
  let attempt = 0;
  const ui = await fixture(t, runtime => { if (++attempt === 1) throw new Error('chunk failed'); return runtime; });
  await ui.render({ available: false }); await ui.click('terminal.title'); assert.equal(ui.counts().loads, 0);
  await ui.render(); await ui.click('terminal.title'); assert.ok(ui.container.querySelector('[role=alert]'));
  await ui.click('terminal.retry'); assert.equal(ui.counts().creates, 1);
  await ui.patch({ phase: 'disconnected', writable: false }); await ui.click('terminal.retry'); assert.equal(ui.counts().connected, 1);
  await ui.patch({ phase: 'connected', writable: false }); await ui.click('terminal.control'); assert.equal(ui.counts().connected, 2);
  await ui.patch({ info: { state: 'exited' } }); assert.ok(ui.container.textContent.includes('terminal.exited'));
});

test('bottom terminal exposes keyboard resizing with bounded height', async t => {
  const ui = await fixture(t); await ui.click('terminal.title');
  const divider = ui.container.querySelector('[role=separator]');
  await act(async () => divider.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
  assert.equal(divider.getAttribute('aria-valuenow'), '260');
  await act(async () => divider.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  assert.equal(divider.getAttribute('aria-valuenow'), '600');
});
