import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './support/host.mjs';
import { installedDebugAdapters } from '../language-config.js';

const python = process.env.DSH_HOVER_PYTHON ?? installedDebugAdapters().python?.command;

test('real debugpy inspects local/member values in the selected frame and rejects a previous pause', { timeout: 90000, skip: !python && 'Configure Python with setup:debuggers or DSH_HOVER_PYTHON' }, async t => {
  const h = await fixture(t, null, { debugAdapters: { python: { command: python, args: ['-m', 'debugpy.adapter'] } } });
  await writeFile(join(h.root, 'hover.py'), 'from argparse import Namespace\ndef child():\n    path = "child.json"\n    args = Namespace(config="demo.json")\n    print(path)\ndef main():\n    path = "caller.json"\n    child()\nmain()\n');
  const action = async body => {
    const response = await h.routes.get('/api/git.debug.action')(new Request('http://localhost/api/git.debug.action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cwd: h.root, ...body }) }));
    return { status: response.status, ...await response.json() };
  };
  const paused = async id => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const result = await h.call('debug.status', { id });
      if (result.state === 'paused' && result.frames.length) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Python did not pause');
  };
  const started = await action({ action: 'start', currentFile: 'hover.py', breakpoints: { 'hover.py': [5] } });
  assert.equal(started.status, 200, JSON.stringify(started));
  const stop = await paused(started.id);
  const inspect = (expression, frame = stop.frames[0]) => action({ action: 'inspect', id: stop.id, pauseId: stop.pauseId, frameId: frame.id, expression });
  assert.equal((await inspect('path')).variable.value, "'child.json'");
  assert.equal((await inspect('args.config')).variable.value, "'demo.json'");
  assert.ok((await inspect('args')).variable.variablesReference > 0);
  assert.equal((await inspect('path', stop.frames.find(frame => frame.name === 'main'))).variable.value, "'caller.json'");
  await action({ action: 'next', id: stop.id });
  const stale = await inspect('path');
  assert.equal(stale.status, 409, JSON.stringify(stale));
  assert.equal(stale.code, 'DEBUG_INSPECTION_STALE');
  await action({ action: 'stop', id: stop.id });
});
