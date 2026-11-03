import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React, { act } from 'react';
import { EditorView } from '@codemirror/view';
import { JSDOM } from 'jsdom';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = { 'src/main.ts': "const emoji = '😀'; render();", 'src/lib.ts': 'export function render() {}' };

async function panel(testContext, fetch, { dock, paneSizes, platform } = {}) {
  let dictionary = {};
  const t = (key, vars = {}) => Object.entries(vars).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), dictionary[key] ?? key);
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'https://harness.test/' });
  if (platform !== undefined) Object.defineProperty(dom.window.navigator, 'platform', { value: platform });
  if (dock !== undefined) dom.window.localStorage.setItem('dsh.git-control.debugDock', dock);
  if (paneSizes !== undefined) dom.window.localStorage.setItem('dsh.git-control.paneSizes', typeof paneSizes === 'string' ? paneSizes : JSON.stringify(paneSizes));
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  // React DOM determines input-event support at module load, after the browser environment exists.
  const { createRoot } = await import('react-dom/client');
  const { createPortal } = await import('react-dom');
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  const resizeObservers = new Set();
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { resizeObservers.add(this); }
    disconnect() { resizeObservers.delete(this); }
  };
  let plugin, Panel;
  dom.window.__ModuleLoader__ = { load: spec => { plugin = spec.factory(name => name === 'react-dom' ? { createPortal } : React); } };
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver, Node: dom.window.Node, Window: dom.window.Window,
    getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window), setTimeout, clearTimeout,
    fetch, AbortController, URL, URLSearchParams, console,
  });
  plugin.apply({
    effect: fn => fn(), locale: { register: (namespace, dictionaries) => { dictionary = dictionaries.zh; return () => {}; }, bind: () => t },
    uiWorkspace: { openSession() {} }, sidebarRightTabs: { register: () => () => {} },
    slots: { inject: (name, fn) => fn(), register: (spec, component) => { if (spec.name === 'sidebar.right.pane.tab') Panel = component; return () => {}; } },
  });
  const items = [{ workspaceId: 'demo', path: '/demo', title: 'Demo' }];
  const byId = { own: { id: 'own', cwd: '/demo' } };
  const container = dom.window.document.getElementById('root');
  let renderer = createRoot(container);
  const render = () => renderer.render(React.createElement(Panel, { sessionId: 'own', t, useWorkspaces: select => select({ items }), useSessions: select => select({ byId }) }));
  await act(async () => { render(); });
  const reopen = async () => { await act(async () => renderer.unmount()); renderer = createRoot(container); await act(async () => render()); };
  testContext.after(async () => { await act(async () => renderer.unmount()); dom.window.close(); delete globalThis.window; delete globalThis.document; });
  const button = key => { const label = t(key); return [...container.querySelectorAll('button')].find(node => node.textContent === label || [...node.querySelectorAll('span')].some(span => span.textContent === label)); };
  const click = async label => { const node = button(label); assert.ok(node, label); assert.notEqual(node.disabled, true, label); await act(async () => { node.click(); }); };
  const editor = () => EditorView.findFromDOM(container.querySelector('.cm-content'));
  const key = async (name, options = {}) => { await act(async () => { container.querySelector('.cm-content').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options })); }); };
  const caret = async offset => { await act(async () => { editor().dispatch({ selection: { anchor: offset } }); }); };
  const menu = async (node, label) => {
    await act(async () => node.dispatchEvent(new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
    const item = [...dom.window.document.querySelectorAll('[role=menuitem]')].find(item => item.textContent.startsWith(t(label)));
    assert.ok(item, label); await act(async () => item.click());
  };
  const resize = async () => act(async () => { for (const observer of [...resizeObservers]) observer.callback([]); });
  return { container, button, click, t, editor, caret, key, menu, dom, reopen, resize, resizeObservers };
}

function server(override, requests = []) {
  return async (input, options = {}) => {
    const url = new URL(input, 'http://localhost');
    requests.push({ name: url.pathname, params: url.searchParams, signal: options.signal });
    const special = override?.(url, options); if (special) return special;
    let data;
    switch (url.pathname) {
      case '/api/git.status': data = { isRepo: true, branch: 'main', changes: [{ path: 'src/main.ts', displayPath: 'src/main.ts', letter: 'M', key: 'status.m', ins: 1, del: 1 }], shown: 1, total: 1 }; break;
      case '/api/git.log': data = { commits: [] }; break;
      case '/api/git.tree': data = { files: Object.keys(source) }; break;
      case '/api/git.source': data = { path: url.searchParams.get('path'), text: source[url.searchParams.get('path')], version: 'source-v1' }; break;
      case '/api/git.definition': data = { targets: [{ path: 'src/lib.ts', line: 0, character: 16 }], external: 0 }; break;
      case '/api/git.debug.status': data = { id: null, state: 'idle' }; break;
      case '/api/git.diff': data = { text: '@@ -1 +1 @@\n-old\n+new' }; break;
      default: throw new Error('unexpected request ' + input);
    }
    return { ok: true, json: async () => data };
  };
}

test('file tree, source/diff, exact symbol position, definition and history work together', async context => {
  const requests = [];
  const ui = await panel(context, server(null, requests));
  await ui.click('src'); await ui.click('main.ts');
  assert.equal(ui.container.querySelector('.jb-source-panel button'), null);
  assert.equal(ui.container.querySelector('.jb-editor-title svg').getAttribute('width'), '16');
  await ui.caret(source['src/main.ts'].indexOf('render'));
  await ui.key('b', { ctrlKey: true });
  assert.ok([...ui.container.querySelectorAll('.jb-diffpath')].some(node => node.textContent === 'src/lib.ts'));
  const output = {
    path: ui.container.querySelector('.jb-diffpath').textContent,
    source: ui.editor().state.doc.toString(),
    status: ui.container.querySelector('.jb-editor-status').textContent,
    readOnly: ui.container.querySelector('.cm-content').getAttribute('aria-readonly'),
    navigationButtons: ui.container.querySelectorAll('.jb-source-panel button').length,
    highlighting: [...ui.container.querySelectorAll('.jb-syntax-keyword,.jb-syntax-function')].map(element => ({
      text: element.textContent, color: ui.dom.window.getComputedStyle(element).color,
    })),
  };
  assert.deepEqual(output, JSON.parse(readFileSync(new URL('./fixtures/navigation.expected.json', import.meta.url), 'utf8')));
  const definition = requests.find(request => request.name === '/api/git.definition');
  assert.equal(definition.params.get('line'), '0');
  assert.equal(definition.params.get('character'), String(source['src/main.ts'].indexOf('render')));
  assert.equal(definition.params.get('version'), 'source-v1');
  await ui.key('[', { ctrlKey: true });
  assert.equal(ui.editor().state.selection.main.head, source['src/main.ts'].indexOf('render'));
  await ui.key(']', { ctrlKey: true });
  await ui.menu(ui.container.querySelector('.cm-content'), 'files.diff');
  assert.ok([...ui.container.querySelectorAll('.jb-dline-text')].some(node => node.textContent === '+new'));
  const diff = ui.container.querySelector('.jb-diffwrap[tabindex="0"]');
  assert.equal(ui.dom.window.document.activeElement, diff);
  await act(async () => diff.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true })));
  assert.ok(ui.container.querySelector('.cm-content'));
  await ui.click('tabs.changes'); await ui.click('tabs.files');
  assert.ok([...ui.container.querySelectorAll('.jb-diffpath')].some(node => node.textContent === 'src/lib.ts'));
});

test('late definitions cannot replace a newer file selection', async context => {
  let release;
  const requests = [];
  const ui = await panel(context, server(url => url.pathname === '/api/git.definition' ? new Promise(resolve => { release = resolve; }) : null, requests));
  await ui.click('src'); await ui.click('main.ts');
  await ui.caret(source['src/main.ts'].indexOf('render'));
  await ui.key('b', { ctrlKey: true });
  await ui.click('lib.ts');
  assert.equal(requests.find(request => request.name === '/api/git.definition').signal.aborted, true);
  await act(async () => { release({ ok: true, json: async () => ({ targets: [{ path: 'src/main.ts', line: 0, character: 0 }], external: 0 }) }); });
  assert.ok([...ui.container.querySelectorAll('.jb-diffpath')].some(node => node.textContent === 'src/lib.ts'));
});

test('definition jumps retain file tabs, restore reading positions and close independently', async context => {
 const requests = [];
 const ui = await panel(context, server(null, requests));
 await ui.click('src'); await ui.click('main.ts');
 const editor = ui.editor();
 const tabs = () => [...ui.container.querySelectorAll('.jb-source-tabs [role=tab]')];
 const tab = path => tabs().find(node => node.getAttribute('aria-label') === path);
 const activate = async path => act(async () => tab(path).click());
 const origin = source['src/main.ts'].indexOf('render');
 await ui.caret(origin); await ui.key('F12');
 assert.deepEqual(tabs().map(node => node.getAttribute('aria-label')), ['src/main.ts', 'src/lib.ts']);
 assert.equal(ui.editor(), editor);
 await ui.caret(7);
 await activate('src/main.ts');
 assert.equal(ui.editor(), editor); assert.equal(editor.state.selection.main.head, origin);
 await activate('src/lib.ts');
 assert.equal(editor.state.selection.main.head, 7);
 await activate('src/main.ts'); await ui.key('F12');
 assert.equal(tabs().length, 2, 'jumping to an open file reuses its tab');
 assert.equal(editor.state.selection.main.head, 16, 'definition navigation selects its destination rather than a saved caret');
 const snapshot = { tabs: tabs().map(node => ({ path: node.getAttribute('aria-label'), selected: node.getAttribute('aria-selected') })),
  close: [...ui.container.querySelectorAll('.jb-source-tab-close')].map(node => node.getAttribute('aria-label')) };
 assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL('./fixtures/source-tabs.expected.json', import.meta.url), 'utf8')));
 const title = ui.container.querySelector('.jb-diffpath').textContent;
 await act(async () => ui.container.querySelector('[aria-label="关闭 src/main.ts"]').click());
 assert.equal(tabs().length, 1); assert.equal(ui.container.querySelector('.jb-diffpath').textContent, title);
 await act(async () => ui.container.querySelector('[aria-label="关闭 src/lib.ts"]').click());
 assert.equal(tabs().length, 0); assert.equal(ui.container.querySelector('.cm-content'), null);
 assert.ok(ui.container.querySelector('.jb-detail').textContent.includes(ui.t('files.pick')));
 await ui.click('main.ts');
 assert.equal(tabs().length, 1); assert.equal(ui.editor().state.selection.main.head, 0);
});

test('file tab keyboard navigation and closing a pending tab cancel its late read', async context => {
 let release;
 const requests = [];
 const ui = await panel(context, server(url => url.pathname === '/api/git.source' && url.searchParams.get('path') === 'src/lib.ts'
  ? new Promise(resolve => { release = resolve; }) : null, requests));
 await ui.click('src'); await ui.click('main.ts'); await ui.click('lib.ts');
 const tabs = () => [...ui.container.querySelectorAll('.jb-source-tabs [role=tab]')];
 assert.equal(tabs().length, 2);
 await act(async () => ui.container.querySelector('[aria-label="关闭 src/lib.ts"]').click());
 assert.equal(requests.filter(request => request.name === '/api/git.source' && request.params.get('path') === 'src/lib.ts')[0].signal.aborted, true);
 await act(async () => release({ ok: true, json: async () => ({ path: 'src/lib.ts', text: 'late', version: 'late' }) }));
 assert.equal(tabs().length, 1); assert.equal(ui.editor().state.doc.toString(), source['src/main.ts']);
 await ui.click('lib.ts');
 await act(async () => release({ ok: true, json: async () => ({ path: 'src/lib.ts', text: source['src/lib.ts'], version: 'source-v1' }) }));
 await act(async () => {
  tabs()[1].focus(); tabs()[1].dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
 });
 assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');
 assert.equal(ui.dom.window.document.activeElement, tabs()[0]);
 await act(async () => tabs()[0].dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })));
 assert.equal(tabs().length, 1); assert.equal(tabs()[0].getAttribute('aria-label'), 'src/lib.ts');
});

test('repeated same-file definition jumps reuse the source read and editor instance', async context => {
 const requests = [], text = Array.from({ length: 1000 }, (_, i) => `const item${i} = ${i};`).join('\n');
 let jumps = 0;
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.source') return Promise.resolve({ ok: true, json: async () => ({ path: 'src/main.ts', text, version: 'long-source' }) });
  if (url.pathname === '/api/git.definition') return Promise.resolve({ ok: true, json: async () => ({ targets: [{ path: 'src/main.ts', line: (++jumps * 73) % 1000, character: 6 }], external: 0 }) });
 }, requests));
 await ui.click('src'); await ui.click('main.ts'); await ui.caret(6);
 let editor = ui.editor(), replacements = 0;
 for (let i = 0; i < 12; i++) {
  await ui.key('F12');
  if (ui.editor() !== editor) replacements++;
  editor = ui.editor();
 }
 const reads = requests.filter(request => request.name === '/api/git.source').length;
 context.diagnostic(JSON.stringify({ lines: 1000, jumps, sourceReads: reads, editorReplacements: replacements }));
 assert.equal(reads, 1);
 assert.equal(replacements, 0);
});

test('cross-file navigation retains source during loading, reuses the editor and discards cancelled reads', async context => {
 const pending = [], requests = [];
 let failMain = false, mainText = source['src/main.ts'];
 const ui = await panel(context, server((url, options) => {
  if (url.pathname !== '/api/git.source') return;
  if (url.searchParams.get('path') === 'src/lib.ts') return new Promise(resolve => pending.push({ resolve, signal: options.signal }));
  return Promise.resolve(failMain ? { ok: false, json: async () => ({ code: 'SOURCE_NOT_FILE', error: 'missing source' }) }
   : { ok: true, json: async () => ({ path: 'src/main.ts', text: mainText, version: 'current-main' }) });
 }, requests));
 await ui.click('src'); await ui.click('main.ts');
 const editor = ui.editor(), content = ui.container.querySelector('.cm-content');
 await ui.caret(10);
 await ui.click('lib.ts');
 assert.equal(ui.editor(), editor); assert.equal(editor.state.doc.toString(), mainText);
 assert.equal(editor.state.selection.main.head, 10, 'loading another file preserves the retained source position');
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/main.ts', 'retained code keeps its own title');
 assert.ok(ui.container.querySelector('.jb-source-notice').textContent.includes('src/lib.ts'));
 assert.equal(ui.container.querySelector('.jb-sourcebody').hasAttribute('inert'), true);
 assert.deepEqual({ displayedPath: ui.container.querySelector('.jb-diffpath').textContent,
  notice: ui.container.querySelector('.jb-source-notice').textContent, readOnly: content.getAttribute('aria-readonly'), blocked: ui.container.querySelector('.jb-sourcebody').hasAttribute('inert') },
  JSON.parse(readFileSync(new URL('./fixtures/navigation-pending.expected.json', import.meta.url), 'utf8')));
 await ui.click('main.ts');
 assert.equal(pending[0].signal.aborted, true);
 await act(async () => pending[0].resolve({ ok: true, json: async () => ({ path: 'src/lib.ts', text: 'late', version: 'late' }) }));
 assert.equal(editor.state.doc.toString(), mainText);
 await ui.click('lib.ts');
 await act(async () => pending[1].resolve({ ok: true, json: async () => ({ path: 'src/lib.ts', text: source['src/lib.ts'], version: 'lib-v1' }) }));
 assert.equal(ui.editor(), editor); assert.equal(ui.container.querySelector('.cm-content'), content);
 assert.equal(editor.state.doc.toString(), source['src/lib.ts']);
 assert.equal(ui.dom.window.document.activeElement, content);
 failMain = true; await ui.click('main.ts');
 assert.equal(ui.editor(), editor); assert.equal(editor.state.doc.toString(), source['src/lib.ts']);
 assert.ok(ui.container.querySelector('.jb-detail [role=alert]').textContent.includes('src/main.ts'));
 const count = requests.length; await ui.key('F9');
 assert.equal(requests.length, count, 'retained source cannot send actions for a different pending file');
 failMain = false; mainText = 'const refreshed = 42;'; await ui.click('main.ts');
 assert.equal(ui.editor(), editor); assert.equal(editor.state.doc.toString(), mainText);
 assert.equal(ui.container.querySelector('.jb-sourcebody').hasAttribute('inert'), false);
 mainText = 'const refreshed = 43;'; await ui.click('main.ts');
 assert.equal(ui.editor(), editor); assert.equal(editor.state.doc.toString(), mainText, 'explicitly reopening a file reads current contents');
});

test('unavailable language service is displayed without a guessed definition', async context => {
  const ui = await panel(context, server(url => url.pathname === '/api/git.definition' ? Promise.resolve({ ok: false, json: async () => ({ code: 'NAVIGATION_UNAVAILABLE', error: 'no provider' }) }) : null));
  await ui.click('src'); await ui.click('main.ts');
  await ui.caret(source['src/main.ts'].indexOf('render')); await ui.key('b', { ctrlKey: true });
  assert.equal(ui.container.querySelector('[role=status]').textContent, ui.t('files.unavailable'));
  assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/main.ts');
});

test('new-file diffs use the bounded source route', async context => {
  const requests = [];
  const ui = await panel(context, server(url => url.pathname === '/api/git.status'
    ? Promise.resolve({ ok: true, json: async () => ({ isRepo: true, branch: 'main', changes: [{ path: 'src/main.ts', untracked: true, letter: '?', key: 'status.untracked' }] }) }) : null, requests));
  await ui.click('src'); await ui.click('main.ts'); await ui.menu(ui.container.querySelector('.cm-content'), 'files.diff');
  assert.equal(requests.filter(request => request.name === '/api/git.source').length, 2);
  assert.equal(requests.some(request => request.name === '/api/git.diff'), false);
  assert.ok(ui.container.querySelector('.jb-dline-add .jb-dline-text').textContent.includes('const emoji'));
});

test('plain pointer input keeps source selectable while modifier-click follows the symbol', async context => {
  const requests = [];
  const ui = await panel(context, server(null, requests));
  await ui.click('src'); await ui.click('main.ts');
  const content = ui.container.querySelector('.cm-content');
  const offset = source['src/main.ts'].indexOf('render');
  // jsdom has no layout: supply only the coordinate-to-offset measurement.
  ui.editor().posAtCoords = () => offset;
  await act(async () => content.dispatchEvent(new ui.dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 0 })));
  assert.equal(requests.some(request => request.name === '/api/git.definition'), false);
  const before = ui.editor().state.doc.toString();
  await ui.key('x');
  assert.equal(ui.editor().state.doc.toString(), before);
  await act(async () => content.dispatchEvent(new ui.dom.window.MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 20, clientY: 20, button: 0, metaKey: true })));
  assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/lib.ts');
});

test('line navigation reaches beyond the old page size without paging controls and rejects invalid input', async context => {
  const text = Array.from({ length: 500 }, (_, index) => `const line${index + 1} = ${index + 1};`).join('\n');
  const ui = await panel(context, server(url => url.pathname === '/api/git.source'
    ? Promise.resolve({ ok: true, json: async () => ({ path: url.searchParams.get('path'), text, version: 'large-source' }) }) : null));
  await ui.click('src'); await ui.click('main.ts');
  assert.equal(ui.editor().state.doc.lines, 500);
  assert.equal(ui.container.querySelector('.jb-source-panel button'), null);
  await ui.key('g', { ctrlKey: true });
  let form = ui.dom.window.document.querySelector('[role=dialog]');
  assert.ok(form);
  form.querySelector('input').value = '501';
  await act(async () => form.querySelector('input').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  assert.equal(form.querySelector('[role=alert]').textContent, ui.t('files.invalidLine'));
  form.querySelector('input').value = '500:3';
  await act(async () => form.querySelector('input').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  assert.equal(ui.dom.window.document.querySelector('[role=dialog]'), null);
  const head = ui.editor().state.selection.main.head, line = ui.editor().state.doc.lineAt(head);
  assert.equal(line.number, 500); assert.equal(head - line.from, 2);
});

test('keyboard context menus close with Escape and stay outside clipped reader ancestors', async context => {
  const ui = await panel(context, server());
  await ui.click('src'); await ui.click('main.ts');
  await ui.key('F10', { shiftKey: true });
  const menu = ui.dom.window.document.querySelector('[role=menu]');
  assert.equal(menu.parentElement, ui.dom.window.document.body);
  assert.ok(Number.parseFloat(menu.style.left) >= 8);
  assert.equal(ui.dom.window.document.activeElement.getAttribute('role'), 'menuitem');
  await act(async () => menu.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  assert.equal(ui.dom.window.document.querySelector('[role=menu]'), null);
  assert.equal(ui.dom.window.document.activeElement, ui.container.querySelector('.cm-content'));
});

test('Go, Java, Python, JavaScript and TypeScript share the read-only reader with syntax highlighting', async context => {
  const samples = [
    ['sample.go', 'package demo\n// Render is a function\ntype Shape struct { Size int }\nfunc (s Shape) Render() string { return "ok" }\nfunc main() { Render(); println(42) }', [
      ['package', 'keyword'], ['// Render is a function', 'comment'], ['Shape', 'type'], ['Size', 'property'], ['int', 'type'], ['Render', 'function', 1], ['Render', 'function', 2], ['"ok"', 'string'], ['42', 'number'],
    ]],
    ['Sample.java', '@Deprecated\nclass Shape {\n  // render is a method\n  public String render(int size) { return "ok"; }\n  int value = 42;\n}', [
      ['Deprecated', 'annotation'], ['class', 'keyword'], ['Shape', 'type'], ['// render is a method', 'comment'], ['String', 'type'], ['render', 'function', 1], ['"ok"', 'string'], ['42', 'number'],
    ]],
    ['sample.py', '@dataclass(frozen=True)\nclass Shape:\n    """render is documented here"""\n    size: int = 42\n    # render is a method\n    def render(self, values: list[Shape] | None) -> str:\n        return f"value: {self.size + 1}"\nrender()\n', [
      ['dataclass', 'annotation'], ['True', 'keyword'], ['class', 'keyword', 1], ['Shape', 'type'], ['"""render is documented here"""', 'string'], ['int', 'type'], ['42', 'number'], ['# render is a method', 'comment'], ['render', 'function', 2], ['list', 'type'], ['Shape', 'type', 1], ['None', 'keyword'], ['str', 'type'], ['value:', 'string'], ['size', 'property', 1], ['1', 'number'], ['render', 'function', 3],
    ]],
    ['sample.js', '// render is a function\nclass Shape {}\nfunction render(value) { return `size: ${value.size + 42}`; }\nrender("ok");', [
      ['// render is a function', 'comment'], ['class', 'keyword'], ['Shape', 'type'], ['function', 'keyword', 1], ['render', 'function', 1], ['size:', 'string'], ['size', 'property', 1], ['42', 'number'], ['render', 'function', 2], ['"ok"', 'string'],
    ]],
    ['sample.ts', 'interface Shape { size: number }\n// render is a function\nfunction render(shape: Shape): string { return "ok"; }\nconst value = 42; render({ size: value });', [
      ['interface', 'keyword'], ['Shape', 'type'], ['size', 'property'], ['number', 'type'], ['// render is a function', 'comment'], ['render', 'function', 1], ['Shape', 'type', 1], ['string', 'type'], ['"ok"', 'string'], ['42', 'number'], ['render', 'function', 2],
    ]],
  ];
  const ui = await panel(context, server(url => {
    if (url.pathname === '/api/git.tree') return Promise.resolve({ ok: true, json: async () => ({ files: samples.map(item => item[0]) }) });
    if (url.pathname === '/api/git.source') return Promise.resolve({ ok: true, json: async () => ({ path: url.searchParams.get('path'), version: 'sample', text: samples.find(item => item[0] === url.searchParams.get('path'))[1] }) });
    return null;
  }));
  const palette = new Map();
  for (const [path, text, tokens] of samples) {
    await ui.click(path);
    assert.equal(ui.editor().state.doc.toString(), text);
    assert.equal(ui.container.querySelector('.cm-content').getAttribute('aria-readonly'), 'true');
    for (const [token, role, occurrence = 0] of tokens) {
      let offset = -1;
      for (let n = 0; n <= occurrence; n++) offset = text.indexOf(token, offset + 1);
      assert.notEqual(offset, -1, `${path}: ${token}`);
      const dom = ui.editor().domAtPos(offset + Math.floor(token.length / 2));
      const element = dom.node.nodeType === 3 ? dom.node.parentElement : dom.node;
      assert.ok(element.classList.contains('jb-syntax-' + role), `${path}: ${token} should be ${role}, got ${element.className}`);
      const color = ui.dom.window.getComputedStyle(element).color;
      assert.notEqual(color, ui.dom.window.getComputedStyle(ui.container.querySelector('.cm-editor')).color, `${path}: ${role} needs its own foreground`);
      if (palette.has(role)) assert.equal(color, palette.get(role), `${path}: consistent ${role} color`);
      palette.set(role, color);
    }
    assert.equal(ui.container.querySelector('.jb-source-panel button'), null);
  }
  const coreRoles = ['keyword', 'function', 'string', 'comment', 'number'];
  assert.equal(new Set(coreRoles.map(role => palette.get(role))).size, coreRoles.length, 'core syntax categories use distinct host tokens');
});

test('host theme changes preserve source position and reach code, menus and Git diffs', async context => {
  const ui = await panel(context, server());
  await ui.click('src'); await ui.click('main.ts');
  const view = ui.editor();
  const caret = source['src/main.ts'].indexOf('render');
  await ui.caret(caret);
  // JSDOM cannot resolve var() inside background shorthands; inspect their CSS declarations.
  const colors = (element, selector) => {
    const style = ui.dom.window.getComputedStyle(element);
    if (!selector) return { background: style.backgroundColor, foreground: style.color };
    assert.ok(element.matches(selector));
    const rule = [...ui.dom.window.document.styleSheets].flatMap(sheet => [...sheet.cssRules]).find(rule => rule.selectorText === selector);
    assert.ok(rule, selector);
    return { background: rule.style.background, foreground: style.color };
  };
  const output = {
    panel: colors(ui.container.querySelector('.jb-root'), '.jb-root'),
    editor: colors(ui.container.querySelector('.cm-editor')),
    gutter: colors(ui.container.querySelector('.cm-gutters')),
  };
  ui.dom.window.document.body.setAttribute('data-ds-dark-theme', '');
  ui.dom.window.document.body.style.setProperty('--dsw-alias-state-business-primary', 'rebeccapurple');
  assert.equal(ui.editor(), view); assert.equal(view.state.selection.main.head, caret);
  assert.equal(view.state.doc.toString(), source['src/main.ts']);
  await ui.key('F10', { shiftKey: true });
  const menu = ui.dom.window.document.querySelector('[role=menu]');
  assert.equal(menu.parentElement, ui.dom.window.document.body);
  output.menu = colors(menu, '.jb-editor-popup');
  await act(async () => menu.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await ui.menu(ui.container.querySelector('.cm-content'), 'files.diff');
  output.added = colors(ui.container.querySelector('.jb-dline-add .jb-dline-text'), '.jb-dline-add .jb-dline-text');
  output.deleted = colors(ui.container.querySelector('.jb-dline-del .jb-dline-text'), '.jb-dline-del .jb-dline-text');
  ui.dom.window.document.body.removeAttribute('data-ds-dark-theme');
  assert.deepEqual(output, JSON.parse(readFileSync(new URL('./fixtures/theme.expected.json', import.meta.url), 'utf8')));
});

test('focused and unfocused source selections use document selection colors instead of the default light palette', async context => {
 const ui = await panel(context, server());
 await ui.click('src'); await ui.click('main.ts');
 const view = ui.editor();
 // JSDOM has no selection rectangles; use the real layer structure to inspect the CSS cascade.
 const layer = ui.container.querySelector('.cm-selectionLayer') ?? ui.dom.window.document.createElement('div');
 layer.className = 'cm-selectionLayer';
 if (!layer.parentElement) view.scrollDOM.append(layer);
 const marker = ui.dom.window.document.createElement('div'); marker.className = 'cm-selectionBackground'; layer.append(marker);
 const snapshot = {};
 for (const theme of ['dark', 'light']) {
  if (theme === 'dark') ui.dom.window.document.body.setAttribute('data-ds-dark-theme', '');
  else ui.dom.window.document.body.removeAttribute('data-ds-dark-theme');
  await act(async () => view.focus());
  snapshot[theme] = { focused: ui.dom.window.getComputedStyle(marker).backgroundColor };
  assert.equal(snapshot[theme].focused, 'var(--dsw-alias-bg-document-selection)');
  await act(async () => ui.container.querySelector('input[type=search]').focus());
  snapshot[theme].unfocused = ui.dom.window.getComputedStyle(marker).backgroundColor;
  assert.equal(snapshot[theme].unfocused, 'var(--dsw-alias-bg-document-selection)');
 }
 assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL('./fixtures/source-selection.expected.json', import.meta.url), 'utf8')));
});

test('gutter breakpoints and debug shortcuts launch, step and disconnect through the workspace API', async context => {
  const actions = [];
  let active = false;
  let session = { id: 'debug-1', name: 'Launch JS', request: 'launch', state: 'paused', revision: 1, breakpoints: [{ path: 'src/main.ts', line: 1, verified: true }], frames: [{ id: 7, path: 'src/main.ts', name: 'main', line: 1, column: 1 }], scopes: [], output: 'ready\n' };
  const ui = await panel(context, server((url, options) => {
    if (url.pathname === '/api/git.debug.configurations') return Promise.resolve({ ok: true, json: async () => ({ configurations: [{ name: 'Launch JS', request: 'launch' }, { name: 'Attach JS', request: 'attach' }] }) });
    if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => active ? session : { id: null, state: 'idle' } });
    if (url.pathname === '/api/git.debug.action') {
      const body = JSON.parse(options.body); actions.push(body);
      if (body.action === 'start') active = true;
      if (body.action === 'stop') active = false;
      if (body.action === 'next') session = { ...session, state: 'running', revision: 2, frames: [], scopes: [] };
      if (body.action === 'stop') session = { ...session, state: 'ended', revision: 3, frames: [], scopes: [] };
      if (body.action === 'start' && body.name === 'Attach JS') session = { ...session, state: 'running', revision: 4, request: 'attach', name: 'Attach JS' };
      return Promise.resolve({ ok: true, json: async () => session });
    }
  }));
  await ui.click('src'); await ui.click('main.ts'); await ui.caret(0);
  await ui.key('F9');
  assert.equal(ui.container.querySelectorAll('.jb-breakpoint-enabled').length, 1);
  await ui.key('F5');
  assert.deepEqual(actions[0].breakpoints, { 'src/main.ts': [1] });
  assert.equal(actions[0].name, 'Launch JS');
  assert.ok(ui.container.querySelector('.jb-debug-line'));
  assert.ok(ui.container.querySelector('.jb-breakpoint-verified'));
  assert.ok(ui.container.querySelector('.jb-debug-pane').textContent.includes('调用栈'));
  assert.deepEqual({
    name: ui.container.querySelector('.jb-debug-name').textContent,
    state: ui.container.querySelector('.jb-debug-heading>span:last-child').textContent,
    frame: ui.container.querySelector('[role=option][aria-selected=true]').getAttribute('aria-label'),
    links: ui.container.querySelectorAll('.jb-debug-pane a').length,
    marker: ui.container.querySelector('.jb-breakpoint-enabled').textContent,
    executionLine: Boolean(ui.container.querySelector('.jb-debug-line')),
  }, JSON.parse(readFileSync(new URL('./fixtures/debug.expected.json', import.meta.url), 'utf8')));
  await ui.key('F8'); assert.equal(actions.at(-1).action, 'next');
  await ui.key('F5', { shiftKey: true }); assert.equal(actions.at(-1).action, 'stop');
  await ui.menu(ui.container.querySelector('.cm-content'), 'debug.attach');
  assert.equal(actions.at(-1).name, 'Attach JS');
  assert.equal(ui.container.querySelector('.jb-debug-line'), null);
});

test('stack selection previews source and variables, survives output, and resets only for a new pause', async context => {
 const calls = [], reads = [];
 let resolvePoll, resolveCaller, callerPending = true;
 let session = { id: 'stack-1', name: 'Python', state: 'paused', revision: 1, pauseId: 1, breakpoints: [],
  frames: [{ id: 7, name: 'main', path: 'src/main.ts', line: 1, column: 1 }, { id: 8, name: 'caller', path: 'src/lib.ts', line: 1, column: 1 }, { id: 9, name: 'system', path: null, line: 1, column: 1 }],
  scopes: [{ name: 'Locals', variablesReference: 70 }], output: '' };
 let statuses = 0;
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.source') reads.push(url.searchParams.get('path'));
  if (url.pathname === '/api/git.debug.status') {
   statuses++;
   if (statuses > 1) return new Promise(resolve => { resolvePoll = data => resolve({ ok: true, json: async () => data }); });
   return Promise.resolve({ ok: true, json: async () => session });
  }
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body); calls.push(body);
   if (body.action === 'scopes') {
    if (body.frameId === 8 && callerPending) return new Promise(resolve => { resolveCaller = () => resolve({ ok: true, json: async () => ({ scopes: [{ name: 'Locals', variablesReference: 80 }] }) }); });
    return Promise.resolve({ ok: true, json: async () => ({ scopes: [{ name: 'Locals', variablesReference: body.frameId * 10 }] }) });
   }
   if (body.action === 'variables') return Promise.resolve({ ok: true, json: async () => ({ variables: [{ name: 'value', value: String(body.reference), variablesReference: 0 }] }) });
   if (body.action === 'next') session = { ...session, revision: 3, pauseId: 2 };
   return Promise.resolve({ ok: true, json: async () => session });
  }
 }));
 const list = () => ui.container.querySelector('[role=listbox]');
 const rows = () => [...ui.container.querySelectorAll('.jb-stack-frame')];
 const selected = () => ui.container.querySelector('.jb-stack-frame[aria-selected=true]');
 const press = async (key, options = {}) => act(async () => list().dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })));
 assert.ok(selected().textContent.includes('main')); assert.ok(ui.container.querySelector('.jb-debug-variables').textContent.includes('value: 70'));
 await act(async () => rows()[1].click());
 assert.ok(resolveCaller); assert.equal(ui.dom.window.document.activeElement, list());
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/lib.ts');
 assert.ok(ui.container.querySelector('.jb-debug-frame-line'));
 assert.equal(ui.container.querySelector('.jb-debug-current'), null);
 const readsBeforeExternal = reads.length;
 await press('End');
 assert.ok(selected().textContent.includes('system'));
 assert.ok(ui.container.querySelector('.jb-debug-variables').textContent.includes('value: 90'));
 assert.equal(reads.length, readsBeforeExternal);
 await act(async () => resolveCaller()); callerPending = false;
 assert.ok(ui.container.querySelector('.jb-debug-variables').textContent.includes('value: 90'), 'late scopes from a different frame are discarded');
 await press('Home'); await press('ArrowDown');
 assert.ok(selected().textContent.includes('caller'));
 assert.ok(ui.container.querySelector('.jb-debug-variables').textContent.includes('value: 80'));
 const variablesBeforeOutput = calls.filter(call => call.action === 'variables').length;
 await act(async () => resolvePoll({ ...session, revision: 2, output: 'background output\n' }));
 assert.ok(selected().textContent.includes('caller'));
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/lib.ts');
 assert.equal(calls.filter(call => call.action === 'variables').length, variablesBeforeOutput);
 await press('Enter');
 assert.equal(ui.dom.window.document.activeElement, ui.container.querySelector('.cm-content'));
 await act(async () => rows()[1].click()); await press('F8');
 assert.equal(calls.at(-2).action, 'next');
 assert.ok(selected().textContent.includes('main'), 'a new pause resets to the execution frame even when frame IDs are reused');
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/main.ts');
 await ui.menu(rows()[1], 'files.read');
 assert.equal(ui.dom.window.document.activeElement, ui.container.querySelector('.cm-content'));
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/lib.ts');
 await press('ArrowUp');
 assert.ok(selected().textContent.includes('main'));
 await press('F10', { shiftKey: true });
 const menu = ui.dom.window.document.querySelector('[role=menu]');
 assert.ok(menu.textContent.includes('继续运行')); assert.ok(menu.textContent.includes('单步跳过'));
 assert.equal(menu.parentElement, ui.dom.window.document.body);
 await act(async () => menu.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
 assert.equal(ui.dom.window.document.querySelector('[role=menu]'), null);
});

test('current-file launch and the Enter-submitted attach prompt do not require project configuration', async context => {
 const actions = [], paths = [];
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.configurations') {
   paths.push(url.searchParams.get('path'));
   return Promise.resolve({ ok: true, json: async () => ({ configurations: [{ name: 'src/main.ts', language: 'typescript', request: 'launch', currentFile: 'src/main.ts' }] }) });
  }
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body); actions.push(body);
   return Promise.resolve({ ok: true, json: async () => ({ id: 'temporary', name: body.name ?? 'Attach', state: 'ended', revision: actions.length, frames: [], scopes: [] }) });
  }
 }));
 await ui.click('src'); await ui.click('main.ts'); await ui.caret(0);
 await ui.key('F9'); await ui.key('F5');
 assert.equal(actions[0].currentFile, 'src/main.ts');
 assert.deepEqual(actions[0].breakpoints, { 'src/main.ts': [1] });
 await ui.menu(ui.container.querySelector('.cm-content'), 'debug.attach');
 const dialog = ui.dom.window.document.querySelector('[role=dialog]');
 assert.ok(dialog); assert.equal(dialog.querySelectorAll('button').length, 0);
 assert.deepEqual({ title: dialog.getAttribute('aria-label'), labels: [...dialog.querySelectorAll('label')].map(label => label.firstChild.textContent),
  help: [...dialog.querySelectorAll('small')].map(node => node.textContent), buttons: dialog.querySelectorAll('button').length },
  JSON.parse(readFileSync(new URL('./fixtures/debug-attach.expected.json', import.meta.url), 'utf8')));
 const input = dialog.querySelector('input'); input.value = '65536';
 await act(async () => input.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
 assert.ok(dialog.querySelector('[role=alert]')); assert.equal(actions.length, 1);
 input.value = '9229';
 await act(async () => input.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
 assert.deepEqual(actions[1].attach, { language: 'javascript', kind: 'port', value: 9229 });
 assert.equal(ui.dom.window.document.querySelector('[role=dialog]'), null);
 assert.deepEqual(paths, ['src/main.ts', 'src/main.ts']);
 await ui.menu(ui.container.querySelector('.cm-content'), 'debug.attach');
 await act(async () => ui.dom.window.document.querySelector('input[name=target]').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
 assert.equal(ui.dom.window.document.querySelector('[role=dialog]'), null);
 assert.equal(actions.length, 2);
});

test('debug toolbar stays visible before launch and exposes state-appropriate controls after program exit', async context => {
 const actions = [];
 let session = null;
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.configurations') return Promise.resolve({ ok: true, json: async () => ({ configurations: [{ name: 'Demo', request: 'launch' }] }) });
  if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => session ?? { id: null, state: 'idle' } });
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body); actions.push(body);
   if (body.action === 'start') session = { id: 'toolbar-' + actions.length, name: 'Demo', state: 'paused', revision: actions.length, pauseId: 1,
    frames: [{ id: 7, path: 'src/main.ts', name: 'main', line: 1, column: 1 }], scopes: [], breakpoints: [] };
   else if (body.action === 'continue') session = { ...session, state: 'running', revision: actions.length, frames: [] };
   else if (body.action === 'pause') session = { ...session, state: 'paused', revision: actions.length, pauseId: 2, frames: [{ id: 7, path: 'src/main.ts', name: 'main', line: 1, column: 1 }] };
   else if (body.action === 'stop') session = { ...session, state: 'ended', revision: actions.length, frames: [], output: 'finished\n' };
   return Promise.resolve({ ok: true, json: async () => session });
  }
 }));
 await ui.click('src'); await ui.click('main.ts');
 const button = action => ui.container.querySelector(`.jb-debug-toolbar [data-action=${action}]`);
 const snapshot = () => [...ui.container.querySelectorAll('.jb-debug-toolbar button')].map(node => ({ action: node.dataset.action, label: node.getAttribute('aria-label'), disabled: node.disabled }));
 const result = { idle: snapshot(), groups: [...ui.container.querySelectorAll('.jb-debug-action-group')].map(group => group.getAttribute('aria-label')),
  steppingIcons: Object.fromEntries(['next', 'stepIn', 'stepOut'].map(action => [action, [...button(action).querySelectorAll('svg path')].map(path => path.getAttribute('d'))])) };
 assert.ok(ui.container.querySelector('[role=toolbar]'));
 assert.ok(ui.container.querySelector('.jb-debug-hint').textContent.includes('断点'));
 await act(async () => button('run').click());
 assert.equal(actions.at(-1).action, 'start'); result.paused = snapshot();
 assert.equal(button('run').textContent, '继续运行');
 assert.equal(button('next').title, '单步跳过 · F8\nStep Over：执行当前行，不进入被调用函数');
 await act(async () => button('run').click());
 result.running = snapshot(); assert.equal(actions.at(-1).action, 'continue');
 assert.equal(button('pause').disabled, false); assert.equal(button('next').disabled, true);
 await act(async () => button('pause').click());
 assert.equal(actions.at(-1).action, 'pause');
 await act(async () => button('stop').click());
 result.ended = snapshot();
 assert.equal(button('run').disabled, false); assert.equal(button('next').disabled, true);
 assert.ok(ui.container.querySelector('.jb-debug-pane').textContent.includes('finished'));
 const count = actions.length;
 await ui.key('F8'); await ui.key('F7');
 assert.equal(actions.length, count, 'ended sessions do not receive further step requests');
 assert.deepEqual(result, JSON.parse(readFileSync(new URL('./fixtures/debug-toolbar.expected.json', import.meta.url), 'utf8')));
 await act(async () => button('run').click());
 assert.equal(actions.at(-1).action, 'start');
});

test('the three stepping buttons dispatch different DAP commands', async context => {
 const calls = [];
 let session = { id: 'steps', name: 'Python', state: 'paused', revision: 1, pauseId: 1, frames: [{ id: 7, name: 'main', path: 'src/main.ts', line: 1, column: 1 }], scopes: [], breakpoints: [] };
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => session });
  if (url.pathname === '/api/git.debug.action') {
   calls.push(JSON.parse(options.body).action);
   session = { ...session, revision: session.revision + 1, pauseId: session.pauseId + 1 };
   return Promise.resolve({ ok: true, json: async () => session });
  }
 }));
 for (const action of ['next', 'stepIn', 'stepOut']) {
  const button = ui.container.querySelector(`.jb-debug-toolbar [data-action=${action}]`);
  assert.equal(button.disabled, false);
  await act(async () => button.click());
 }
 assert.deepEqual(calls, ['next', 'stepIn', 'stepOut']);
});

test('a program ending before a step request is reconciled as ended without a false failure', async context => {
 let ended = false, statusReads = 0;
 const calls = [];
 const live = { id: 'exit-race', name: 'Python', state: 'paused', revision: 1, pauseId: 1, frames: [{ id: 7, name: 'main', path: 'src/main.ts', line: 1, column: 1 }], scopes: [], breakpoints: [] };
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.status') {
   statusReads++;
   if (ended) return Promise.resolve({ ok: true, json: async () => ({ ...live, state: 'ended', revision: 2, frames: [], output: 'normal exit\n' }) });
   if (statusReads > 1) return new Promise(() => {});
   return Promise.resolve({ ok: true, json: async () => live });
  }
  if (url.pathname === '/api/git.debug.action') {
   calls.push(JSON.parse(options.body)); ended = true;
   return Promise.resolve({ ok: false, json: async () => ({ error: 'debug session has ended', code: 'DEBUG_SESSION_ENDED' }) });
  }
 }));
 await act(async () => ui.container.querySelector('.jb-debug-toolbar [data-action=next]').click());
 assert.equal(calls[0].action, 'next');
 assert.equal(ui.container.querySelector('.jb-debug-heading>span:last-child').textContent, '已结束');
 assert.equal(ui.container.querySelector('.jb-debug-pane [role=alert]'), null);
 assert.ok(ui.container.querySelector('.jb-debug-pane').textContent.includes('normal exit'));
 assert.equal(ui.container.querySelector('.jb-debug-toolbar [data-action=run]').disabled, false);
});

test('debug dock changes preserve the editor, selected frame and expanded variables, and survive reopening', async context => {
 const calls = [];
 const session = { id: 'layout', name: 'examples/06-job-coordination/user_code/base_job_coordination/main.py', state: 'paused', revision: 1, pauseId: 1,
  frames: [{ id: 1, name: 'main', path: 'src/main.ts', line: 1, column: 1 }, { id: 2, name: '<module>', path: 'src/lib.ts', line: 1, column: 1 }],
  scopes: [{ name: 'Locals', variablesReference: 10 }], output: 'Ready\n' };
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => session });
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body); calls.push(body);
   if (body.action === 'scopes') return Promise.resolve({ ok: true, json: async () => ({ scopes: session.scopes }) });
   if (body.action === 'variables') return Promise.resolve({ ok: true, json: async () => ({ variables: body.reference === 10
    ? [{ name: 'service', type: 'InspectionService', value: '<InspectionService>', variablesReference: 11 }, { name: 'count', type: 'int', value: '3', variablesReference: 0 }, { name: 'message', type: 'str', value: "'ready'", variablesReference: 0 }]
    : [{ name: 'enabled', type: 'bool', value: 'True', variablesReference: 0 }] }) });
   throw new Error('Docking must not execute a debugger action: ' + body.action);
  }
 }));
 const browser = () => ui.container.querySelector('.jb-code-browser');
 const select = () => ui.container.querySelector('.jb-debug-dock select');
 const change = async value => act(async () => { select().value = value; select().dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })); });
 assert.equal(browser().dataset.debugDock, 'right');
 assert.equal(select().labels[0].textContent, '停靠右侧底部');
 assert.equal(ui.container.querySelector('.jb-debug-name').textContent, 'main.py');
 assert.equal(ui.container.querySelector('.jb-debug-name').title, session.name);
 await act(async () => ui.container.querySelectorAll('.jb-stack-frame')[1].click());
 const service = [...ui.container.querySelectorAll('.jb-variable-list details')].find(node => node.querySelector('.jb-variable-name')?.textContent === 'service');
 assert.ok(service); assert.equal(service.open, false);
 await act(async () => { service.open = true; service.dispatchEvent(new ui.dom.window.Event('toggle')); });
 assert.equal(ui.container.querySelector('.jb-variable-value[data-kind=constant]').textContent, 'True');
 await ui.caret(8);
 const editor = ui.editor(), variableReads = calls.filter(call => call.action === 'variables').length;
 const output = { defaultDock: browser().dataset.debugDock, name: ui.container.querySelector('.jb-debug-name').textContent,
  location: ui.container.querySelector('.jb-stack-location-file').textContent,
  sections: [...ui.container.querySelectorAll('.jb-debug-section>summary')].map(node => node.textContent),
  variables: [...ui.container.querySelectorAll('.jb-variable-leaf .jb-variable-row')].map(node => ({ name: node.querySelector('.jb-variable-name').textContent, type: node.querySelector('.jb-variable-type').textContent, value: node.querySelector('.jb-variable-value').textContent, kind: node.querySelector('.jb-variable-value').dataset.kind })) };
 assert.deepEqual(output, JSON.parse(readFileSync(new URL('./fixtures/debug-layout.expected.json', import.meta.url), 'utf8')));
 const path = ui.container.querySelector('.jb-stack-path');
 await act(async () => { path.open = true; });
 assert.equal(path.querySelector('div').textContent, 'src/lib.ts');
 await change('bottom');
 assert.equal(browser().dataset.debugDock, 'bottom');
 assert.equal(ui.editor(), editor); assert.equal(ui.editor().state.selection.main.head, 8);
 assert.equal(ui.container.querySelector('.jb-stack-frame[aria-selected=true]').textContent, '<module>lib.ts:1');
 assert.equal(ui.container.querySelector('.jb-variable-list details'), service); assert.equal(service.open, true);
 assert.equal(path.open, true);
 assert.equal(calls.filter(call => call.action === 'variables').length, variableReads);
 assert.equal(ui.dom.window.localStorage.getItem('dsh.git-control.debugDock'), 'bottom');
 await ui.reopen();
 assert.equal(browser().dataset.debugDock, 'bottom'); assert.equal(select().value, 'bottom');
 await change('right'); await ui.reopen();
 assert.equal(browser().dataset.debugDock, 'right'); assert.equal(select().value, 'right');
});

test('invalid or unavailable dock storage keeps the panel usable and reports an unsaved choice', async context => {
 const ui = await panel(context, server(), { dock: 'floating' });
 assert.equal(ui.container.querySelector('.jb-code-browser').dataset.debugDock, 'right');
 Object.defineProperty(ui.dom.window, 'localStorage', { get() { throw new ui.dom.window.DOMException('Storage blocked', 'SecurityError'); } });
 await ui.reopen();
 await ui.click('src'); await ui.click('main.ts');
 const select = ui.container.querySelector('.jb-debug-dock select');
 await act(async () => { select.value = 'bottom'; select.dispatchEvent(new ui.dom.window.Event('change', { bubbles: true })); });
 assert.equal(ui.container.querySelector('.jb-code-browser').dataset.debugDock, 'bottom');
 assert.equal(ui.container.querySelector('.jb-debug-pane [role=alert]').textContent, '位置已切换，但浏览器存储不可用，仅对本次面板生效');
 assert.ok(ui.editor());
});

test('Markdown previews render structure and fenced syntax, retain source mode and document reading positions', async context => {
 const markdown = '# 项目说明\n\n**重点** 与 *说明*，以及 `value`。\n\n> 注意配置\n\n- [x] 已完成\n- [ ] 待处理\n\n| 文件 | 用途 |\n| --- | --- |\n| main.ts | 入口 |\n\n[阅读代码](src/main.ts) · [子文档](docs/guide.md#章节) · [章节](#项目说明)\n\n```python\ndef render():\n    return "ready"\n```\n\n```unknown\n<script>literal</script>\n```';
 const requests = [];
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.tree') return Promise.resolve({ ok: true, json: async () => ({ files: ['README.md', 'docs/guide.md', ...Object.keys(source)] }) });
  if (url.pathname === '/api/git.source' && url.searchParams.get('path').endsWith('.md')) return Promise.resolve({ ok: true, json: async () => ({ path: url.searchParams.get('path'), text: url.searchParams.get('path') === 'README.md' ? markdown : '# 章节\n\n说明', version: 'docs-v1' }) });
 }, requests));
 await ui.click('README.md');
 const article = () => ui.container.querySelector('.jb-document');
 const view = ui.editor();
 assert.equal(ui.container.querySelector('.jb-sourcebody').hidden, true);
 assert.equal(ui.dom.window.document.activeElement, article());
 assert.equal(article().querySelector('pre .jb-syntax-keyword').textContent, 'def');
 assert.equal(article().querySelector('pre .jb-syntax-function').textContent, 'render');
 assert.equal(article().querySelectorAll('pre')[1].textContent, '<script>literal</script>');
 const snapshot = { heading: article().querySelector('h1').textContent, strong: article().querySelector('strong').textContent, emphasis: article().querySelector('em').textContent,
  inlineCode: article().querySelector('p code').textContent, quote: article().querySelector('blockquote').textContent.trim(),
  tasks: [...article().querySelectorAll('.jb-document-checkbox')].map(node => node.textContent), table: [...article().querySelectorAll('th,td')].map(node => node.textContent),
  code: { keyword: article().querySelector('.jb-syntax-keyword').textContent, color: ui.dom.window.getComputedStyle(article().querySelector('.jb-syntax-keyword')).color },
  status: ui.container.querySelector('.jb-editor-status').textContent };
 assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL('./fixtures/document.expected.json', import.meta.url), 'utf8')));
 article().scrollTop = 180;
 await act(async () => [...article().querySelectorAll('a')].find(node => node.textContent === '阅读代码').click());
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'src/main.ts');
 await ui.key('[', { ctrlKey: true });
 assert.equal(article().scrollTop, 180);
 await ui.click('document.source'); await ui.caret(markdown.indexOf('value'));
 assert.equal(ui.editor(), view); assert.equal(ui.container.querySelector('.jb-document-seat').hidden, true);
 assert.ok(ui.container.querySelector('.jb-markdown-heading'));
 assert.ok(ui.container.querySelector('.jb-markdown-strong'));
 assert.ok(ui.container.querySelector('.jb-markdown-emphasis'));
 assert.ok(ui.container.querySelector('.jb-markdown-code'));
 assert.ok(ui.container.querySelector('.jb-markdown-url'));
 const caret = ui.editor().state.selection.main.head;
 await ui.click('src'); await ui.click('main.ts');
 await act(async () => ui.container.querySelector('[role=tab][aria-label="README.md"]').click());
 assert.equal(ui.container.querySelector('.jb-document-seat').hidden, true);
 assert.equal(ui.editor().state.selection.main.head, caret);
 await ui.click('document.preview');
 assert.equal(article().scrollTop, 180);
 const ids = [];
 const originalScroll = ui.dom.window.HTMLElement.prototype.scrollIntoView;
 ui.dom.window.HTMLElement.prototype.scrollIntoView = function () { ids.push(this.id); };
 await act(async () => [...article().querySelectorAll('a')].find(node => node.textContent === '子文档').click());
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'docs/guide.md');
 assert.ok(ids.includes('jb-doc-章节'));
 ui.dom.window.HTMLElement.prototype.scrollIntoView = originalScroll;
 assert.equal(requests.filter(row => row.name === '/api/git.definition').length, 0);
});

test('documents omit active HTML, prevent image requests and keep local links within the workspace', async context => {
 const text = '# 安全文档\n\n<script>window.bad = true</script>\n\n<img src="https://example.test/track" onerror="bad()">\n\n![示意图](https://example.test/image.png)\n\n[运行脚本](javascript:alert%281%29) [外链](https://example.test/docs) [越界](../../private.md)\n';
 const requests = [];
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.tree') return Promise.resolve({ ok: true, json: async () => ({ files: ['README.md'] }) });
  if (url.pathname === '/api/git.source') return Promise.resolve({ ok: true, json: async () => ({ path: 'README.md', version: 'doc', text }) });
 }, requests));
 await ui.click('README.md');
 const article = ui.container.querySelector('.jb-document');
 assert.equal(article.querySelector('script,img,iframe,style,svg,input'), null);
 assert.equal(article.querySelector('[onerror],[onclick]'), null);
 assert.equal(ui.dom.window.bad, undefined);
 assert.equal(article.querySelector('[href^="javascript:"]'), null);
 assert.equal(article.querySelector('.jb-document-image').textContent, '图片：示意图');
 const external = article.querySelector('[href="https://example.test/docs"]');
 assert.equal(external.target, '_blank'); assert.equal(external.rel, 'noopener noreferrer');
 const before = requests.length;
 await act(async () => [...article.querySelectorAll('a')].find(node => node.textContent === '越界').click());
 assert.equal(ui.container.querySelector('.jb-document-error').textContent, '无法在当前工作区内打开此链接');
 assert.equal(requests.length, before);
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'README.md');
});

test('configuration and build files use parsers for JSON, YAML, TOML, INI, shell and Makefile', async context => {
 const samples = [
  ['settings.json', '{"name":"demo","count":42,"enabled":true}', [['"name"','property'],['"demo"','string'],['42','number'],['true','keyword']]],
  ['cordis.yml', '# plugins\nname: "demo"\nport: 42\nenabled: true', [['# plugins','comment'],['name','property'],['"demo"','string']]],
  ['pyproject.toml', '# project\n[project]\nname = "demo"\ncount = 42\nenabled = true', [['# project','comment'],['name','property'],['"demo"','string'],['42','number'],['true','number']]],
  ['settings.ini', '; settings\n[service]\nname=demo', [['; settings','comment'],['name','property']]],
  ['run.sh', '# entry\nif true; then\n echo "ready"\nfi', [['# entry','comment'],['if','keyword'],['"ready"','string']]],
  ['Makefile', '# build\nbuild: src\n\techo ready\n', [['# build','comment'],['build:','type']]],
 ];
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.tree') return Promise.resolve({ ok: true, json: async () => ({ files: samples.map(row => row[0]) }) });
  if (url.pathname === '/api/git.source') { const row = samples.find(row => row[0] === url.searchParams.get('path')); return Promise.resolve({ ok: true, json: async () => ({ path: row[0], text: row[1], version: 'config' }) }); }
 }));
 for (const [path,text,tokens] of samples) {
  await ui.click(path);
  assert.equal(ui.editor().state.doc.toString(), text);
  assert.equal(ui.container.querySelector('.cm-content').getAttribute('aria-readonly'), 'true');
  for (const [token,role] of tokens) {
   const offset = text.indexOf(token), dom = ui.editor().domAtPos(offset + Math.floor(token.length/2));
   const element = dom.node.nodeType === 3 ? dom.node.parentElement : dom.node;
   assert.ok(element.classList.contains('jb-syntax-' + role), `${path}: ${token} should be ${role}, got ${element.className}`);
  }
 }
});

test('document line links and malformed cross-document anchors retain a usable reader', async context => {
 const requests = [];
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.tree') return Promise.resolve({ ok: true, json: async () => ({ files: ['README.md', 'guide.md'] }) });
  if (url.pathname === '/api/git.source') {
   const path = url.searchParams.get('path');
   const text = path === 'README.md' ? '# Home\n\n[源码行](guide.md#L3) [坏锚点](guide.md#%E0%A4%A) [编码越界](..%2Fprivate.md) [无效行](guide.md#L0)' : '# Guide\n\nDetails\n\n[本页源码](#L3)';
   return Promise.resolve({ ok: true, json: async () => ({ path, text, version: 'line-links' }) });
  }
 }, requests));
 await ui.click('README.md');
 const link = label => [...ui.container.querySelectorAll('.jb-document a')].find(node => node.textContent === label);
 const before = requests.filter(row => row.name === '/api/git.source').length;
 for (const label of ['编码越界', '无效行']) {
  await act(async () => link(label).click());
  assert.equal(requests.filter(row => row.name === '/api/git.source').length, before);
  assert.ok(ui.container.querySelector('.jb-document-error'));
 }
 await act(async () => link('源码行').dispatchEvent(new ui.dom.window.MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true })));
 assert.equal(ui.container.querySelector('.jb-diffpath').textContent, 'guide.md');
 assert.equal(ui.container.querySelector('.jb-document-seat').hidden, true);
 assert.equal(ui.editor().state.doc.lineAt(ui.editor().state.selection.main.head).number, 3);
 await ui.click('document.preview');
 await act(async () => link('本页源码').click());
 assert.equal(ui.container.querySelector('.jb-document-seat').hidden, true);
 assert.equal(ui.editor().state.doc.lineAt(ui.editor().state.selection.main.head).number, 3);
 await ui.key('[', { ctrlKey: true });
 assert.equal(ui.container.querySelector('.jb-document-seat').hidden, false);
 await act(async () => ui.container.querySelector('.jb-document').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: '[', ctrlKey: true, bubbles: true, cancelable: true })));
 await act(async () => link('坏锚点').click());
 // An explicit document destination opens its reading preview even if its source was read earlier.
 await ui.click('document.preview');
 assert.equal(ui.container.querySelector('.jb-document h1').textContent, 'Guide');
 assert.equal(ui.container.querySelector('.jb-document-error').textContent, '无法在当前工作区内打开此链接');
 assert.ok(ui.container.querySelector('.jb-document-toolbar'));
});

function paneGeometry(ui) {
 const captured = new WeakMap();
 ui.dom.window.HTMLElement.prototype.setPointerCapture = function (id) { captured.set(this, id); };
 ui.dom.window.HTMLElement.prototype.hasPointerCapture = function (id) { return captured.get(this) === id; };
 ui.dom.window.HTMLElement.prototype.releasePointerCapture = function () { captured.delete(this); };
 let narrow = false;
 ui.dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
  const root = ui.container.querySelector('.jb-code-browser');
  const value = (name, fallback) => parseFloat(root?.style.getPropertyValue('--jb-' + name)) || fallback;
  const bottom = root?.dataset.debugDock === 'bottom' || narrow;
  const width = narrow ? 390 : 1200, height = 800;
  const debug = root?.querySelector(':scope>.jb-debug-pane');
  const workspaceWidth = debug && !bottom ? width - value('debug-width',360) - 6 : width;
  const workspaceHeight = debug && bottom ? height - value('debug-height',304) - 6 : height;
  let w = 0, h = 0;
  if (this.classList.contains('jb-code-browser')) { w = width; h = height; }
  if (this.classList.contains('jb-code-workspace')) { w = workspaceWidth; h = workspaceHeight; }
  if (this.classList.contains('jb-tree')) { w = narrow ? width : Math.min(value('tree-width',340),workspaceWidth-246); h = narrow ? value('tree-height',180) : workspaceHeight; }
  if (this.classList.contains('jb-debug-pane')) { w = bottom ? width : value('debug-width',360); h = bottom ? value('debug-height',304) : height; }
  if (this.classList.contains('jb-pane-divider')) { w = this.getAttribute('aria-orientation') === 'vertical' ? 6 : workspaceWidth; h = this.getAttribute('aria-orientation') === 'horizontal' ? 6 : height; }
  return { x:0,y:0,left:0,top:0,right:w,bottom:h,width:w,height:h,toJSON(){} };
 };
 return async () => {
  narrow = true;
  ui.container.querySelector('.jb-code-browser').style.flexDirection = 'column';
  ui.container.querySelector('.jb-code-workspace').style.flexDirection = 'column';
  await ui.resize();
 };
}

test('pane dividers drag independently, keep source position, cancel safely and persist only committed sizes', async context => {
 const ui = await panel(context, server());
 paneGeometry(ui);
 await ui.click('src'); await ui.click('main.ts'); await ui.caret(12); await ui.resize();
 const view = ui.editor(), root = () => ui.container.querySelector('.jb-code-browser');
 const tree = () => ui.container.querySelector('[role=separator][data-pane=tree]');
 const debug = () => ui.container.querySelector('[role=separator][data-pane=debug]');
 const fire = async (node,type,x) => act(async () => node.dispatchEvent(new ui.dom.window.PointerEvent(type,{pointerId:1,isPrimary:true,button:0,clientX:x,bubbles:true,cancelable:true})));
 const stored = () => JSON.parse(ui.dom.window.localStorage.getItem('dsh.git-control.paneSizes') ?? '{}');
 assert.equal(tree().getAttribute('aria-orientation'),'vertical');
 await fire(tree(),'pointerdown',340); await fire(tree(),'pointermove',260);
 assert.equal(root().style.getPropertyValue('--jb-tree-width'),'260px');
 assert.deepEqual(stored(),{});
 await fire(tree(),'pointerup',260);
 assert.equal(stored().treeWidth,260);
 await fire(debug(),'pointerdown',840); await fire(debug(),'pointermove',750); await fire(debug(),'pointerup',750);
 assert.equal(stored().debugWidth,450); assert.equal(stored().treeWidth,260);
 assert.equal(ui.editor(),view); assert.equal(ui.editor().state.selection.main.head,12);
 await fire(debug(),'pointerdown',750); await fire(debug(),'pointermove',600); await fire(debug(),'pointercancel',600);
 assert.equal(root().style.getPropertyValue('--jb-debug-width'),'450px'); assert.equal(stored().debugWidth,450);
 await fire(debug(),'pointerdown',750); await fire(debug(),'pointermove',700);
 await act(async () => debug().dispatchEvent(new ui.dom.window.Event('lostpointercapture',{bubbles:true})));
 assert.equal(root().style.getPropertyValue('--jb-debug-width'),'450px');
 await ui.reopen();
 assert.equal(root().style.getPropertyValue('--jb-tree-width'),'260px'); assert.equal(root().style.getPropertyValue('--jb-debug-width'),'450px');
 await ui.click('src'); await ui.click('main.ts'); await ui.resize();
 await act(async () => tree().dispatchEvent(new ui.dom.window.MouseEvent('dblclick',{bubbles:true})));
 assert.equal(root().style.getPropertyValue('--jb-tree-width'),''); assert.equal(stored().treeWidth,undefined); assert.equal(stored().debugWidth,450);
});

test('keyboard resizing clamps panes and bottom or narrow layouts expose height dividers without losing focus', async context => {
 const ui = await panel(context, server(), {paneSizes:{treeWidth:300,debugWidth:320}});
 const narrow = paneGeometry(ui);
 await ui.click('src'); await ui.click('main.ts'); await ui.resize();
 const divider = kind => ui.container.querySelector(`[role=separator][data-pane=${kind}]`);
 const press = async (kind,key,options={}) => act(async () => divider(kind).dispatchEvent(new ui.dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options})));
 const stored = () => JSON.parse(ui.dom.window.localStorage.getItem('dsh.git-control.paneSizes') ?? '{}');
 await press('tree','ArrowRight'); assert.equal(stored().treeWidth,310);
 await press('tree','ArrowRight',{shiftKey:true}); assert.equal(stored().treeWidth,350);
 await press('tree','Home'); assert.equal(stored().treeWidth,160);
 await press('tree','End'); assert.equal(Number(divider('tree').getAttribute('aria-valuenow')),Number(divider('tree').getAttribute('aria-valuemax')));
 const editor = ui.editor(), handle = divider('debug'); handle.focus();
 const dock = ui.container.querySelector('.jb-debug-dock select');
 await act(async () => { dock.value='bottom';dock.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true})); });
 await ui.resize();
 assert.equal(divider('debug'),handle); assert.equal(ui.dom.window.document.activeElement,handle);
 assert.equal(handle.getAttribute('aria-orientation'),'horizontal');
 await press('debug','ArrowDown'); assert.equal(stored().debugHeight,314); assert.equal(stored().debugWidth,320);
 await narrow();
 assert.equal(divider('tree').getAttribute('aria-orientation'),'horizontal');
 await press('tree','ArrowDown'); assert.equal(stored().treeHeight,190);
 assert.equal(ui.editor(),editor);
 const output = [...ui.container.querySelectorAll('[role=separator]')].map(node=>({label:node.getAttribute('aria-label'),orientation:node.getAttribute('aria-orientation'),value:node.getAttribute('aria-valuenow')}));
 assert.deepEqual(output,JSON.parse(readFileSync(new URL('./fixtures/pane-layout.expected.json',import.meta.url),'utf8')));
 await press('debug','Enter'); assert.equal(stored().debugHeight,undefined); assert.equal(stored().debugWidth,320);
 await ui.click('tabs.log');
 assert.ok([...ui.container.querySelectorAll('[role=separator]')].length > 0,'hidden file tabs retain their layout instance');
});

test('invalid pane preferences fall back, and unavailable storage leaves resizing usable with visible feedback', async context => {
 const ui = await panel(context,server(),{paneSizes:{treeWidth:'large',debugWidth:-1,treeHeight:1e9,debugHeight:null}});
 paneGeometry(ui); await ui.click('src');await ui.click('main.ts');await ui.resize();
 const root=ui.container.querySelector('.jb-code-browser');
 assert.equal(root.style.getPropertyValue('--jb-tree-width'),''); assert.equal(root.style.getPropertyValue('--jb-debug-width'),'');
 Object.defineProperty(ui.dom.window,'localStorage',{get(){throw new ui.dom.window.DOMException('Blocked','SecurityError');}});
 await act(async()=>ui.container.querySelector('[role=separator][data-pane=tree]').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true})));
 assert.equal(root.style.getPropertyValue('--jb-tree-width'),'350px');
 assert.equal(ui.container.querySelector('.jb-layout-notice').textContent,'尺寸已调整，但浏览器存储不可用，仅对本次面板生效');
 assert.ok(ui.editor());
 await ui.reopen();
 assert.equal(ui.container.querySelector('.jb-code-browser').style.getPropertyValue('--jb-tree-width'),'');
});

test('a single identifier click highlights case-sensitive whole-word occurrences without definition requests', async context => {
 const text = 'def decide(view):\n    return view.result\n\nruntime(decide=decide, other=decide_next)\nDecide = None\n# decide\ntext = "decide"\n';
 const requests = [];
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.tree') return Promise.resolve({ok:true,json:async()=>({files:['main.py','other.py']})});
  if (url.pathname === '/api/git.source') { const path=url.searchParams.get('path');return Promise.resolve({ok:true,json:async()=>({path,text:path==='main.py'?text:'value = 1\n',version:'matches'})}); }
 },requests));
 await ui.click('main.py');
 const view=ui.editor(), content=ui.container.querySelector('.cm-content');
 const offset=text.indexOf('decide')+2;
 view.posAtCoords=()=>offset;
 // JSDOM supplies no hit-testing; retain CodeMirror's native click/selection behavior with a measured offset.
 view.posAndSideAtCoords=()=>({pos:offset,assoc:1});
 await act(async()=>content.dispatchEvent(new ui.dom.window.MouseEvent('mousedown',{button:0,detail:1,bubbles:true,cancelable:true,clientX:20,clientY:20})));
 await act(async()=>ui.dom.window.document.dispatchEvent(new ui.dom.window.MouseEvent('mouseup',{button:0,bubbles:true,clientX:20,clientY:20})));
 assert.equal(view.state.selection.main.empty,true);
 assert.equal(view.state.selection.main.head,offset);
 const matches=()=>[...ui.container.querySelectorAll('.cm-selectionMatch')];
 assert.deepEqual(matches().map(node=>node.textContent),['decide','decide','decide','decide','decide']);
 assert.equal(ui.container.querySelector('.cm-selectionMatch-main').textContent,'decide');
 assert.equal(requests.filter(row=>row.name==='/api/git.definition').length,0);
 const output={word:ui.container.querySelector('.cm-selectionMatch-main').textContent,occurrences:matches().length,selectedText:view.state.sliceDoc(view.state.selection.main.from,view.state.selection.main.to),
  background:ui.dom.window.getComputedStyle(matches()[1]).backgroundColor,activeOutline:ui.dom.window.getComputedStyle(ui.container.querySelector('.cm-selectionMatch-main')).outline};
 assert.deepEqual(output,JSON.parse(readFileSync(new URL('./fixtures/occurrences.expected.json',import.meta.url),'utf8')));
 await ui.caret(text.indexOf('view')+1);
 assert.deepEqual(matches().map(node=>node.textContent),['view','view']);
 // A blank line clears the previous word's highlights.
 await ui.caret(text.indexOf('\n\n')+1);
 assert.equal(matches().length,0);
 await act(async()=>view.dispatch({selection:{anchor:text.indexOf('decide'),head:text.indexOf('decide')+3}}));
 assert.equal(matches().length,0,'partial selections do not match parts of identifiers');
 await act(async()=>view.dispatch({selection:{anchor:text.indexOf('decide'),head:text.indexOf('decide')+6}}));
 assert.equal(matches().length,4,'whole-word selection highlights the other occurrences');
 assert.equal(ui.container.querySelector('.cm-selectionMatch-main'),null);
 await ui.click('other.py');
 assert.equal(ui.editor(),view);assert.equal(ui.container.querySelector('.cm-selectionMatch-main')?.textContent,'value');
 assert.ok(matches().every(node=>node.textContent!=='decide'),'replacing source drops the previous file highlights');
});

test('occurrence highlighting follows both themes and works in Go, Java, Python, JS and TS',async context=>{
 const samples=[['main.go','package main\nfunc main() { value := 1; println(value) }'],['Main.java','class Main { int value=1; int read(){ return value; } }'],['main.py','value = 1\nprint(value)'],['main.js','const value = 1; log(value);'],['main.ts','const value: number = 1; log(value);']];
 const ui=await panel(context,server(url=>{
  if(url.pathname==='/api/git.tree')return Promise.resolve({ok:true,json:async()=>({files:samples.map(row=>row[0])})});
  if(url.pathname==='/api/git.source'){const row=samples.find(row=>row[0]===url.searchParams.get('path'));return Promise.resolve({ok:true,json:async()=>({path:row[0],text:row[1],version:'occurrences'})});}
 }));
 for(const [path,text] of samples){
  await ui.click(path);await ui.caret(text.indexOf('value')+2);
  for(const dark of [true,false]){
   if(dark)ui.dom.window.document.body.setAttribute('data-ds-dark-theme','');else ui.dom.window.document.body.removeAttribute('data-ds-dark-theme');
   const matches=[...ui.container.querySelectorAll('.cm-selectionMatch')];
   assert.equal(matches.length,2,path);assert.ok(matches.every(node=>node.textContent==='value'),path);
   assert.equal(ui.dom.window.getComputedStyle(matches[1]).backgroundColor,'var(--dsw-alias-bg-document-selection)');
   assert.equal(ui.dom.window.getComputedStyle(ui.container.querySelector('.cm-selectionMatch-main')).outline,'1px solid var(--dsw-alias-state-business-primary)');
  }
  assert.equal(ui.editor().state.doc.toString(),text);
 }
});

test('all breakpoints can be removed before launch and active removal waits for adapter confirmation', async context => {
 const actions = []; let live = false, failClear = true;
 let session = { id: 'clear', state: 'paused', revision: 1, pauseId: 1, name: 'Clear', frames: [{ id: 7, path: 'src/main.ts', name: 'main', line: 1, column: 1 }], scopes: [], breakpoints: [{ path: 'src/main.ts', line: 1, verified: true }] };
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => live ? session : { id: null, state: 'idle' } });
  if (url.pathname === '/api/git.debug.configurations') return Promise.resolve({ ok: true, json: async () => ({ configurations: [{ name: 'Clear', request: 'launch' }] }) });
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body); actions.push(body);
   if (body.action === 'start') live = true;
   if (body.action === 'stop') session = { ...session, state: 'ended', revision: session.revision + 1, breakpoints: [{ path: 'src/main.ts', line: 1, verified: true }] };
   if (body.action === 'breakpoints') {
    if (failClear) return Promise.resolve({ ok: false, json: async () => ({ code: 'DEBUG_BREAKPOINTS_FAILED', error: 'adapter unavailable' }) });
    session = { ...session, revision: session.revision + 1, breakpoints: [] };
   }
   return Promise.resolve({ ok: true, json: async () => session });
  }
 }));
 await ui.click('src'); await ui.click('main.ts'); await ui.caret(0); await ui.key('F9');
 const clear = () => ui.container.querySelector('[data-action=clearBreakpoints]');
 assert.equal(clear().disabled, false);
 await act(async () => clear().click());
 assert.equal(actions.length, 0); assert.equal(ui.container.querySelectorAll('.jb-breakpoint-enabled').length, 0);
 await ui.key('F9'); await ui.key('F5');
 await act(async () => clear().click());
 assert.deepEqual(actions.at(-1).breakpoints, {});
 assert.equal(ui.container.querySelectorAll('.jb-breakpoint-enabled').length, 1, 'failed clearing retains the requested markers');
 assert.match(ui.container.querySelector('.jb-debug-pane [role=alert]').textContent, /尚未确认/);
 failClear = false;
 await act(async () => clear().click());
 assert.equal(ui.container.querySelectorAll('.jb-breakpoint-enabled').length, 0); assert.equal(clear().disabled, true);
 await ui.key('F9');
 await act(async () => ui.container.querySelector('[data-action=stop]').click());
 const count = actions.length;
 await act(async () => clear().click());
 assert.equal(actions.length, count, 'ended sessions clear local markers without contacting a stopped adapter');
 assert.equal(clear().disabled, true, 'historical adapter results do not keep the clear action enabled');
});

test('Alt F8 evaluates selected source explicitly in the selected frame and expands returned objects', async context => {
 const calls = []; let evaluated = false;
 const session = { id: 'eval', name: 'Evaluate', state: 'paused', revision: 1, pauseId: 3, frames: [7, 8].map(id => ({ id, path: 'src/main.ts', name: 'frame' + id, line: 1, column: 1 })), scopes: [], breakpoints: [] };
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => session });
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body); calls.push(body);
   if (body.action === 'evaluate') evaluated = true;
   const data = body.action === 'evaluate' ? { result: '{value: 42}', type: 'Object', variablesReference: 91 }
    : body.action === 'variables' ? { variables: [{ name: 'value', value: body.reference === 90 && !evaluated ? '41' : '42', type: 'number', variablesReference: 0 }] } : { scopes: [{ name: 'Locals', variablesReference: 90 }] };
   return Promise.resolve({ ok: true, json: async () => data });
  }
 }));
 await act(async () => ui.container.querySelectorAll('[role=option]')[1].click());
 assert.equal(ui.container.querySelector('.jb-debug-scopes .jb-variable-value').textContent, '41');
 await act(async () => ui.editor().dispatch({ selection: { anchor: 0, head: 5 } }));
 await ui.key('F8', { altKey: true });
 const doc = ui.dom.window.document, dialog = () => doc.querySelector('.jb-evaluate');
 assert.ok(dialog()); assert.equal(ui.container.contains(dialog()), false);
 const input = dialog().querySelector('textarea'); assert.equal(input.value, 'const'); assert.equal(doc.activeElement, input);
 assert.equal(calls.filter(call => call.action === 'evaluate').length, 0, 'opening never evaluates');
 await act(async () => {
  Object.getOwnPropertyDescriptor(ui.dom.window.HTMLTextAreaElement.prototype, 'value').set.call(input, 'state');
  input.dispatchEvent(new ui.dom.window.Event('input', { bubbles: true }));
 });
 assert.equal(calls.filter(call => call.action === 'evaluate').length, 0, 'editing never evaluates');
 await act(async () => input.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })));
 assert.equal(calls.filter(call => call.action === 'evaluate').length, 0);
 await act(async () => input.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
 const evaluate = calls.find(call => call.action === 'evaluate');
 assert.equal(evaluate.expression, 'state'); assert.equal(evaluate.frameId, 8); assert.equal(evaluate.pauseId, 3);
 assert.ok(dialog().textContent.includes('{value: 42}'));
 assert.equal(ui.container.querySelector('.jb-debug-scopes .jb-variable-value').textContent, '42', 'variables refresh after evaluation');
 const branch = dialog().querySelector('details');
 await act(async () => { branch.open = true; branch.dispatchEvent(new ui.dom.window.Event('toggle')); });
 assert.equal(dialog().querySelector('.jb-variable-leaf .jb-variable-value').textContent, '42');
 assert.equal(calls.at(-1).reference, 91); assert.equal(calls.at(-1).pauseId, 3);
 const snapshot = { title: dialog().getAttribute('aria-label'), frame: dialog().querySelector('.jb-evaluate-frame').textContent, expression: input.value,
  result: dialog().querySelector('.jb-evaluate-result').textContent, hint: [...dialog().querySelectorAll('small')].map(node => node.textContent) };
 assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL('./fixtures/evaluation.expected.json', import.meta.url), 'utf8')));
 await act(async () => doc.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
 assert.equal(dialog(), null);
 await act(async () => ui.container.querySelector('[data-action=evaluate]').click());
 assert.equal(dialog().querySelector('textarea').value, 'const', 'toolbar uses the source selection');
 await act(async () => doc.dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
 ui.editor().posAtCoords = () => 2;
 await ui.menu(ui.container.querySelector('.cm-content'), 'debug.evaluate');
 assert.equal(dialog().querySelector('textarea').value, 'const', 'context menu uses the source selection');
});

test('failed evaluation remains visible without retry and late results cannot replace a newer pause', async context => {
 let resolveEvaluation, calls = 0;
 let session = { id: 'late-eval', name: 'Evaluate', state: 'paused', revision: 1, pauseId: 1, frames: [{ id: 7, path: 'src/main.ts', name: 'main', line: 1, column: 1 }], scopes: [], breakpoints: [] };
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => session });
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body);
   if (body.action === 'evaluate') {
    calls++;
    if (calls === 1) return Promise.resolve({ ok: false, json: async () => ({ code: 'DEBUG_EVALUATION_FAILED', error: 'name not found' }) });
    return new Promise(resolve => { resolveEvaluation = resolve; });
   }
   if (body.action === 'next') session = { ...session, pauseId: 2, revision: 2 };
   return Promise.resolve({ ok: true, json: async () => session });
  }
 }));
 await ui.click('src'); await ui.click('main.ts');
 await act(async () => ui.editor().dispatch({ selection: { anchor: 0, head: 5 } }));
 await ui.key('F8', { altKey: true });
 const doc = ui.dom.window.document, dialog = () => doc.querySelector('.jb-evaluate');
 const enter = async () => act(async () => dialog().querySelector('textarea').dispatchEvent(new ui.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
 await enter(); assert.match(dialog().querySelector('[role=alert]').textContent, /可能已执行/); assert.equal(calls, 1);
 await enter(); await enter(); assert.equal(calls, 2, 'pending evaluation is submitted only once');
 await act(async () => ui.container.querySelector('[data-action=next]').click());
 assert.equal(dialog().querySelector('.jb-evaluate-result'), null);
 await act(async () => resolveEvaluation({ ok: true, json: async () => ({ result: 'STALE', variablesReference: 0 }) }));
 assert.equal(dialog().querySelector('.jb-evaluate-result'), null); assert.equal(calls, 2);
});

test('Python, Go, Java, JavaScript and TypeScript expose independent folding without editing source or toggling breakpoints', async context => {
 const files = {
  'src/fold.py': 'class Basket:\n    def total(self):\n        return 42\n\nBasket()\n',
  'src/fold.go': 'package main\nfunc total() int {\n  if true {\n    return 42\n  }\n  return 0\n}\n',
  'src/fold.java': 'class Basket {\n  int total() {\n    return 42;\n  }\n}\n',
  'src/fold.js': 'class Basket {\n  total() {\n    return 42;\n  }\n}\n',
  'src/fold.ts': 'class Basket {\n  total(): number {\n    return 42;\n  }\n}\n',
 };
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.tree') return Promise.resolve({ ok: true, json: async () => ({ files: Object.keys(files) }) });
  if (url.pathname === '/api/git.source') return Promise.resolve({ ok: true, json: async () => ({ path: url.searchParams.get('path'), text: files[url.searchParams.get('path')], version: 'fold-v1' }) });
 }));
 await ui.click('src');
 const snapshot = [];
 for (const [path, text] of Object.entries(files)) {
  await ui.click(path.slice(4));
  const view = ui.editor();
  const marker = ui.container.querySelector('.cm-foldGutter span[title="折叠代码"]');
  assert.ok(marker, path);
  const line = path.endsWith('.go') ? 2 : 1;
  const block = view.lineBlockAt(view.state.doc.line(line).from);
  marker.parentElement.getBoundingClientRect = () => ({ top: view.documentTop + block.top, bottom: view.documentTop + block.bottom });
  // JSDOM has no gutter geometry; bind this click to the indicated source line.
  const lineAtHeight = view.lineBlockAtHeight;
  view.lineBlockAtHeight = () => block;
  try { await act(async () => marker.click()); } finally { view.lineBlockAtHeight = lineAtHeight; }
  const placeholder = ui.container.querySelector('.cm-foldPlaceholder');
  assert.ok(placeholder, path);
  snapshot.push({ path, fold: marker.title, placeholder: placeholder.textContent, label: placeholder.getAttribute('aria-label'), unfold: placeholder.title });
  assert.equal(placeholder.getAttribute('aria-label'), ui.t('files.foldedCode'));
  assert.equal(ui.container.querySelector('.cm-content').getAttribute('aria-readonly'), 'true');
  assert.equal(ui.container.querySelectorAll('.jb-breakpoint-enabled').length, 0);
  assert.equal(view.state.doc.toString(), text);
  await act(async () => placeholder.click());
  assert.equal(ui.container.querySelector('.cm-foldPlaceholder'), null);
  assert.equal(ui.editor(), view);
 }
 assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL('./fixtures/folding.expected.json', import.meta.url), 'utf8')));
});

test('folding survives file tabs, reveals hidden definition targets and discards stale folds after a source change', async context => {
 let changed = false;
 const text = 'class Basket {\n  total() {\n    return 42;\n  }\n}\n\nfunction extra() {\n  return 7;\n}\n';
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.source' && url.searchParams.get('path') === 'src/main.ts') return Promise.resolve({ ok: true, json: async () => ({ path: 'src/main.ts', text: changed ? 'const replacement = 1;' : text, version: changed ? 'fold-v2' : 'fold-v1' }) });
  if (url.pathname === '/api/git.definition') return Promise.resolve({ ok: true, json: async () => ({ targets: [{ path: 'src/main.ts', line: 2, character: 4 }], external: 0 }) });
 }));
 await ui.click('src'); await ui.click('main.ts');
 const view = ui.editor();
 await ui.caret(0); await ui.key('{', { ctrlKey: true, shiftKey: true, keyCode: 219, code: 'BracketLeft' });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 1);
 await ui.click('lib.ts');
 await act(async () => ui.container.querySelector('[role=tab][title="src/main.ts"]').click());
 assert.equal(ui.editor(), view);
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 1);
 await ui.key('}', { ctrlKey: true, shiftKey: true, keyCode: 221, code: 'BracketRight' });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 0);
 await ui.caret(text.indexOf('total'));
 await ui.key('{', { ctrlKey: true, shiftKey: true, keyCode: 219, code: 'BracketLeft' });
 await ui.caret(0);
 await ui.key('{', { ctrlKey: true, shiftKey: true, keyCode: 219, code: 'BracketLeft' });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 1);
 await ui.key('}', { ctrlKey: true, shiftKey: true, keyCode: 221, code: 'BracketRight' });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 1, 'unfolding the class retains the nested method fold');
 await ui.key(']', { ctrlKey: true, altKey: true });
 await ui.key('[', { ctrlKey: true, altKey: true });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 2);
 await ui.key(']', { ctrlKey: true, altKey: true });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 0);
 await ui.key('[', { ctrlKey: true, altKey: true });
 await ui.click('lib.ts'); await ui.caret(source['src/lib.ts'].indexOf('render')); await ui.key('F12');
 assert.equal(ui.editor().state.doc.lineAt(ui.editor().state.selection.main.head).number, 3);
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 1, 'definition opens the containing class and retains the unrelated function fold');
 await ui.click('lib.ts'); changed = true;
 await act(async () => ui.container.querySelector('[role=tab][title="src/main.ts"]').click());
 assert.equal(ui.editor().state.doc.toString(), 'const replacement = 1;');
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 0);
});

test('a newly paused debugger expands its hidden execution line and fold placeholders use host colors', async context => {
 const text = 'def total():\n    value = 42\n    return value\n\ndef other():\n    return 7\n';
 let session = { id: null, state: 'idle' };
 const ui = await panel(context, server((url, options) => {
  if (url.pathname === '/api/git.tree') return Promise.resolve({ ok: true, json: async () => ({ files: ['src/main.py'] }) });
  if (url.pathname === '/api/git.source') return Promise.resolve({ ok: true, json: async () => ({ path: 'src/main.py', text, version: 'fold-py-v1' }) });
  if (url.pathname === '/api/git.debug.status') return Promise.resolve({ ok: true, json: async () => session });
  if (url.pathname === '/api/git.debug.configurations') return Promise.resolve({ ok: true, json: async () => ({ configurations: [{ name: 'Folded', request: 'launch' }] }) });
  if (url.pathname === '/api/git.debug.action') {
   const body = JSON.parse(options.body);
   if (body.action === 'start') session = { id: 'fold-debug', name: 'Folded', state: 'paused', revision: 1, pauseId: 1, frames: [{ id: 7, path: 'src/main.py', name: 'total', line: 2, column: 1 }], scopes: [], breakpoints: [] };
   return Promise.resolve({ ok: true, json: async () => session });
  }
 }));
 await ui.click('src'); await ui.click('main.py');
 await ui.key('[', { ctrlKey: true, altKey: true });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 2);
 for (const dark of [true, false]) {
  ui.dom.window.document.body.toggleAttribute('data-ds-dark-theme', dark);
  const style = ui.dom.window.getComputedStyle(ui.container.querySelector('.cm-foldPlaceholder'));
  assert.equal(style.backgroundColor, 'var(--dsw-alias-bg-layer-1)');
  assert.equal(style.color, 'var(--dsw-alias-label-primary)');
 }
 await ui.key('F5');
 assert.ok(ui.container.querySelector('.jb-debug-line'));
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 1);
 assert.ok(ui.container.querySelector('.cm-content').textContent.includes('value = 42'));
 assert.equal(ui.editor().state.doc.toString(), text);
});

test('macOS folding shortcuts remain distinct from navigation history', async context => {
 const ui = await panel(context, server(url => {
  if (url.pathname === '/api/git.source') return Promise.resolve({ ok: true, json: async () => ({ path: url.searchParams.get('path'), text: 'function total() {\n  return 42;\n}\n', version: 'fold-mac-v1' }) });
 }), { platform: 'MacIntel' });
 await ui.click('src'); await ui.click('main.ts');
 const back = ui.container.querySelector('.cm-content').textContent;
 await ui.key('[', { metaKey: true, altKey: true, keyCode: 219 });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 1);
 await ui.key(']', { metaKey: true, altKey: true, keyCode: 221 });
 assert.equal(ui.container.querySelectorAll('.cm-foldPlaceholder').length, 0);
 assert.equal(ui.container.querySelector('.cm-content').textContent, back);
});
