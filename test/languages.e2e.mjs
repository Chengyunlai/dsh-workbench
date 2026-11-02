import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readdir, stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fixture } from './support/host.mjs';
import { installedServers } from '../language-config.js';

async function snapshotFiles(root) {
  const files = {}, directories = [];
  for (const path of await readdir(root, { recursive: true })) {
    if ((await stat(join(root, path))).isDirectory()) directories.push(path);
    else files[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
  }
  return { files, directories };
}

test('real gopls resolves functions and types across Go files', { timeout: 120000 }, async t => {
  const config = installedServers();
  if (!config.go) throw new Error('configure gopls before running test:languages');
  const h = await fixture(t, null, { languageServers: { go: config.go } });
  await writeFile(join(h.root, 'go.mod'), 'module example.com/navigation\n\ngo 1.24\n');
  await writeFile(join(h.root, 'shapes.go'), 'package sample\ntype Shape struct { Size int }\nfunc Render(s Shape) int { return s.Size }\n');
  await writeFile(join(h.root, 'main.go'), 'package sample\nvar shape Shape\nvar value = Render(shape)\n');
  let result = await h.definition('main.go', 2, 'Render');
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.engine, 'go');
  assert.deepEqual(result.targets, [{ path: 'shapes.go', line: 2, character: 5 }]);
  result = await h.definition('main.go', 1, 'Shape');
  assert.deepEqual(result.targets, [{ path: 'shapes.go', line: 1, character: 5 }]);
});

test('real JDT LS resolves Java methods and classes across source files', { timeout: 180000 }, async t => {
  const config = installedServers();
  if (!config.java) throw new Error('configure JDT LS and Java 21+ before running test:languages');
  const h = await fixture(t, null, { languageServers: { java: config.java }, navigationTimeoutMs: 150000 });
  const source = join(h.root, 'src', 'main', 'java', 'demo'); await mkdir(source, { recursive: true });
  await writeFile(join(h.root, 'pom.xml'), '<project><modelVersion>4.0.0</modelVersion><groupId>example</groupId><artifactId>navigation</artifactId><version>1</version><properties><maven.compiler.release>21</maven.compiler.release></properties></project>');
  await writeFile(join(source, 'Shape.java'), 'package demo;\npublic class Shape {\n  public static int render(Shape s) { return 2; }\n}\n');
  await writeFile(join(source, 'Main.java'), 'package demo;\nclass Main {\n  Shape shape = new Shape();\n  int value = Shape.render(shape);\n}\n');
  const before = await snapshotFiles(h.root);
  let result = await h.definition('src/main/java/demo/Main.java', 3, 'render');
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.engine, 'java');
  assert.deepEqual(result.targets, [{ path: 'src/main/java/demo/Shape.java', line: 2, character: 20 }]);
  result = await h.definition('src/main/java/demo/Main.java', 2, 'Shape');
  assert.deepEqual(result.targets, [{ path: 'src/main/java/demo/Shape.java', line: 1, character: 13 }]);
  await h.dispose();
  const after = await snapshotFiles(h.root);
  assert.deepEqual(after.files, before.files, 'Java import must not alter source/Git files or create Eclipse metadata');
  // Maven import creates empty output directories even with automatic compilation disabled.
  assert.ok(after.directories.filter(path => !before.directories.includes(path)).every(path => ['target', 'target/classes', 'target/test-classes'].includes(path)));
});
