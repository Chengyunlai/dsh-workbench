/** Install the pinned interoperability toolchain into the ignored .tools/ci directory. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.JAVA_HOME, 'Set JAVA_HOME to a Java 21 JDK before setup:ci-tools');
const tools = join(root, '.tools', 'ci'); await mkdir(join(tools, 'bin'), { recursive: true });
const run = async (command, args, env = {}) => { console.log('Preparing ' + command + ' ' + args.join(' ')); await exec(command, args, { cwd: root, env: { ...process.env, ...env }, timeout: 300000, maxBuffer: 8 * 1024 * 1024 }); };
const download = async (url, sha256, name) => {
  const file = join(tools, name); let bytes;
  try { bytes = await readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Download failed: ' + response.status + ' ' + url);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'), sha256, 'tool download checksum mismatch: ' + name);
  await writeFile(file, bytes); return file;
};
await run(process.env.DSH_CI_PYTHON ?? 'python3', ['-m', 'venv', join(tools, 'python')]);
const python = join(tools, 'python', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'debugpy==1.8.22']);
await run(process.env.DSH_DEBUG_GO ?? 'go', ['install', 'golang.org/x/tools/gopls@v0.20.0'], { GOBIN: join(tools, 'bin') });
await run(process.env.DSH_DEBUG_GO ?? 'go', ['install', 'github.com/go-delve/delve/cmd/dlv@v1.25.2'], { GOBIN: join(tools, 'bin') });
const jdt = await download('https://download.eclipse.org/jdtls/milestones/1.50.0/jdt-language-server-1.50.0-202509041425.tar.gz', '3292c5c33888f95ab0ff718e777ee94ff5496b8635a23a8844b876ee090ebdea', 'jdtls.tar.gz');
await mkdir(join(tools, 'jdtls'), { recursive: true });
await run('tar', ['-xzf', jdt, '-C', join(tools, 'jdtls')]);
const js = await download('https://github.com/microsoft/vscode-js-debug/releases/download/v1.140.0/js-debug-dap-v1.140.0.tar.gz', '27dab92937ec1ab35821ae955aac867544fe06a1b6307229049f2d789af10968', 'js-debug.tar.gz');
await run('tar', ['-xzf', js, '-C', tools]);
await writeFile(join(tools, 'js-debug', 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }) + '\n');
const server = join(tools, 'js-debug', 'src', 'dapDebugServer.js'); await access(server);
const suffix = process.platform === 'win32' ? '.exe' : '';
await run(process.execPath, ['scripts/configure-languages.mjs', '--gopls', join(tools, 'bin', 'gopls' + suffix), '--java-home', resolve(process.env.JAVA_HOME), '--jdtls-home', join(tools, 'jdtls')]);
await run(process.execPath, ['scripts/configure-debuggers.mjs', '--python', python, '--dlv', join(tools, 'bin', 'dlv' + suffix), '--js-debug', server]);
console.log('Pinned CI language servers and debug adapters are configured.');
