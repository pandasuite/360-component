import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectViewpoint } from './viewpointDetector.js';

const options = { minFov: 30, maxFov: 90, aspect: 16 / 9 };

test('detectViewpoint triggers a matching viewpoint on first evaluation', () => {
  const result = detectViewpoint(
    [{ id: 'view-1', type: 'viewpoint', yaw: 12, pitch: -3, zoom: 40 }],
    { yaw: 12, pitch: -3, zoom: 40 },
    { activeId: null },
    options,
  );

  assert.deepEqual(result, { activeId: 'view-1', triggerId: 'view-1' });
});

test('detectViewpoint does not retrigger while the same viewpoint remains active', () => {
  const result = detectViewpoint(
    [{ id: 'view-1', type: 'viewpoint', yaw: 12, pitch: -3, zoom: 40 }],
    { yaw: 12, pitch: -3, zoom: 40 },
    { activeId: 'view-1' },
    options,
  );

  assert.deepEqual(result, { activeId: 'view-1', triggerId: null });
});

test('detectViewpoint requires the zoom framing to be close', () => {
  const result = detectViewpoint(
    [{ id: 'view-1', type: 'viewpoint', yaw: 0, pitch: 0, zoom: 100 }],
    { yaw: 0, pitch: 0, zoom: 0 },
    { activeId: null },
    options,
  );

  assert.deepEqual(result, { activeId: null, triggerId: null });
});

test('detectViewpoint applies zoom framing when marker zoom is serialized', () => {
  const result = detectViewpoint(
    [{ id: 'view-1', type: 'viewpoint', yaw: 0, pitch: 0, zoom: '100' }],
    { yaw: 0, pitch: 0, zoom: 0 },
    { activeId: null },
    options,
  );

  assert.deepEqual(result, { activeId: null, triggerId: null });
});

test('detectViewpoint adapts horizontal tolerance to the component aspect ratio', () => {
  const viewpoints = [{ id: 'view-1', type: 'viewpoint', yaw: 25, pitch: 0, zoom: 50 }];
  const current = { yaw: 0, pitch: 0, zoom: 50 };

  assert.deepEqual(
    detectViewpoint(viewpoints, current, { activeId: null }, { ...options, aspect: 1 }),
    { activeId: null, triggerId: null },
  );
  assert.deepEqual(
    detectViewpoint(viewpoints, current, { activeId: null }, { ...options, aspect: 2 }),
    { activeId: 'view-1', triggerId: 'view-1' },
  );
});

test('detectViewpoint handles yaw wrap around the panorama seam', () => {
  const result = detectViewpoint(
    [{ id: 'view-1', type: 'viewpoint', yaw: -179, pitch: 0, zoom: 50 }],
    { yaw: 179, pitch: 0, zoom: 50 },
    { activeId: null },
    options,
  );

  assert.deepEqual(result, { activeId: 'view-1', triggerId: 'view-1' });
});

test('detectViewpoint picks the best matching viewpoint only', () => {
  const result = detectViewpoint(
    [
      { id: 'near', type: 'viewpoint', yaw: 8, pitch: 0, zoom: 50 },
      { id: 'exact', type: 'viewpoint', yaw: 0, pitch: 0, zoom: 50 },
    ],
    { yaw: 0, pitch: 0, zoom: 50 },
    { activeId: null },
    options,
  );

  assert.deepEqual(result, { activeId: 'exact', triggerId: 'exact' });
});

test('detectViewpoint clears the active viewpoint after leaving its exit threshold', () => {
  const result = detectViewpoint(
    [{ id: 'view-1', type: 'viewpoint', yaw: 0, pitch: 0, zoom: 50 }],
    { yaw: 150, pitch: 0, zoom: 50 },
    { activeId: 'view-1' },
    options,
  );

  assert.deepEqual(result, { activeId: null, triggerId: null });
});

test('detectViewpoint treats viewpoints without zoom as position-only markers', () => {
  const result = detectViewpoint(
    [{ id: 'view-1', type: 'viewpoint', yaw: 0, pitch: 0 }],
    { yaw: 0, pitch: 0, zoom: 0 },
    { activeId: null },
    options,
  );

  assert.deepEqual(result, { activeId: 'view-1', triggerId: 'view-1' });
});
