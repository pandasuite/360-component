import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerOptions } from './viewerOptions.js';

test('empty properties yield PSV defaults (current behavior preserved)', () => {
  assert.deepEqual(viewerOptions({}), {
    mousemove: true,
    moveSpeed: 1,
    moveInertia: 0.8,
    touchmoveTwoFingers: false,
    mousewheel: true,
    zoomSpeed: 1,
    minFov: 30,
    maxFov: 90,
    fisheye: false,
  });
});

test('undefined argument is treated as empty', () => {
  assert.equal(viewerOptions().mousemove, true);
  assert.equal(viewerOptions().moveSpeed, 1);
});

test('booleans defaulting to true are only false when explicitly false', () => {
  assert.equal(viewerOptions({ mousemove: false }).mousemove, false);
  assert.equal(viewerOptions({ mousewheel: false }).mousewheel, false);
  // any non-false (incl. undefined) stays true
  assert.equal(viewerOptions({ mousemove: undefined }).mousemove, true);
});

test('booleans defaulting to false coerce truthy/falsy', () => {
  assert.equal(viewerOptions({ touchmoveTwoFingers: true }).touchmoveTwoFingers, true);
  assert.equal(viewerOptions({ fisheye: true }).fisheye, true);
  assert.equal(viewerOptions({ touchmoveTwoFingers: false }).touchmoveTwoFingers, false);
});

test('numeric options are coerced from their values', () => {
  const o = viewerOptions({
    moveSpeed: 2, zoomSpeed: 0.5, moveInertia: 0.3, minFov: 20, maxFov: 100,
  });
  assert.equal(o.moveSpeed, 2);
  assert.equal(o.zoomSpeed, 0.5);
  assert.equal(o.moveInertia, 0.3);
  assert.equal(o.minFov, 20);
  assert.equal(o.maxFov, 100);
});

test('explicit 0 is kept, not replaced by the default', () => {
  // 0 inertia = stop immediately; must not fall back to 0.8
  assert.equal(viewerOptions({ moveInertia: 0 }).moveInertia, 0);
});

test('equal FOV bounds are separated by 1° (PSV divides by maxFov - minFov)', () => {
  const o = viewerOptions({ minFov: 60, maxFov: 60 });
  assert.equal(o.minFov, 60);
  assert.equal(o.maxFov, 61);
});

test('inverted FOV bounds are swapped into order', () => {
  const o = viewerOptions({ minFov: 90, maxFov: 30 });
  assert.equal(o.minFov, 30);
  assert.equal(o.maxFov, 90);
});

test('valid FOV bounds pass through unchanged', () => {
  const o = viewerOptions({ minFov: 45, maxFov: 85 });
  assert.equal(o.minFov, 45);
  assert.equal(o.maxFov, 85);
});
