import test from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { apply } from '../index.js';

const WORKSPACE = '/demo';

/** A virtual filesystem covering the five `ctx.fs` methods the card routes use. */
function fakeFs(tree) {
  const entries = new Map([[WORKSPACE, { type: 'directory' }]]);
  for (const [path, entry] of Object.entries(tree)) entries.set(`${WORKSPACE}/${path}`, entry);
  const sizeOf = (entry) => entry.size ?? Buffer.byteLength(entry.content ?? '', 'utf8');
  const target = (path) => ({ displayPath: path, targetKey: path });
  return {
    resolve: async (path, options = {}) => target(posix.resolve(options.cwd ?? WORKSPACE, path)),
    contains: (parent, child) => {
      const path = posix.relative(parent.targetKey, child.targetKey);
      return path === '' || (path !== '..' && !path.startsWith('../') && !posix.isAbsolute(path));
    },
    stat: async (entry) => {
      const item = entries.get(entry.targetKey);
      if (item === undefined) return undefined;
      return { version: 'v1', type: item.type, ...(item.type === 'file' ? { size: sizeOf(item) } : {}) };
    },
    listDir: async (directory) => {
      const item = entries.get(directory.targetKey);
      if (!item || item.type !== 'directory') throw Object.assign(new Error('not a directory'), { code: 'FS_NOT_FOUND' });
      const prefix = `${directory.targetKey}/`;
      const children = [];
      for (const [path, entry] of entries) {
        if (!path.startsWith(prefix)) continue;
        const name = path.slice(prefix.length);
        if (name === '' || name.includes('/')) continue;
        children.push({ name, type: entry.type, target: target(path), ...(entry.type === 'file' ? { size: sizeOf(entry) } : { version: 'v1' }) });
      }
      return children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    },
    readText: async (entry) => {
      const item = entries.get(entry.targetKey);
      if (!item || item.type !== 'file') throw Object.assign(new Error('not a file'), { code: 'FS_NOT_FOUND' });
      return item.content;
    },
  };
}

function harness({ accepted = true, promptError = null, tree = {}, cardsDir } = {}) {
  const routes = new Map();
  const creates = [], prompts = [];
  apply({
    effect: () => {},
    workspaceRegistry: { list: async () => [{ id: 'workspace-demo', path: WORKSPACE }] },
    sessionController: {
      create: async (request) => { creates.push(request); return { sessionId: request.sessionId }; },
      prompt: async (request) => { prompts.push(request); if (promptError) throw promptError; return { accepted }; },
    },
    fs: fakeFs(tree),
    connection: { fetch: { register: (route) => routes.set(route.path, route.fetch) } },
  }, cardsDir === undefined ? {} : { cardsDir });
  const dispatchRaw = async (body) => routes.get('/api/git.dispatch')(new Request('http://localhost/api/git.dispatch', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  }));
  return {
    creates,
    prompts,
    routes,
    dispatch: (body) => dispatchRaw(JSON.stringify(body)),
    dispatchRaw,
    cards: (params = {}) => routes.get('/api/git.cards')(new Request('http://localhost/api/git.cards?' + new URLSearchParams({ cwd: WORKSPACE, ...params }))),
    card: (params = {}) => routes.get('/api/git.card')(new Request('http://localhost/api/git.card?' + new URLSearchParams({ cwd: WORKSPACE, ...params }))),
  };
}

const CARD_TREE = {
  '.dsh': { type: 'directory' },
  '.dsh/cards': { type: 'directory' },
  '.dsh/cards/zeta-inline.md': {
    type: 'file',
    content: [
      '---',
      'title: React Effect Cleanup',
      'tags: [react, effect]',
      'kind: concept',
      'source: src/App.tsx',
      '---',
      '',
      '## 一句话',
      'Returning a cleanup function runs on unmount.',
      '',
      '## 直觉',
      'more',
    ].join('\n'),
  },
  '.dsh/cards/nested': { type: 'directory' },
  '.dsh/cards/nested/alpha-block.md': {
    type: 'file',
    content: ['---', 'title: "Block Tags"', 'tags:', '  - css', '  - layout', '---', '# Fallback ignored', '', 'Block tag card summary.'].join('\n'),
  },
  '.dsh/cards/heading-only.md': { type: 'file', content: '# Heading Title\n\nFirst body line as summary.\n' },
  '.dsh/cards/notes.txt': { type: 'file', content: 'not a card' },
};

test('task dispatch creates a distinct workspace conversation with a server-composed message', async () => {
  const h = harness();
  const first = await h.dispatch({
    cwd: WORKSPACE,
    intent: 'task',
    text: 'Fix the null check',
    code: ['- const name = null;', '+ const name = user.name;'],
    target: { tag: 'git.diff', path: 'src/main.ts' },
  });
  assert.equal(first.status, 200);
  const created = await first.json();
  assert.equal(created.ok, true);
  assert.equal(created.created, true);

  const second = await h.dispatch({ cwd: WORKSPACE, intent: 'task', text: 'Explain this file' });
  assert.equal(second.status, 200);
  assert.equal(h.creates.length, 2);
  assert.notEqual(h.creates[0].sessionId, h.creates[1].sessionId);
  assert.equal(h.creates[0].workspaceId, 'workspace-demo');
  assert.equal(h.creates[0].sessionId, created.sessionId);
  assert.equal(h.prompts[0].sessionId, h.creates[0].sessionId);
  assert.equal(h.prompts[0].mode, 'queue');
  assert.equal(h.prompts[0].content.length, 1);
  assert.equal(h.prompts[0].content[0].type, 'text');
  assert.equal(
    h.prompts[0].content[0].text,
    'Fix the null check\n\n```diff\n- const name = null;\n+ const name = user.name;\n```\n\n---\n任务来源：工作台 · git.diff · src/main.ts',
  );
  assert.equal(h.prompts[1].content[0].text, 'Explain this file');
});

test('explain dispatch assigns one card path per conversation in the configured directory', async () => {
  const h = harness();
  const result = await (await h.dispatch({
    cwd: WORKSPACE,
    intent: 'explain',
    text: 'Why does the cleanup run twice in development?',
    target: { tag: 'source', path: 'src/use.ts' },
  })).json();
  assert.equal(result.ok, true);
  const text = h.prompts[0].content[0].text;
  assert.ok(text.startsWith('我想弄懂下面的内容。'));
  assert.ok(text.includes('Why does the cleanup run twice in development?'));
  assert.ok(text.includes('来源：工作台 · source · src/use.ts'));
  assert.ok(text.includes('讲解要求：'));
  assert.deepEqual(text.match(/`[^`]+\.md`/g), [`\`.dsh/cards/src/use-${result.sessionId.slice('session-'.length)}.md\``]);
  assert.ok(text.includes('kind: concept'));
  assert.ok(text.includes('同一例子'));
  assert.ok(text.includes('/src/main.py'));

  const localized = harness({ cardsDir: 'notes/cards' });
  const second = await (await localized.dispatch({ cwd: WORKSPACE, intent: 'explain', text: 'Explain streams', locale: 'en' })).json();
  const english = localized.prompts[0].content[0].text;
  assert.ok(english.includes('Explanation requirements:'));
  assert.notEqual(second.sessionId, result.sessionId);
  assert.deepEqual(english.match(/`[^`]+\.md`/g), [`\`notes/cards/general/Explain-streams-${second.sessionId.slice('session-'.length)}.md\``]);
  assert.ok(english.includes('same example'));
  assert.ok(english.includes('Answer in English.'));
  assert.ok(english.includes('workspace-root path'));
});

test('invalid dispatch payloads are rejected before any conversation is created', async () => {
  const h = harness();
  const bodies = [
    { cwd: WORKSPACE, intent: 'chat', text: 'x' },
    { cwd: WORKSPACE, intent: 'task', text: '   ' },
    { cwd: WORKSPACE, intent: 'task', text: 'a'.repeat(8193) },
    { cwd: WORKSPACE, intent: 'task', text: 'x', code: 'not-an-array' },
    { cwd: WORKSPACE, intent: 'task', text: 'x', code: ['ok', 42] },
    { cwd: WORKSPACE, intent: 'task', text: 'x', code: ['x'.repeat(65537)] },
    { cwd: WORKSPACE, intent: 'task', text: 'x', target: 'src/main.ts' },
    { cwd: WORKSPACE, intent: 'task', text: 'x', target: { tag: 'a', path: 'b'.repeat(401) } },
    { cwd: WORKSPACE, intent: 'task', text: 'x', target: { tag: 'a\nb', path: 'c' } },
    { cwd: '/other', intent: 'task', text: 'x' },
  ];
  for (const body of bodies) assert.ok((await h.dispatch(body)).status >= 400, JSON.stringify(body));
  assert.equal((await h.dispatchRaw('{oops')).status, 400);
  assert.equal(h.creates.length, 0);
});

test('rejected admission returns the created conversation for recovery', async () => {
  const h = harness({ accepted: false });
  const result = await (await h.dispatch({ cwd: WORKSPACE, intent: 'task', text: 'review' })).json();
  assert.equal(result.ok, false);
  assert.equal(result.created, true);
  assert.equal(result.sessionId, h.creates[0].sessionId);
});

test('prompt rejection reports the durable created conversation with phase prompt', async () => {
  const h = harness({ promptError: new Error('admission failed') });
  const response = await h.dispatch({ cwd: WORKSPACE, intent: 'explain', text: 'review' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.created, true);
  assert.equal(result.phase, 'prompt');
  assert.equal(result.sessionId, h.creates[0].sessionId);
});

test('card listing walks nested directories and parses frontmatter metadata', async () => {
  const h = harness({ tree: CARD_TREE });
  const response = await h.cards();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.equal(result.exists, true);
  assert.equal(result.cardsDir, '.dsh/cards');
  assert.equal(result.skipped, 0);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.cards.map((card) => card.path), [
    '.dsh/cards/heading-only.md',
    '.dsh/cards/nested/alpha-block.md',
    '.dsh/cards/zeta-inline.md',
  ]);
  const [heading, block, inline] = result.cards;
  assert.equal(heading.title, 'Heading Title');
  assert.deepEqual(heading.tags, []);
  assert.equal(heading.summary, 'First body line as summary.');
  assert.equal(heading.group, undefined);
  assert.equal(block.title, 'Block Tags');
  assert.equal(block.group, 'nested');
  assert.deepEqual(block.tags, ['css', 'layout']);
  assert.equal(block.summary, 'Block tag card summary.');
  assert.equal('kind' in block, false);
  assert.equal('source' in block, false);
  assert.equal(inline.title, 'React Effect Cleanup');
  assert.deepEqual(inline.tags, ['react', 'effect']);
  assert.equal(inline.kind, 'concept');
  assert.equal(inline.source, 'src/App.tsx');
  assert.equal(inline.group, 'src');
  assert.equal(inline.summary, 'Returning a cleanup function runs on unmount.');
});

test('missing cards directory is reported as not existing', async () => {
  const h = harness();
  const result = await (await h.cards()).json();
  assert.deepEqual(result, { ok: true, cardsDir: '.dsh/cards', exists: false, cards: [] });
});

test('oversized cards are skipped in listings and rejected on detail', async () => {
  const h = harness({
    tree: {
      '.dsh': { type: 'directory' },
      '.dsh/cards': { type: 'directory' },
      '.dsh/cards/huge.md': { type: 'file', content: 'x'.repeat(256 * 1024 + 1) },
    },
  });
  const list = await (await h.cards()).json();
  assert.equal(list.exists, true);
  assert.deepEqual(list.cards, []);
  assert.equal(list.skipped, 1);
  const response = await h.card({ path: '.dsh/cards/huge.md' });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'CARD_TOO_LARGE');
});

test('card listing is capped and reports truncation', async () => {
  const tree = { '.dsh': { type: 'directory' }, '.dsh/cards': { type: 'directory' } };
  for (let index = 0; index < 305; index++) tree[`.dsh/cards/card-${String(index).padStart(3, '0')}.md`] = { type: 'file', content: `# Card ${index}` };
  const result = await (await harness({ tree }).cards()).json();
  assert.equal(result.cards.length, 300);
  assert.equal(result.truncated, true);
});

test('card detail returns metadata and a frontmatter-stripped body', async () => {
  const h = harness({ tree: CARD_TREE });
  const response = await h.card({ path: '.dsh/cards/zeta-inline.md' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    path: '.dsh/cards/zeta-inline.md',
    title: 'React Effect Cleanup',
    tags: ['react', 'effect'],
    kind: 'concept',
    source: 'src/App.tsx',
    body: '## 一句话\nReturning a cleanup function runs on unmount.\n\n## 直觉\nmore',
  });
});

test('card reads stay inside the card directory and the registered workspace', async () => {
  const h = harness({ tree: { ...CARD_TREE, 'README.md': { type: 'file', content: '# Workspace readme' } } });
  const outside = await h.card({ path: 'README.md' });
  assert.equal(outside.status, 403);
  assert.equal((await outside.json()).code, 'CARD_OUTSIDE_CARDS_DIR');

  const missing = await h.card({ path: '.dsh/cards/missing.md' });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, 'CARD_NOT_FOUND');

  assert.equal((await h.card({ path: '.dsh/cards/nested' })).status, 404);
  assert.equal((await h.cards({ cwd: '/other' })).status, 403);
  assert.equal((await h.card({ cwd: '/other', path: '.dsh/cards/zeta-inline.md' })).status, 403);

  const guarded = harness({ tree: CARD_TREE, cardsDir: '../outside' });
  const escaped = await guarded.cards();
  assert.equal(escaped.status, 403);
  assert.equal((await escaped.json()).code, 'CARDS_OUTSIDE_WORKSPACE');
  assert.equal((await guarded.card({ path: '.dsh/cards/zeta-inline.md' })).status, 403);
});
