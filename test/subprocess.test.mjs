import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fixture } from './support/host.mjs';

for (const descendant of [false, true]) {
  test(`fixture termination kills a SIGTERM-resistant ${descendant ? 'descendant retaining output pipes' : 'language server'}`, { skip: process.platform === 'win32' && 'POSIX signal and process-group behavior', timeout: 10000 }, async t => {
    const h = await fixture(t);
    const stubborn = "process.on('SIGTERM',()=>{}); process.stdout.write(String(process.pid)); setInterval(()=>{},1000);";
    const code = descendant
      ? `import {spawn} from 'node:child_process'; spawn(process.execPath,['-e',${JSON.stringify(stubborn)}],{stdio:'inherit'});`
      : stubborn;
    const handle = h.ctx.subprocess.spawn({ argv: [process.execPath, '--input-type=module', '-e', code], cwd: h.root, env: {}, graceMs: 50, stdio: { stdout: 'pipe' } });
    const [chunk] = await once(handle.stdout, 'data', { signal: t.signal });
    const pid = Number(String(chunk));
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    let timer;
    try {
      handle.terminate(); handle.terminate();
      await Promise.race([handle.waitForExit(), new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('fixture did not escalate termination')), 3000); })]);
      assert.equal(handle.stdout.closed, true, 'exit includes inherited pipe closure');
      if (!descendant) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    } finally {
      clearTimeout(timer);
      // The negative control must also release a child when escalation is removed.
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await handle.waitForExit();
    }
  });
}
