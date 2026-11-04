import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationScrollOptions } from '../source-editor.js';

const box = { left: 0, right: 800, top: 100, bottom: 500, height: 400 };
const at = (top, bottom, left = 100, right = 200) => ({ top, bottom, left, right });

test('navigation keeps a comfortably visible target without moving the viewport', () => {
  assert.deepEqual(navigationScrollOptions(box, at(320, 342)), null);
  assert.deepEqual(navigationScrollOptions(box, at(180, 202)), null);
});

test('navigation centers a target that would sit flush against a vertical edge', () => {
  // The reported defect: a definition or file opens with its line on the last pixel row
  // of the panel, so the code below it is hidden until the user scrolls again.
  assert.deepEqual(navigationScrollOptions(box, at(480, 502)), { y: 'center' });
  assert.deepEqual(navigationScrollOptions(box, at(78, 100)), { y: 'center' });
  assert.deepEqual(navigationScrollOptions(box, at(900, 922)), { y: 'center' });
  assert.deepEqual(navigationScrollOptions(box, at(-40, -18)), { y: 'center' });
});

test('navigation centers a target the editor has not measured yet', () => {
  assert.deepEqual(navigationScrollOptions(box, null), { y: 'center' });
  assert.deepEqual(navigationScrollOptions({ ...box, height: 0 }, at(320, 342)), { y: 'center' });
});

test('navigation pulls a horizontally clipped target back without moving the page', () => {
  assert.deepEqual(navigationScrollOptions(box, at(320, 342, 760, 880)), { y: 'nearest', x: 'nearest' });
  assert.deepEqual(navigationScrollOptions(box, at(320, 342, -60, 40)), { y: 'nearest', x: 'nearest' });
});

test('navigation margins shrink with short viewports instead of pushing every line', () => {
  const short = { left: 0, right: 800, top: 0, bottom: 56, height: 56 };
  assert.deepEqual(navigationScrollOptions(short, at(20, 42)), null);
  assert.deepEqual(navigationScrollOptions(short, at(40, 62)), { y: 'center' });
});
