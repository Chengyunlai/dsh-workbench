import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { highlightSourceLines } from '../source-editor.js';

test('source-line highlighting preserves multiline tokens and literal markup across diff rows', () => {
  const source = 'description = """hello\nclass is plain text\n</span><img src=x>"""\nclass Message:\n    pass';
  const lines = highlightSourceLines(source, 'src/message.py');
  const dom = new JSDOM();
  for (const [index, html] of lines.entries()) {
    const row = dom.window.document.createElement('div'); row.innerHTML = html;
    assert.equal(row.textContent, source.split('\n')[index]);
    assert.equal(row.querySelector('img'), null);
    if (index === 1) { assert.equal(row.querySelector('.jb-syntax-string').textContent, 'class is plain text'); assert.equal(row.querySelector('.jb-syntax-keyword'), null); }
    if (index === 3) assert.equal(row.querySelector('.jb-syntax-keyword').textContent, 'class');
  }
  assert.deepEqual(highlightSourceLines('<value> & unknown', 'README.txt'), ['&lt;value&gt; &amp; unknown']);
  dom.window.close();
});

for (const [path, text, token] of [
  ['src/main.py', 'class Model:\n    pass', 'class'],
  ['src/main.go', 'package main\nfunc main() {}', 'package'],
  ['src/Main.java', 'public class Main {}', 'public'],
  ['src/main.js', 'const message = "hello";', 'const'],
  ['src/main.ts', 'interface Message { content: string }', 'interface'],
]) test(`diff highlighting uses the existing syntax grammar for ${path}`, () => {
  assert.ok(highlightSourceLines(text, path).join('\n').includes('class="jb-syntax-keyword">' + token + '</span>'));
});
