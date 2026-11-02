import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { apply } from '../../index.js';
const exec = promisify(execFile);

export async function fixture(t, lsp, options = {}) {
  const base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'git-browser-')));
  const root = join(base, 'repo'); await fs.mkdir(root);
  await fs.mkdir(join(root, 'src'));
  await fs.writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', baseUrl: '.', paths: { '@shapes': ['src/shapes.ts'] } }, include: ['src/**/*'] }));
  await fs.writeFile(join(root, 'src/shapes.ts'), 'export interface Shape { size: number }\nexport function render(s: Shape) { return s.size; }\n');
  await fs.writeFile(join(root, 'src/main.ts'), "import { render as draw, type Shape } from '@shapes';\nconst shape: Shape = { size: 2 };\nconst emoji = '😀'; draw(shape);\nfunction local() { const draw = () => 42; return draw(); }\n");
  await fs.writeFile(join(root, '.gitignore'), 'ignored.txt\n');
  await fs.writeFile(join(root, 'ignored.txt'), 'ignore me');
  await exec('git', ['init', '-q', root]);
  await exec('git', ['add', '.'], { cwd: root });
  await fs.writeFile(join(root, 'new.js'), 'function hello() {}\nhello();\n');
  const routes = new Map(), cleanups = [];
  const ctx = {
    get: name => name === 'lsp' ? lsp : undefined,
    effect: acquire => { cleanups.push(acquire()); },
    workspaceRegistry: { list: async () => [{ path: root, id: 'repo' }, { path: join(root, 'src'), id: 'sub' }] },
    fs: {
      resolve: async (path, options = {}) => { const absolute = isAbsolute(path) ? path : join(options.cwd, path); return { displayPath: absolute, targetKey: await fs.realpath(absolute).catch(error => { if (error.code === 'ENOENT') return absolute; throw error; }) }; },
      processPath: target => target.targetKey,
      processPathFromHostPath: path => path,
      fileUrl: target => pathToFileURL(target.targetKey).href,
      contains: (parent, child) => { const path = relative(parent.targetKey, child.targetKey); return path === '' || (path !== '..' && !path.startsWith('../') && !isAbsolute(path)); },
      stat: async target => { try { const stat = await fs.stat(target.targetKey); return { type: stat.isFile() ? 'file' : 'directory', size: stat.size }; } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } },
      readBytes: async (target, signal, max) => { signal?.throwIfAborted(); const bytes = await fs.readFile(target.targetKey); if (bytes.length > max) throw new Error('too large'); return bytes; },
    },
    subprocess: {
      resolveExecutable: async command => command,
      spawn: spec => {
        const env = { ...process.env }; for (const [key, value] of Object.entries(spec.env)) { if (value === undefined) delete env[key]; else env[key] = value; }
        const child = spawn(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env, signal: spec.signal, detached: process.platform !== 'win32' });
        let stdout = '', stderr = '';
        if (spec.stdio.stdout !== 'pipe') child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-65536); });
        const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', exitCode => resolve({ exitCode })); });
        return { done, stdin: child.stdin, stdout: child.stdout, collected: { stdout: { readFrom: () => ({ text: stdout, lossy: false }) }, stderr: { readFrom: () => ({ text: stderr, lossy: false }) } }, terminate: () => { if (child.exitCode !== null || child.signalCode !== null) return; try { if (process.platform === 'win32') child.kill(); else if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }, waitForExit: () => done.catch(() => {}) };
      },
    },
    connection: { fetch: { register: route => routes.set(route.path, route.fetch) } },
  };
  apply(ctx, { useInstalledServers: false, useInstalledDebugAdapters: false, ...options });
  t.after(async () => { for (const cleanup of cleanups) await cleanup?.(); await fs.rm(base, { recursive: true, force: true }); });
  const call = async (name, params = {}, options) => {
    const response = await routes.get('/api/git.' + name)(new Request('http://localhost/api/git.' + name + '?' + new URLSearchParams({ cwd: root, ...params }), options));
    return { status: response.status, ...(await response.json()) };
  };
  const definition = async (path, line, name, offset = 0) => {
    const source = await call('source', { path });
    const character = source.text.split('\n')[line].indexOf(name, offset);
    return call('definition', { path, line: String(line), character: String(character), version: source.version });
  };
  return { root, base, ctx, call, definition, routes, dispose: () => Promise.all(cleanups.map(cleanup => cleanup?.())) };
}
