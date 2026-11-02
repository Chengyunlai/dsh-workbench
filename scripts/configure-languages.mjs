/** Configure already installed language servers without changing the shell, JDK, or editor settings. */
import { parseArgs } from 'node:util';
import { access, mkdir, readdir, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join } from 'node:path';
import { Config, installedServers } from '../language-config.js';

const { values } = parseArgs({ options: {
  gopls: { type: 'string' }, 'java-home': { type: 'string' }, 'jdtls-home': { type: 'string' },
} });
const servers = installedServers();
if (values.gopls) {
  const command = await realpath(resolve(values.gopls)); await access(command, constants.X_OK);
  servers.go = { command, args: [], env: {}, settings: {}, initializationOptions: {}, waitForJavaReady: false };
}
if (Boolean(values['java-home']) !== Boolean(values['jdtls-home'])) throw new Error('--java-home and --jdtls-home must be supplied together');
if (values['java-home']) {
  const home = await realpath(resolve(values['jdtls-home'])), javaHome = await realpath(resolve(values['java-home']));
  const command = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'); await access(command, constants.X_OK);
  const launchers = (await readdir(join(home, 'plugins'))).filter(name => /^org\.eclipse\.equinox\.launcher_[\w.-]+\.jar$/.test(name));
  if (launchers.length !== 1) throw new Error('JDT LS must contain exactly one Equinox launcher jar');
  const platform = { darwin: 'mac', linux: 'linux', win32: 'win' }[process.platform];
  if (!platform) throw new Error('unsupported JDT LS platform');
  const names = await readdir(home);
  const arm = `config_${platform}_arm`;
  const configuration = process.arch === 'arm64' && names.includes(arm) ? arm : `config_${platform}`;
  await access(join(home, configuration));
  servers.java = { command, args: [
    '-Declipse.application=org.eclipse.jdt.ls.core.id1', '-Dosgi.bundles.defaultStartLevel=4',
    '-Declipse.product=org.eclipse.jdt.ls.core.product', '-Dlog.level=ERROR', '-Xmx1G',
    '-Djava.import.generatesMetadataFilesAtProjectRoot=false',
    '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED', '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
    '-jar', join(home, 'plugins', launchers[0]), '-configuration', join(home, configuration),
  ], env: { JAVA_HOME: javaHome },
  settings: { java: { autobuild: { enabled: false }, import: { generatesMetadataFilesAtProjectRoot: false }, configuration: { updateBuildConfiguration: 'disabled' } } },
  initializationOptions: {}, waitForJavaReady: true };
}
const validated = Config({ languageServers: servers }).languageServers;
const directory = new URL('../.tools/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('servers.json', directory), JSON.stringify(validated, null, 2) + '\n');
console.log(`Configured: ${[...Object.keys(validated), 'python (bundled)', 'javascript/typescript (bundled)'].join(', ')}. Reload the Git plugin.`);
