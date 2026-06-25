// Responsive sizing for image hotspot markers. Dependency-free on purpose so it
// can be unit-tested under `node:test` without a browser.

// Mirror of the `sizes` declared on the `image` hotspot param in
// public/pandasuite.json: the studio builds an `<N>w` srcset for each entry, and
// resolveImagePath looks them up by that exact key. Keep the two lists in sync.
export const IMG_SIZES = [128, 256, 512];

// Smallest declared width >= the displayed width * devicePixelRatio, clamped to
// the largest when the target exceeds every breakpoint. Returns the srcset key
// (e.g. "256w") to pass to PandaBridge.resolveImagePath.
export function pickImageSize(widthPx, dpr, sizes = IMG_SIZES) {
  const target = widthPx * (dpr || 1);
  const match = sizes.find((s) => s >= target);
  return `${match ?? sizes[sizes.length - 1]}w`;
}

// Size an image marker by its width, deriving the height from the image's natural
// aspect ratio. Falls back to a square when the natural width/height is unknown.
export function imageMarkerSize(widthPx, naturalW, naturalH) {
  const w = Number(widthPx) || 0;
  if (!naturalW || !naturalH) {
    return { width: w, height: w };
  }
  return { width: w, height: Math.round((w * naturalH) / naturalW) };
}
