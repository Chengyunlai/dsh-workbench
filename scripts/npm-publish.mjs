/** Publish a verified release tarball, admitting an existing version only when its bytes match exactly. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Publish after successful release checks; registry failures never masquerade as missing versions.
 * @param version - Validated package version from the release job.
 * @param directory - Directory containing the checked release assets.
 * @param run - npm invocation, injectable for registry and publication failures.
 * @returns Whether this invocation published or verified an identical existing version.
 */
export async function publishArtifact(version, directory, run = promisify(execFile)) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(version ?? '')) throw new Error('invalid release version');
  const file = resolve(directory, `dsh-workbench-${version}.tgz`);
  const integrity = 'sha512-' + createHash('sha512').update(await readFile(file)).digest('base64');
  let existing;
  try {
    const result = await run('npm', ['view', `@yunlai/dsh-workbench@${version}`, 'dist.integrity', '--json', '--registry=https://registry.npmjs.org'], { timeout: 120000 });
    existing = JSON.parse(result.stdout);
  } catch (error) {
    let response;
    try { response = JSON.parse(error.stdout ?? '{}'); }
    catch (parseError) { throw error; }
    if (response.error?.code !== 'E404') throw error;
  }
  if (existing !== undefined) {
    if (existing !== integrity) throw new Error('npm version exists with different package bytes; publish a new version');
    return 'already-published';
  }
  await run('npm', ['publish', file, '--access=public', '--tag=' + (version.includes('-') ? 'beta' : 'latest'), '--registry=https://registry.npmjs.org', '--provenance'], { timeout: 120000 });
  return 'published';
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(await publishArtifact(process.env.VERSION, resolve('assets')));
}
