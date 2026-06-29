const DEFAULT_ENTER_RATIO = 0.72;
const DEFAULT_EXIT_RATIO = 0.55;

const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function fovBounds(options = {}) {
  let minFov = toNumber(options.minFov, 30);
  let maxFov = toNumber(options.maxFov, 90);
  if (minFov > maxFov) {
    [minFov, maxFov] = [maxFov, minFov];
  }
  if (minFov === maxFov) {
    maxFov = minFov + 1;
  }
  return { minFov, maxFov };
}

export function zoomLevelToFov(level, options = {}) {
  const { minFov, maxFov } = fovBounds(options);
  const zoom = clamp(toNumber(level, 50), 0, 100);
  return maxFov + (zoom / 100) * (minFov - maxFov);
}

export function horizontalFov(verticalFov, aspect = 1) {
  const safeAspect = Math.max(toNumber(aspect, 1), 0.01);
  const radians = (verticalFov * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(radians / 2) * safeAspect) * 180) / Math.PI;
}

export function shortestArcDeg(from, to) {
  return ((to - from + 540) % 360) - 180;
}

function centeredOverlap(delta, currentSpan, targetSpan) {
  if (currentSpan <= 0 || targetSpan <= 0) {
    return 0;
  }
  const currentMin = -currentSpan / 2;
  const currentMax = currentSpan / 2;
  const targetMin = delta - targetSpan / 2;
  const targetMax = delta + targetSpan / 2;
  return Math.max(0, Math.min(currentMax, targetMax) - Math.max(currentMin, targetMin));
}

function overlapScore(delta, currentSpan, targetSpan) {
  const overlap = centeredOverlap(delta, currentSpan, targetSpan);
  return Math.min(overlap / currentSpan, overlap / targetSpan);
}

function fovFrame(view, options = {}) {
  const zoom = toNumber(view.zoom, 50);
  const vFov = zoomLevelToFov(zoom, options);
  return {
    yaw: toNumber(view.yaw, 0),
    pitch: toNumber(view.pitch, 0),
    hFov: horizontalFov(vFov, options.aspect),
    vFov,
  };
}

export function viewpointScore(viewpoint, current, options = {}) {
  if (!viewpoint || viewpoint.type !== 'viewpoint' || viewpoint.id == null || !current) {
    return 0;
  }

  const currentFrame = fovFrame(current, options);
  const targetFrame = fovFrame(
    {
      yaw: viewpoint.yaw,
      pitch: viewpoint.pitch,
      zoom: viewpoint.zoom == null ? current.zoom : viewpoint.zoom,
    },
    options,
  );

  const yawDelta = shortestArcDeg(currentFrame.yaw, targetFrame.yaw);
  const pitchDelta = targetFrame.pitch - currentFrame.pitch;
  return Math.min(
    overlapScore(yawDelta, currentFrame.hFov, targetFrame.hFov),
    overlapScore(pitchDelta, currentFrame.vFov, targetFrame.vFov),
  );
}

function bestViewpoint(viewpoints, current, options, ratio) {
  let best = null;
  let bestScore = -1;

  (viewpoints || []).forEach((viewpoint) => {
    const score = viewpointScore(viewpoint, current, options);
    if (score >= ratio && score > bestScore) {
      best = viewpoint;
      bestScore = score;
    }
  });

  return best;
}

export function detectViewpoint(viewpoints, current, state = {}, options = {}) {
  const activeId = state && state.activeId != null ? String(state.activeId) : null;
  const enterRatio = toNumber(options.enterRatio, DEFAULT_ENTER_RATIO);
  const exitRatio = toNumber(options.exitRatio, DEFAULT_EXIT_RATIO);

  if (activeId) {
    const active = (viewpoints || []).find((m) => String(m.id) === activeId);
    if (active && viewpointScore(active, current, options) >= exitRatio) {
      return { activeId, triggerId: null };
    }
  }

  const match = bestViewpoint(viewpoints, current, options, enterRatio);
  if (match) {
    const id = String(match.id);
    return { activeId: id, triggerId: id };
  }

  return { activeId: null, triggerId: null };
}
