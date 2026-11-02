/** Repository checks shared by local verification and read-only pull-request CI. */
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, relative, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { marked } from 'marked';
import { parse } from 'yaml';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

/** Compare translated keys, nonempty text, and interpolation parameters.
 * @param dictionaries - English and Chinese dictionaries belonging to one owner.
 */
export function checkLocales(dictionaries) {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.zh).sort(), 'locale keys differ');
  for (const key of Object.keys(dictionaries.en)) {
    const values = ['en', 'zh'].map(language => dictionaries[language][key]);
    assert.ok(values.every(value => typeof value === 'string' && value.trim()), 'empty locale value: ' + key);
    assert.deepEqual(...values.map(value => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort()), 'locale parameters differ: ' + key);
  }
}

/** Validate an npm payload before installation or release staging.
 * @param files - File names reported by npm pack.
 */
export function checkPackageFiles(files) {
  for (const path of files) {
    assert.ok(!path.split('/').some(part => ['.tools', 'node_modules', '.git', 'test', 'screenshots'].includes(part)), 'private or development file in package: ' + path);
    assert.ok(!/(^|\/)\.env(?:\.|$)|\.log$|\.gif$/.test(path), 'private or media file in package: ' + path);
  }
  for (const path of ['package.json', 'LICENSE', 'index.js', 'client.js', 'typescript-worker.js', 'debug-dap.js', 'debug-service.js', 'debug-targets.js', 'navigation.js', 'language-config.js', 'language-servers.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json', 'README.md', 'README.en.md', 'USAGE.md', 'USAGE.en.md', 'DEBUGGING.md', 'DEBUGGING.en.md', 'CONTRIBUTING.md', 'CONTRIBUTING.en.md', 'SECURITY.md', 'SECURITY.en.md', 'AUTOMATION.md', 'AUTOMATION.en.md', 'scripts/configure-languages.mjs', 'scripts/configure-debuggers.mjs']) assert.ok(files.includes(path), 'missing package resource: ' + path);
}

/** Check a release tag against the package's declared version.
 * @param tag - Full version tag, including its v prefix.
 * @param version - package.json version.
 */
export function checkReleaseTag(tag, version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/);
  assert.equal(version.trim(), version, 'release version must not contain surrounding whitespace');
  assert.equal(tag, 'v' + version, 'release tag must match package.json');
}

/** Resolve only repository-local Markdown links; external links are checked by their owners.
 * @param document - Repository-relative Markdown filename.
 * @param text - Markdown document contents.
 * @param directory - Repository root.
 */
export async function checkDocumentLinks(document, text, directory = root) {
  const walk = async value => {
    if (!value || typeof value !== 'object') return;
    if (['link', 'image'].includes(value.type) && typeof value.href === 'string') {
      const href = value.href;
      if (href && !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href)) {
        const target = resolve(directory, document, '..', decodeURIComponent(href.split('#')[0]));
        assert.ok(!relative(directory, target).split(/[\\/]/).includes('..'), 'link outside repository: ' + href);
        await access(target).catch(error => { throw new Error(document + ': missing link target ' + href, { cause: error }); });
      }
    }
    for (const child of Object.values(value)) if (typeof child === 'object') {
      if (Array.isArray(child)) { for (const item of child) await walk(item); }
      else await walk(child);
    }
  };
  await walk(marked.lexer(text));
}

/** Validate tracked source syntax, translations, Markdown, and automation metadata.
 * @returns Number of checked files.
 */
export async function checkRepository() {
  const { stdout } = await exec('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root });
  const files = [...new Set(stdout.trim().split('\n').filter(Boolean))];
  for (const file of files) {
    if (['.js', '.mjs'].includes(extname(file))) await exec(process.execPath, ['--check', resolve(root, file)]);
    if (file.endsWith('.md')) await checkDocumentLinks(file, await readFile(resolve(root, file), 'utf8'));
    if (file.endsWith('.json')) JSON.parse(await readFile(resolve(root, file), 'utf8'));
    if (/^\.github\/.*\.ya?ml$/.test(file)) parse(await readFile(resolve(root, file), 'utf8'), { uniqueKeys: true });
  }
  for (const name of ['README', 'USAGE', 'DEBUGGING', 'CONTRIBUTING', 'SECURITY', 'AUTOMATION']) {
    const [zh, en] = await Promise.all([name + '.md', name + '.en.md'].map(file => readFile(resolve(root, file), 'utf8').then(text => text.split('\n'))));
    assert.equal(zh.length, en.length, name + ': bilingual line count differs');
    assert.deepEqual(zh.map(line => Boolean(line.trim())), en.map(line => Boolean(line.trim())), name + ': bilingual paragraph breaks differ');
  }
  checkLocales(Object.fromEntries(await Promise.all(['en', 'zh'].map(async language => [language, JSON.parse(await readFile(resolve(root, 'locale', language + '.json'), 'utf8')).meta]))));
  let plugin, dictionaries;
  vm.runInNewContext(await readFile(resolve(root, 'client.js'), 'utf8'), { window: { __ModuleLoader__: { load: spec => { plugin = spec.factory(() => ({ createElement: () => null })); } } } });
  plugin.apply({ effect: callback => callback(), locale: { register: (namespace, value) => { dictionaries = value; }, bind: () => key => key }, uiWorkspace: {}, sidebarRightTabs: { register: () => {} }, slots: { inject: (name, callback) => callback(), register: () => {} } });
  checkLocales(dictionaries);
  console.log('Repository checks passed: ' + files.length + ' files, locale parity, document links, and paired paragraphs.');
  return files.length;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await checkRepository();
