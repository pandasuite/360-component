import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMG_SIZES, pickImageSize, imageMarkerSize } from './responsive.js';

test('pickImageSize picks the smallest breakpoint >= width * dpr', () => {
  assert.equal(pickImageSize(32, 1, [128, 256, 512]), '128w'); // 32 -> 128
  assert.equal(pickImageSize(128, 1, [128, 256, 512]), '128w'); // exact 128
  assert.equal(pickImageSize(128, 2, [128, 256, 512]), '256w'); // 256 -> 256
  assert.equal(pickImageSize(100, 3, [128, 256, 512]), '512w'); // 300 -> 512
});

test('pickImageSize clamps to the largest breakpoint when target exceeds all', () => {
  assert.equal(pickImageSize(512, 3, [128, 256, 512]), '512w'); // 1536 -> 512
});

test('pickImageSize defaults dpr to 1 when falsy', () => {
  assert.equal(pickImageSize(200, 0, [128, 256, 512]), '256w'); // 200 -> 256
});

test('pickImageSize uses IMG_SIZES by default', () => {
  assert.equal(pickImageSize(32, 1), `${IMG_SIZES[0]}w`);
});

test('imageMarkerSize derives height from the natural aspect ratio', () => {
  assert.deepEqual(imageMarkerSize(100, 200, 100), { width: 100, height: 50 });
  assert.deepEqual(imageMarkerSize(64, 100, 300), { width: 64, height: 192 });
});

test('imageMarkerSize rounds the height to an integer', () => {
  assert.deepEqual(imageMarkerSize(100, 300, 100), { width: 100, height: 33 });
});

test('imageMarkerSize falls back to a square when natural dims are unknown', () => {
  assert.deepEqual(imageMarkerSize(48, 0, 0), { width: 48, height: 48 });
});
