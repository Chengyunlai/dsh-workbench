import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('project review works before selecting a file and opens the new conversation', async () => {
  let plugin, Panel, cursor = 0;
  const state = [], sent = [], opened = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => { const i = cursor++; state[i] ??= typeof initial === 'function' ? initial() : initial; return [state[i], (value) => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    useEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useRef: () => ({ current: null }),
  };
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (spec) => { plugin = spec.factory(() => React); } } },
    fetch: async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ ok: true, sessionId: 'session-new' }) }; },
    AbortController, Set, Map, console,
  });
  plugin.apply({
    effect: () => {}, locale: { register: () => {}, bind: () => (key, vars) => key + (vars ? JSON.stringify(vars) : '') },
    uiWorkspace: { openSession: (id) => opened.push(id) },
    sidebarRightTabs: { register: () => () => {} },
    slots: { inject: (name, fn) => fn(), register: (spec, component) => { if (spec.name === 'main') Panel = component; } },
  });
  const inner = Panel({ useWorkspaces: (select) => select({ items: [{ workspaceId: 'demo', path: '/demo' }] }), useSessions: (select) => select({ byId: {} }), t: (key, vars) => key + (vars ? JSON.stringify(vars) : '') });
  const render = () => { cursor = 0; return inner.type(inner.props); };
  const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];
  let tree = render();
  const button = nodes(tree).find((node) => node.type === 'button' && node.children.includes('review.button'));
  assert.ok(button);
  button.props.onClick();
  tree = render();
  const composer = nodes(tree).find((node) => node.type?.name === 'ReviewComposer');
  assert.ok(composer);
  await composer.props.onSubmit('Please review');
  assert.equal(sent[0].cwd, '/demo');
  assert.ok(sent[0].text.startsWith('Please review'));
  assert.ok(!sent[0].text.includes('```diff'));
  assert.deepEqual(opened, ['session-new']);
});


test('workbench branding preserves installed dock identifiers and leaves the conversation visible', () => {
  let plugin, dictionaries; const registrations = [], types = [], cleanups = [];
  const React = { createElement: (type, props) => ({ type, props }), useState: () => {}, useEffect: () => {}, useCallback: () => {}, useMemo: () => {}, useRef: () => {} };
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (spec) => { plugin = spec.factory(() => React); } } },
  });
  plugin.apply({
    effect: (fn) => cleanups.push(fn()),
    locale: { register: (namespace, value) => { dictionaries = value; return () => {}; }, bind: () => (key) => dictionaries.zh[key] ?? key },
    uiWorkspace: { openSession: () => {} },
    sidebarRightTabs: { register: (definition) => { types.push(definition); return () => types.pop(); } },
    slots: {
      inject: (name, fn) => fn(),
      register: (spec, component) => { registrations.push({ spec, component }); return () => registrations.pop(); },
    },
  });
  assert.ok(plugin.inject.includes('sidebarRightTabs'));
  assert.equal(types.length, 1);
  assert.equal(types[0].kind, 'git');
  assert.equal(types[0].id, '@local/dsh-git-control');
  assert.deepEqual({
    title: types[0].title(), description: types[0].guide[0].description(), englishTitle: dictionaries.en.panel,
    pluginTitle: JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8')).meta.title,
  }, JSON.parse(readFileSync(new URL('./fixtures/workbench-registration.expected.json', import.meta.url), 'utf8')));
  assert.equal(typeof types[0].guide[0].icon, 'function');
  assert.ok(registrations.some(x => x.spec.name === 'sidebar.right.pane.tab' && x.spec.key === types[0].id));
  assert.ok(!registrations.some(x => x.spec.name === 'sidebar.panellist'));
  for (const cleanup of cleanups.reverse()) cleanup?.();
  assert.equal(types.length, 0);
});

test('a right-side Git tab follows its own session instead of a different foreground session', () => {
  let plugin, Panel;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: () => ({ current: null }),
  };
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (spec) => { plugin = spec.factory(() => React); } } },
  });
  plugin.apply({
    effect: fn => fn(), locale: { register: () => () => {}, bind: () => key => key },
    uiWorkspace: { openSession: () => {} }, sidebarRightTabs: { register: () => () => {} },
    slots: { inject: (name, fn) => fn(), register: (spec, component) => { if (spec.name === 'sidebar.right.pane.tab') Panel = component; return () => {}; } },
  });
  const props = {
    sessionId: 'own', t: key => key,
    useWorkspaces: select => select({ items: [{ workspaceId: 'a', path: '/a' }, { workspaceId: 'b', path: '/b' }] }),
    useSessions: select => select({ byId: {
      other: { id: 'other', cwd: '/a', retainedBy: { mainView: 1 } },
      own: { id: 'own', cwd: '/b' },
    } }),
  };
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];
  let inner=Panel(props); let tree=inner.type(inner.props);
  assert.equal(nodes(tree).find(x => x.type === 'select').props.value, 'b');
  inner=Panel({...props, sessionId:'missing'});tree=inner.type(inner.props);
  assert.equal(nodes(tree).find(x => x.type === 'select').props.value, '');
  assert.equal(nodes(tree).find(x => x.type === 'button' && x.children.includes('review.button')).props.disabled, true);
});
