/** Configure local debug adapters without changing global Python, Go, Node, or editor settings. */
import { parseArgs } from 'node:util';
import { realpath, access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { Config, installedDebugAdapters } from '../language-config.js';
const { values } = parseArgs({ options: { python: { type: 'string' }, dlv: { type: 'string' }, 'js-debug': { type: 'string' } } });
const adapters = installedDebugAdapters();
for (const [key, language, args, transport] of [['python', 'python', ['-m', 'debugpy.adapter'], 'stdio'], ['dlv', 'go', ['dap', '--listen=127.0.0.1:0'], 'tcp']]) {
  if (!values[key]) continue;
  const command = resolve(values[key]); await realpath(command); await access(command, constants.X_OK);
  adapters[language] = { command, args, env: {}, transport };
}
if (values['js-debug']) {
  const server = await realpath(resolve(values['js-debug'])); await access(server);
  adapters.javascript = { command: process.execPath, args: [server, '0', '127.0.0.1'], env: {}, transport: 'tcp' };
}
const validated = Config({ debugAdapters: adapters }).debugAdapters;
await mkdir(new URL('../.tools/', import.meta.url), { recursive: true });
await writeFile(new URL('../.tools/debug-adapters.json', import.meta.url), JSON.stringify(validated, null, 2) + '\n');
console.log('Configured debug adapters: ' + Object.keys(validated).join(', ') + '. Reload the Git plugin.');
