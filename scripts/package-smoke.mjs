/** Build an installable release ZIP and verify npm and ZIP installs outside the checkout. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';
import { checkPackageFiles } from './repository-checks.mjs';
const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'dsh-package-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd) => exec(command, args, { cwd, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
const probe = `import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import vm from 'node:vm';
const host = await import('./index.js'); assert.equal(typeof host.apply, 'function'); assert.ok(host.Config);
for (const file of ['client.terminal.js','icon.svg','cordis.patch.yml','typescript-worker.js','locale/en.json','locale/zh.json']) await access(file);
let definition; vm.runInNewContext(await readFile('client.js','utf8'),{window:{__ModuleLoader__:{load:value=>{definition=value;}}}});
assert.equal(typeof definition.factory,'function'); assert.equal(definition.id, JSON.parse(await readFile('package.json','utf8')).name);
let terminalChunk; vm.runInNewContext(await readFile('client.terminal.js','utf8'),{window:{__ModuleLoader__:{load:value=>{terminalChunk=value;}}}});
assert.equal(terminalChunk.id,definition.id); assert.equal(terminalChunk.chunk,'client.terminal.js'); assert.equal(typeof terminalChunk.factory,'function');
const project = await mkdtemp(join(tmpdir(), 'dsh-installed-navigation-'));
let worker;
try {
  const file = join(project, 'main.ts'), text = ['export function answer() { return 42; }', 'answer();', ''].join(String.fromCharCode(10));
  await writeFile(file, text);
  worker = new Worker(pathToFileURL(join(process.cwd(), 'typescript-worker.js')), { execArgv: [], workerData: { root: project, file, text, line: 1, character: 1 } });
  const exited = new Promise(resolve => worker.once('exit', resolve));
  const [result] = await once(worker, 'message');
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.ok(result.locations.some(item => item.range.start.line === 0));
  assert.equal(await exited, 0);
} finally { if (worker) await worker.terminate(); await rm(project, { recursive: true, force: true }); }
console.log('Installed Host exports, client module, runtime resources and compiler worker passed.');`;
try {
  const { stdout } = await run(npm, ['pack', '--json', '--pack-destination', scratch], root);
  const [packed] = JSON.parse(stdout); checkPackageFiles(packed.files.map(file => file.path));
  const install = join(scratch, 'consumer'); await mkdir(install);
  await writeFile(join(install, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', join(scratch, packed.filename)], install);
  const installed = join(install, 'node_modules', '@yunlai', 'dsh-workbench');
  await run(process.execPath, ['--input-type=module', '--eval', probe], installed);
  const unpacked = join(scratch, 'unpacked'); await mkdir(unpacked);
  await run('tar', ['-xzf', join(scratch, packed.filename), '-C', unpacked], scratch);
  const payload = join(unpacked, 'package');
  await cp(join(root, 'package-lock.json'), join(payload, 'package-lock.json'));
  const pkg = JSON.parse(await readFile(join(payload, 'package.json'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/);
  const archiveFiles = {};
  for (const file of [...packed.files.map(file => file.path), 'package-lock.json']) archiveFiles[`dsh-workbench-${pkg.version}/${file}`] = new Uint8Array(await readFile(join(payload, file)));
  await writeFile(join(payload, 'INSTALL.txt'), 'Run npm ci --omit=dev in this directory, then install the directory using the Harness plugin manager. See README.md / README.en.md.\n');
  archiveFiles[`dsh-workbench-${pkg.version}/INSTALL.txt`] = new Uint8Array(await readFile(join(payload, 'INSTALL.txt')));
  const zipBytes = zipSync(archiveFiles, { level: 9 });
  const extracted = join(scratch, 'zip');
  for (const [file, bytes] of Object.entries(unzipSync(zipBytes))) {
    const target = join(extracted, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
  const releaseDirectory = join(extracted, 'dsh-workbench-' + pkg.version);
  // Install the extracted release archive, including its shipped lockfile.
  await run(npm, ['ci', '--omit=dev', '--no-audit', '--no-fund'], releaseDirectory);
  await run(process.execPath, ['--input-type=module', '--eval', probe], releaseDirectory);
  assert.ok(!(await readdir(join(releaseDirectory, 'node_modules'))).includes('fflate'), 'development dependencies leaked into runtime installation');
  const dist = resolve(root, 'dist'); await mkdir(dist, { recursive: true });
  const zipName = `dsh-workbench-${pkg.version}.zip`, tgzName = `dsh-workbench-${pkg.version}.tgz`;
  await writeFile(join(dist, zipName), zipBytes);
  await cp(join(scratch, packed.filename), join(dist, tgzName));
  const sums = await Promise.all([zipName, tgzName].map(async file => createHash('sha256').update(await readFile(join(dist, file))).digest('hex') + '  ' + file));
  await writeFile(join(dist, 'SHA256SUMS'), sums.join('\n') + '\n');
  console.log('Package smoke passed: npm install, release npm ci, client registration and runtime resources.');
  console.log('Release assets: ' + [zipName, tgzName, 'SHA256SUMS'].join(', '));
} finally { await rm(scratch, { recursive: true, force: true }); }
