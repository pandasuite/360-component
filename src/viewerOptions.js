// Map PandaSuite properties to the Photo-Sphere-Viewer navigation/view options.
// Pure (no PSV/DOM deps) so the default-coalescing — the error-prone part — is
// unit-tested in isolation. Every default equals PSV's own default, so a project
// that sets none of these behaves exactly as before.
//
// All nine are live-applicable via viewer.setOptions (none are READONLY_OPTIONS),
// so the result is spread into the initial config AND re-applied in applyOptions.
const num = (v, def) => (v == null ? def : Number(v));

export function viewerOptions(p = {}) {
  // PSV's fovToZoomLevel divides by (maxFov - minFov), so equal or inverted bounds
  // would yield NaN/negative zoom. Normalise to an ordered pair with a ≥1° gap —
  // this also quietly fixes a min/max typo rather than breaking zoom.
  let minFov = num(p.minFov, 30);
  let maxFov = num(p.maxFov, 90);
  if (minFov > maxFov) { [minFov, maxFov] = [maxFov, minFov]; }
  if (minFov === maxFov) { maxFov = minFov + 1; }

  return {
    // Booleans whose PSV default is true: only off when explicitly false.
    mousemove: p.mousemove !== false,
    mousewheel: p.mousewheel !== false,
    // Booleans whose PSV default is false.
    touchmoveTwoFingers: !!p.touchmoveTwoFingers,
    fisheye: !!p.fisheye,
    // Numbers (== null keeps an explicit 0, e.g. zero inertia, from the default).
    moveSpeed: num(p.moveSpeed, 1),
    zoomSpeed: num(p.zoomSpeed, 1),
    moveInertia: num(p.moveInertia, 0.8),
    minFov,
    maxFov,
  };
}
