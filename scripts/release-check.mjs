/** Validate release provenance before building or granting a publisher write access. */
import { readFile, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkReleaseTag } from './repository-checks.mjs';
const exec = promisify(execFile);
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
checkReleaseTag('v' + version, version);
const publishing = ['push', 'release'].includes(process.env.GITHUB_EVENT_NAME);
if (publishing) {
  if (process.env.GITHUB_REF_TYPE !== 'tag') throw new Error('release publishing requires a version tag');
  checkReleaseTag(process.env.GITHUB_REF_NAME, version);
  await exec('git', ['fetch', '--no-tags', 'origin', 'main']);
  await exec('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
  const { stdout: head } = await exec('git', ['rev-parse', 'HEAD']);
  const { stdout: tag } = await exec('git', ['rev-parse', 'refs/tags/' + process.env.GITHUB_REF_NAME + '^{commit}']);
  if (head !== tag) throw new Error('tag does not identify the checked-out commit');
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'version=' + version + '\n');
console.log('Release version validated: ' + version + (publishing ? ' (tag on main history)' : ' (build-only rehearsal)'));
