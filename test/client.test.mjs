import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

/** The React stub records hook slots in one flat array and runs effect callbacks inline. */
function createReact(state) {
  let cursor = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    Fragment: 'fragment',
    useId: () => 'test-tools',
    useState: (initial) => {
      const index = cursor++;
      state[index] ??= typeof initial === 'function' ? initial() : initial;
      return [state[index], (value) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect: (fn) => { fn(); },
    useLayoutEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: () => ({ current: null }),
  };
  React.reset = () => { cursor = 0; };
  React.seek = (index) => { cursor = index; };
  return React;
}

function loadPlugin(React, fetch) {
  let plugin;
  vm.runInNewContext(readFileSync(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: (spec) => { plugin = spec.factory(() => React); } } },
    fetch, AbortController, URL, URLSearchParams, Set, Map, console,
  });
  return plugin;
}

/** Capture the main-panel component and a locale that exposes interpolation parameters. */
function applyPlugin(plugin, { opened = [], activeLocale = 'en' } = {}) {
  let Panel;
  const t = (key, vars) => key + (vars && Object.keys(vars).length > 0 ? JSON.stringify(vars) : '');
  plugin.apply({
    effect: () => {},
    locale: { register: () => {}, bind: () => t, getLocale: () => ({ active: activeLocale }) },
    uiWorkspace: { openSession: (id) => opened.push(id) },
    sidebarRightTabs: { register: () => () => {} },
    slots: { inject: (name, fn) => fn(), register: (spec, component) => { if (spec.name === 'main') Panel = component; return () => {}; } },
  });
  return { Panel, t, opened };
}

const nodes = (node) => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flat(Infinity).flatMap(nodes)];
const reply = (data) => ({ ok: true, json: async () => data });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function findButton(tree, label) {
  return nodes(tree).find((node) => node.type === 'button' && (node.props['aria-label'] === label || node.children.includes(label)));
}

function findTool(tree, label) {
  return nodes(tree).find((node) => node.type === 'button' && node.props['aria-label'] === label && node.props.className === 'jb-tool-toggle');
}

test('both AI actions open their own composer and dispatch one structured payload', async () => {
  const state = [], sent = [], opened = [];
  const React = createReact(state);
  const plugin = loadPlugin(React, async (url, options = {}) => {
    const path = String(url).split('?')[0];
    if (path === '/api/git.dispatch') { sent.push(JSON.parse(options.body)); return reply({ ok: true, sessionId: 'session-new' }); }
    if (path === '/api/git.status') return reply({});
    if (path === '/api/git.log') return reply({ commits: [] });
    throw new Error('unexpected request ' + url);
  });
  const { Panel, t } = applyPlugin(plugin, { opened, activeLocale: 'zh' });
  const props = {
    useWorkspaces: (select) => select({ items: [{ workspaceId: 'demo', path: '/demo' }] }),
    useSessions: (select) => select({ byId: {} }),
    t,
  };
  const render = () => { React.reset(); const inner = Panel(props); return inner.type(inner.props); };

  let tree = render();
  const task = findButton(tree, 'review.button.task');
  const explain = findButton(tree, 'review.button.explain');
  assert.ok(task);
  assert.ok(explain);
  assert.equal(task.props.disabled, false);
  assert.equal(explain.props.disabled, false);
  assert.ok(task.props.className.includes('jb-review-btn'));
  assert.ok(!task.props.className.includes('jb-review-btn-ghost'));
  assert.ok(explain.props.className.includes('jb-review-btn-ghost'));

  task.props.onClick();
  tree = render();
  let composer = nodes(tree).find((node) => node.type?.name === 'ReviewComposer');
  assert.ok(composer);
  assert.equal(composer.props.intent, 'task');
  React.seek(1000);
  let composerTree = composer.type(composer.props);
  assert.equal(nodes(composerTree).find((node) => node.type === 'textarea').props.placeholder, 'review.placeholder.task');
  assert.equal(nodes(composerTree).find((node) => node.props.className === 'jb-review-title').children[0], 'review.title.task');
  assert.equal(nodes(composerTree).find((node) => node.props.className === 'jb-review-note').children[0], 'review.note.task');

  await composer.props.onSubmit('Please apply the fix');
  assert.deepEqual(sent[0], { cwd: '/demo', intent: 'task', text: 'Please apply the fix', locale: 'zh' });
  assert.deepEqual(opened, ['session-new']);

  tree = render();
  findButton(tree, 'review.button.explain').props.onClick();
  tree = render();
  composer = nodes(tree).find((node) => node.type?.name === 'ReviewComposer');
  assert.equal(composer.props.intent, 'explain');
  React.seek(1000);
  composerTree = composer.type(composer.props);
  assert.equal(nodes(composerTree).find((node) => node.type === 'textarea').props.placeholder, 'review.placeholder.explain');
  assert.equal(nodes(composerTree).find((node) => node.props.className === 'jb-review-title').children[0], 'review.title.explain');
  assert.equal(nodes(composerTree).find((node) => node.props.className === 'jb-review-note').children[0], 'review.note.explain');
  await composer.props.onSubmit('Explain this project');
  assert.equal(sent[1].intent, 'explain');
  assert.equal(sent[1].text, 'Explain this project');
  assert.equal(sent[1].cwd, '/demo');
  assert.deepEqual(opened, ['session-new', 'session-new']);
});

test('both AI actions are disabled without a workspace', () => {
  const state = [];
  const React = createReact(state);
  const plugin = loadPlugin(React, async () => reply({}));
  const { Panel, t } = applyPlugin(plugin);
  React.reset();
  const inner = Panel({ useWorkspaces: (select) => select({ items: [] }), useSessions: (select) => select({ byId: {} }), t });
  const tree = inner.type(inner.props);
  assert.equal(findButton(tree, 'review.button.task').props.disabled, true);
  assert.equal(findButton(tree, 'review.button.explain').props.disabled, true);
});

test('memory cards stay available without a Git repository', async () => {
  const state = [];
  const React = createReact(state);
  const plugin = loadPlugin(React, async (url) => {
    const path = String(url).split('?')[0];
    if (path === '/api/git.status') return reply({ isRepo: false });
    if (path === '/api/git.log') return reply({ commits: [] });
    throw new Error('unexpected request ' + url);
  });
  const { Panel, t } = applyPlugin(plugin);
  const props = {
    useWorkspaces: (select) => select({ items: [{ workspaceId: 'demo', path: '/demo' }] }),
    useSessions: (select) => select({ byId: {} }),
    t,
  };
  React.reset();
  const inner = Panel(props);
  let tree = inner.type(inner.props);
  await flush();
  React.reset();
  tree = inner.type(inner.props);
  assert.equal(findTool(tree, 'cards.title').props.disabled, false);
  assert.equal(findTool(tree, 'tabs.changes').props.disabled, true);
  assert.equal(findTool(tree, 'debug.title').props.disabled, true);
});

test('memory cards list the folder, read one card inline and open its workspace links', async () => {
  const state = [];
  const React = createReact(state);
  const requests = [];
  const plugin = loadPlugin(React, async (url, options = {}) => {
    const path = String(url).split('?')[0];
    requests.push(path);
    if (path === '/api/git.status') return reply({ isRepo: true, branch: 'main', head: 'abc1234', changes: [], shown: 0, total: 0 });
    if (path === '/api/git.log') return reply({ commits: [] });
    if (path === '/api/git.cards') return reply({ ok: true, cardsDir: '.dsh/memory', exists: true, skipped: 0, truncated: false, cards: [
      { path: '.dsh/memory/beta.md', title: 'Beta', tags: [], summary: 'Second card', group: 'src/model', source: 'src/model/transport.py:71' },
      { path: '.dsh/memory/alpha.md', title: 'Alpha', tags: ['git', 'diff'], summary: 'First card' },
    ] });
    if (path === '/api/git.card') return reply({ ok: true, path: '.dsh/memory/alpha.md', title: 'Alpha', tags: ['git', 'diff'], body: '# Alpha\n\nCard body.' });
    throw new Error('unexpected request ' + url);
  });
  const { Panel, t } = applyPlugin(plugin);
  const props = {
    useWorkspaces: (select) => select({ items: [{ workspaceId: 'demo', path: '/demo' }] }),
    useSessions: (select) => select({ byId: {} }),
    t,
  };
  const render = () => { React.reset(); const inner = Panel(props); return inner.type(inner.props); };

  let tree = render();
  await flush();
  tree = render();
  const cardsTool = findTool(tree, 'cards.title');
  assert.equal(cardsTool.props.disabled, false);
  cardsTool.props.onClick();

  tree = render();
  let panel = nodes(tree).find((node) => node.type?.name === 'CardsPanel');
  assert.ok(panel);
  assert.equal(panel.props.active, true);
  React.seek(2000);
  panel.type(panel.props);
  await flush();

  tree = render();
  panel = nodes(tree).find((node) => node.type?.name === 'CardsPanel');
  React.seek(2000);
  let panelTree = panel.type(panel.props);
  const rows = nodes(panelTree).filter((node) => node.type === 'button' && String(node.props.className).includes('jb-card-row'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => nodes(row).find((node) => node.props?.className === 'jb-card-title').children[0]), ['Alpha', 'Beta']);
  assert.deepEqual(nodes(panelTree).filter(node => node.type === 'summary').map(node => node.children[0]), ['cards.uncategorized', 'src/model']);
  assert.equal(nodes(panelTree).find((node) => node.props?.className === 'jb-cards-dir').children[0], 'cards.dir{"dir":".dsh/memory"}');
  assert.ok(requests.includes('/api/git.cards'));

  const filter = () => nodes(panelTree).find(node => node.type === 'input' && node.props.type === 'search');
  filter().props.onChange({ target: { value: 'beta transport' } });
  React.seek(2000);
  panelTree = panel.type(panel.props);
  assert.deepEqual(nodes(panelTree).filter(node => node.props?.className === 'jb-card-title').map(node => node.children[0]), ['Beta']);
  filter().props.onChange({ target: { value: '' } });

  rows[0].props.onClick();
  await flush();
  tree = render();
  panel = nodes(tree).find((node) => node.type?.name === 'CardsPanel');
  React.seek(2000);
  panelTree = panel.type(panel.props);
  assert.ok(nodes(panelTree).find((node) => node.type === 'button' && node.children.includes('cards.back')));
  const reader = nodes(panelTree).find((node) => node.type?.name === 'MarkdownReader');
  assert.ok(reader);
  assert.equal(reader.props.source.path, '.dsh/memory/alpha.md');
  assert.equal(reader.props.source.text, '# Alpha\n\nCard body.');
  assert.equal(reader.props.blocked, false);
  assert.equal(reader.props.target.documentScroll, 0);
  assert.equal(reader.props.target.focusSource, false);

  reader.props.onOpen({ path: 'src/main.py', line: 3, character: 2, documentMode: 'source', focusSource: true });
  await flush();
  tree = render();
  const browser = nodes(tree).find((node) => node.type?.name === 'CodeBrowser');
  assert.ok(browser);
  assert.equal(browser.props.initialTarget.path, 'src/main.py');
  assert.equal(browser.props.initialTarget.line, 3);
  assert.equal(browser.props.initialTarget.documentMode, 'source');
  assert.equal(browser.props.initialTarget.focusSource, true);
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
  assert.equal(plugin.inject.sidebarRightTabs.required, true);
  assert.equal(plugin.inject.webTerminals.required, false);
  assert.equal(types.length, 1);
  assert.equal(types[0].kind, 'git');
  assert.equal(types[0].id, '@local/dsh-git-control');
  assert.equal(types[0].keepMounted, true);
  assert.equal(types[0].canOpen('dsh-resource://file/session/s/docs/guide.md'), true);
  assert.equal(types[0].canOpen('dsh-resource://changes-review/session/s/1/1'), true);
  assert.equal(types[0].canOpen('dsh-resource://file/session/s/main.py'), true);
  assert.deepEqual({
    title: types[0].title(), description: types[0].guide[0].description(), englishTitle: dictionaries.en.panel,
    pluginTitle: JSON.parse(readFileSync(new URL('../locale/zh.json', import.meta.url), 'utf8')).meta.title,
  }, JSON.parse(readFileSync(new URL('./fixtures/workbench-registration.expected.json', import.meta.url), 'utf8')));
  assert.equal(typeof types[0].guide[0].icon, 'function');
  assert.ok(registrations.some(x => x.spec.name === 'sidebar.right.pane.tab' && x.spec.key === types[0].id));
  const title = registrations.find(x => x.spec.name === 'sidebar.right.pane.tab.title' && x.spec.key === types[0].id);
  assert.ok(title);
  const restoredTab = { tab: { title: 'Git' } };
  assert.equal(title.component({ useTabInfo: () => restoredTab, t: key => dictionaries.zh[key] }), '开发工作台');
  assert.equal(title.component({ useTabInfo: () => restoredTab, t: key => dictionaries.en[key] }), 'Development workbench');
  assert.ok(!registrations.some(x => x.spec.name === 'sidebar.panellist'));
  for (const cleanup of cleanups.reverse()) cleanup?.();
  assert.equal(types.length, 0);
});

test('a right-side Git tab follows its own session instead of a different foreground session', () => {
  let plugin, Panel;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useId: () => 'test-tools',
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
  assert.equal(nodes(tree).find(x => x.type === 'button' && x.children.includes('review.button.task')).props.disabled, true);
});
