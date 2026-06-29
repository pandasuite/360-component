import PandaBridge from 'pandasuite-bridge';
import { Viewer } from '@photo-sphere-viewer/core';
import { EquirectangularVideoAdapter } from '@photo-sphere-viewer/equirectangular-video-adapter';
import { VideoPlugin } from '@photo-sphere-viewer/video-plugin';
import { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin';
import { AutorotatePlugin } from '@photo-sphere-viewer/autorotate-plugin';
import { StereoPlugin } from '@photo-sphere-viewer/stereo-plugin';
import { MarkersPlugin } from '@photo-sphere-viewer/markers-plugin';
import { IMG_SIZES, pickImageSize, imageMarkerSize } from './responsive.js';
import { viewerOptions } from './viewerOptions.js';
import { detectViewpoint } from './viewpointDetector.js';

import '@photo-sphere-viewer/core/index.css';
import '@photo-sphere-viewer/markers-plugin/index.css';
import '@photo-sphere-viewer/video-plugin/index.css';

/* ------------------------------------------------------------------ state */

let properties = {};
let markers = [];
let viewer = null;
let isVideo = false;
// The adapter type the CURRENT viewer was built with. `isVideo` is the DESIRED
// type (drives resource resolution); they diverge when a type switch is deferred
// because the new resource isn't uploaded yet. The rebuild decision must compare
// against the viewer's actual adapter, not the previous desired value.
let viewerIsVideo = false;
let videoEl = null;
let viewpoints = [];
let currentUrl = null;
let pressed = false;
let gyroPending = false;
let addingHotspot = false;
let hintEl = null;
let selectedViewpointId = null;
let markersGen = 0;
let viewerReady = false;
let activeViewpointId = null;
let viewpointDetectionFrame = null;
// Last autorotate speed pushed to the plugin; a running autorotate keeps the roll
// speed captured at start(), so we only restart it when this value changes.
let appliedAutoRotateSpeed = null;
// True only while takeCameraControl() is stopping the gyro for a programmatic move,
// so the gyroscope listener can tell that from a user turning the gyro off (which
// should resume autorotate). gyro.stop() dispatches the event synchronously.
let yieldingToMove = false;
// Properties last applied to the live viewer. applyOptions re-asserts the
// navbar-toggleable options (mute, gyro, auto-rotation) only when their value
// changed here, so an unrelated update (e.g. a bound marker label firing onUpdate)
// can't revert a toggle the user made from the on-screen control bar.
let appliedProps = {};

/* ----------------------------------------------------------------- helpers */

const rad2deg = (r) => (r * 180) / Math.PI;
const normDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
const round = (n) => Math.round(n * 100) / 100;
const shortestArc = (from, to) => ((to - from + 540) % 360) - 180;
// PSV renders string tooltips as HTML (innerHTML), and `label` is bindable to
// external data — escape it so a label is shown as text, never executed.
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
// Escape a value for a single-quoted CSS url() inside a double-quoted style attribute
// — `image` is bindable to external data, like the tooltip label. CSS hex escapes
// neutralise the quote/backslash/newline that could break out of the url() token.
const cssUrl = (u) => String(u).replace(/[\\'"\r\n]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
const isFrench = () => (PandaBridge.currentLanguage || '').toLowerCase().startsWith('fr');

function resolvePanorama() {
  return isVideo
    ? PandaBridge.resolvePath('video.mp4')
    : PandaBridge.resolveImagePath('image.jpg', 'original');
}

// PSV accepts an HTMLVideoElement as source, which lets us own loop/muted.
function ensureVideoEl(url) {
  if (!videoEl) {
    videoEl = document.createElement('video');
    videoEl.crossOrigin = 'anonymous';
    videoEl.playsInline = true;
    videoEl.setAttribute('webkit-playsinline', 'webkit-playsinline');
  }
  videoEl.loop = !!properties.isLoop;
  videoEl.muted = !!properties.isMuted;
  if (videoEl.getAttribute('src') !== url) {
    videoEl.src = url;
  }
  return videoEl;
}

function navbarButtons() {
  const nav = ['zoom', 'move'];
  // Gate on the LIVE adapter, not the desired type: when the type is switched to
  // video before video.mp4 is available, the viewer is still image-only (no
  // VideoPlugin). Adding video buttons then constructs e.g. videoVolume against a
  // missing plugin, which can throw on teardown. viewerIsVideo flips only once the
  // video viewer is actually built.
  if (viewerIsVideo) {
    nav.push('videoPlay', 'videoTime', 'videoVolume');
  }
  if (properties.isAutoRotate) {
    nav.push('autorotate');
  }
  if (properties.isGyro) {
    nav.push('gyroscope');
  }
  if (properties.isVR) {
    nav.push('stereo');
  }
  nav.push('fullscreen');
  return nav;
}

// The navbar buttons to show, or false for no bar. VR is a standalone toggle whose
// only entry point is its `stereo` button, so surface that button on its own even
// when the full control bar is hidden — otherwise enabling VR alone does nothing.
function buildNavbar() {
  if (properties.showControls) {
    return navbarButtons();
  }
  if (properties.isVR) {
    return ['stereo'];
  }
  return false;
}

// All plugins are registered up-front (except Video, which is tied to the video
// adapter) so that property changes can be applied in place — never by
// destroying and rebuilding the viewer, which would re-trigger the loader.
function buildPlugins() {
  const plugins = [
    MarkersPlugin.withConfig({ gotoMarkerSpeed: '4rpm' }),
    GyroscopePlugin,
    // autostartDelay:null disables PSV's automatic on-load/on-idle rotation
    // (it keys off a non-null delay); we start it explicitly in applyOptions,
    // only when isAutoRotate is enabled.
    AutorotatePlugin.withConfig({ autostartDelay: null, autostartOnIdle: false }),
    StereoPlugin,
  ];
  if (isVideo) {
    // Always create the overlays; VideoPlugin only builds them in its constructor,
    // so gating on showControls would freeze them until a rebuild. We toggle their
    // visibility in place via the `ps-hide-controls` class (see applyOptions),
    // mirroring how the navbar is shown/hidden.
    plugins.push(
      VideoPlugin.withConfig({
        progressbar: true,
        bigbutton: true,
      }),
    );
  }
  return plugins;
}

/* ----------------------------------------------------------------- markers */

// Two kinds of markers, distinguished by `marker.type` (set by how they are
// created, never typed by hand — exactly like the 3D component):
//   - 'hotspot'   : a clickable colored dot on the sphere (created by clicking
//                   in the Studio overlay below).
//   - 'viewpoint' : a saved camera position {yaw,pitch,zoom} (created by the
//                   Studio's native "+", which captures the current view via
//                   getSnapshotData). Not rendered; used for navigation/sync.
// A `Border` marker param (value { solid: { weight, color, alpha } }, color as a
// number) → a CSS border string. Absent value falls back to a 2px white ring.
function borderCss(border) {
  const solid = (border && border.solid) || { weight: 2, color: 0xffffff, alpha: 1 };
  const weight = Number(solid.weight) || 0;
  if (weight <= 0) {
    return 'none';
  }
  const c = Number(solid.color) || 0;
  const a = solid.alpha == null ? 1 : Number(solid.alpha);
  return `${weight}px solid rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${c & 255}, ${a})`;
}

// Fields shared by every hotspot marker, image or dot.
function baseConfig(m) {
  const config = {
    id: String(m.id),
    position: { yaw: `${m.yaw || 0}deg`, pitch: `${m.pitch || 0}deg` },
    anchor: 'center center',
    // PSV's native hover scale: it grows the marker AND the tooltip's anchor box by
    // the same amount, so the label stays correctly spaced at any marker size. (A CSS
    // :hover transform would grow the marker without PSV knowing, so the tooltip —
    // placed from the unscaled size — gets eaten into, worse the larger the marker.)
    // Uses style.scale, a no-op on the Studio's old Chromium (no visible scale there,
    // but the spacing stays correct); fully works in the published modern viewer.
    hoverScale: { amount: 1.15, duration: 150, easing: 'ease' },
    data: { id: m.id },
  };
  if (m.label) {
    config.tooltip = escapeHtml(String(m.label));
  }
  return config;
}

function dotConfig(m) {
  const size = Number(m.size) || 32;
  const color = m.color || '#FFFFFF';
  return Object.assign(baseConfig(m), {
    html: `<div class="psv-hotspot" style="width:${size}px;height:${size}px;background:${color};border:${borderCss(m.border)};"></div>`,
    size: { width: size, height: size },
  });
}

// Preload the image to learn its natural dimensions: PSV requires an explicit
// size for `image` markers, and the resource entry carries no width/height.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // A stalled request can fire neither onload nor onerror; without this timeout the
    // await in imageConfig would never settle and block setMarkers for ALL markers.
    const timer = setTimeout(reject, 8000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject();
    };
    img.src = url;
  });
}

// Image hotspot: resolve the responsive rendition for the current display width,
// learn its ratio, size by width. Falls back to the dot if the image can't be
// resolved (no srcset) or fails to load, so the marker stays present/clickable.
// Rendered as an `html` marker with an INNER div (background-image), mirroring
// the dot — never a native `image` marker. PSV writes position straight onto the
// outer marker element (and on old Chromium our fallback drives it via `transform`),
// so we keep that element free of CSS transitions to avoid lag; the hover scale is
// PSV's native hoverScale (see baseConfig), not a CSS transform.
async function imageConfig(m) {
  const width = Number(m.size) || 32;
  const sizeKey = pickImageSize(width, window.devicePixelRatio || 1, IMG_SIZES);
  const url = PandaBridge.resolveImagePath(m.image, sizeKey);
  if (!url) {
    return dotConfig(m);
  }
  try {
    const img = await loadImage(url);
    return Object.assign(baseConfig(m), {
      html: `<div class="psv-hotspot-img" style="width:100%;height:100%;background-image:url('${cssUrl(url)}');background-size:contain;background-repeat:no-repeat;background-position:center;"></div>`,
      size: imageMarkerSize(width, img.naturalWidth, img.naturalHeight),
    });
  } catch (e) {
    return dotConfig(m);
  }
}

async function applyMarkers() {
  if (!viewer) {
    return;
  }
  // While VR/stereo is active the StereoPlugin has hidden the markers for the
  // split-screen view; setMarkers would recreate them visible on top of it. Skip —
  // the plugin re-shows markers on exit, and the next update repaints the latest set.
  const stereo = viewer.getPlugin(StereoPlugin);
  if (stereo && stereo.isEnabled()) {
    return;
  }
  const gen = ++markersGen;
  const list = markers || [];
  viewpoints = list.filter((m) => m.type === 'viewpoint');
  if (activeViewpointId && !viewpoints.some((m) => String(m.id) === activeViewpointId)) {
    activeViewpointId = null;
  }
  scheduleViewpointDetection();
  const hotspots = list.filter((m) => m.type === 'hotspot');
  // Image hotspots resolve asynchronously (preload for ratio); dots resolve
  // synchronously. Build them all, then set in one pass.
  const configs = await Promise.all(
    hotspots.map((m) => (m.image ? imageConfig(m) : Promise.resolve(dotConfig(m)))),
  );
  // The viewer may have been destroyed (image<->video rebuild) while awaiting, a
  // newer applyMarkers call may have superseded this one, or the user may have
  // entered VR during the image preload (re-check stereo, since the guard above ran
  // before the await) — bail in any of these cases.
  if (!viewer || gen !== markersGen || (stereo && stereo.isEnabled())) {
    return;
  }
  const plugin = viewer.getPlugin(MarkersPlugin);
  if (plugin) {
    plugin.setMarkers(configs);
  }
}

// The Studio preview runs an old Chromium (~87) that lacks the CSS individual
// transform properties (translate/scale/rotate); PSV v5 positions every marker
// with `element.style.translate`, which that engine silently ignores, leaving
// each hotspot pinned at the container's top-left (its tooltip, positioned
// differently, still looks right). On such engines we mirror PSV's own per-frame
// placement — `marker.state.position2D`, the exact value its tooltip uses — onto
// the widely-supported `transform` shorthand, so the dot stays glued to the
// tooltip and tracks the view as smoothly as PSV does natively.
const NEEDS_TRANSFORM_FALLBACK = !(
  typeof CSS !== 'undefined' && CSS.supports && CSS.supports('translate', '1px')
);

function repositionHotspotsFallback() {
  if (!viewer) {
    return;
  }
  const plugin = viewer.getPlugin(MarkersPlugin);
  if (!plugin || !plugin.markers) {
    return;
  }
  (markers || []).forEach((m) => {
    if (m.type !== 'hotspot') {
      return;
    }
    const el = document.getElementById(`psv-marker-${m.id}`);
    const marker = plugin.markers[String(m.id)];
    const pos = marker && marker.state && marker.state.position2D;
    if (el && pos) {
      el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }
  });
}

// Studio-only: an "add hotspot" button + a "click to place" mode. The next
// click on the sphere yields its spherical position straight from PSV's click
// event, so there is no ray-casting to do.
function setupStudioUI() {
  if (!PandaBridge.isStudio || document.querySelector('.ps-add-btn')) {
    return;
  }
  const btn = document.createElement('button');
  btn.className = 'ps-add-btn';
  btn.textContent = isFrench() ? "Ajouter un point d'intérêt" : 'Add hotspot';
  btn.addEventListener('click', () => {
    addingHotspot = true;
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.className = 'ps-add-hint';
      document.body.appendChild(hintEl);
    }
    hintEl.textContent = isFrench()
      ? "Cliquez sur la vue pour placer le point d'intérêt"
      : 'Click on the view to place the hotspot';
    hintEl.style.display = 'flex';
  });
  document.body.appendChild(btn);
}

function placeHotspot(data) {
  const marker = {
    id: Math.random().toString(36).substr(2, 9),
    type: 'hotspot',
    yaw: round(normDeg(rad2deg(data.yaw))),
    pitch: round(rad2deg(data.pitch)),
    label: isFrench() ? "Point d'intérêt" : 'Hotspot',
  };
  markers.push(marker);
  // A single object (not an array) upserts just this marker in the Studio.
  PandaBridge.send(PandaBridge.UPDATED, { markers: marker });
  applyMarkers();
}

// Re-capture the current view into a viewpoint marker. The id comes from the
// Studio "Update" button (marker.data.id), falling back to the last selected one.
function updateSelectedViewpoint(markerId) {
  const id = markerId || selectedViewpointId;
  if (!viewer || !id) {
    return;
  }
  const pos = viewer.getPosition();
  const yaw = round(normDeg(rad2deg(pos.yaw)));
  const marker = {
    id,
    type: 'viewpoint',
    label: `${isFrench() ? 'Vue' : 'View'} ${Math.round(yaw)}°`,
    yaw,
    pitch: round(rad2deg(pos.pitch)),
    zoom: Math.round(viewer.getZoomLevel()),
  };
  const idx = markers.findIndex((m) => String(m.id) === String(id));
  if (idx >= 0) {
    markers[idx] = Object.assign({}, markers[idx], marker);
  }
  PandaBridge.send(PandaBridge.UPDATED, { markers: marker });
  applyMarkers();
}

function currentViewpointFrame() {
  if (!viewer) {
    return null;
  }
  const pos = viewer.getPosition();
  return {
    yaw: normDeg(rad2deg(pos.yaw)),
    pitch: rad2deg(pos.pitch),
    zoom: viewer.getZoomLevel(),
  };
}

function viewpointDetectionOptions() {
  const size = viewer && viewer.getSize();
  return {
    minFov: viewer && viewer.config && viewer.config.minFov,
    maxFov: viewer && viewer.config && viewer.config.maxFov,
    aspect: size && size.height ? size.width / size.height : 1,
  };
}

function runViewpointDetection() {
  viewpointDetectionFrame = null;
  if (!viewer || !viewerReady || !viewpoints.length) {
    activeViewpointId = null;
    return;
  }
  const stereo = viewer.getPlugin(StereoPlugin);
  if (stereo && stereo.isEnabled()) {
    return;
  }

  const result = detectViewpoint(
    viewpoints,
    currentViewpointFrame(),
    { activeId: activeViewpointId },
    viewpointDetectionOptions(),
  );
  activeViewpointId = result.activeId;
  if (result.triggerId) {
    PandaBridge.send(PandaBridge.TRIGGER_MARKER, result.triggerId);
  }
}

function scheduleViewpointDetection() {
  if (!viewer || viewpointDetectionFrame != null) {
    return;
  }
  const raf = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 0));
  viewpointDetectionFrame = raf(runViewpointDetection);
}

function startGyro() {
  const gyro = viewer && viewer.getPlugin(GyroscopePlugin);
  if (!gyro || gyro.isEnabled() || gyroPending) {
    return;
  }
  const needsPermission = typeof DeviceMotionEvent !== 'undefined'
    && typeof DeviceMotionEvent.requestPermission === 'function';
  if (needsPermission) {
    // iOS 13+ needs a user gesture to grant the motion permission.
    gyroPending = true;
    window.addEventListener('pointerdown', () => {
      gyroPending = false;
      const g = viewer && viewer.getPlugin(GyroscopePlugin);
      if (g && properties.isGyro) {
        g.start().catch(() => {});
      }
    }, { once: true });
  } else {
    gyro.start().catch(() => {});
  }
}

// Autorotate and the gyroscope are mutually exclusive in PSV (both call
// viewer.stopAll() on start and stop on StopAllEvent), and the gyro owns the camera
// while active. Gyro takes precedence: only autorotate when the gyro is NOT enabled.
// Restart on a speed change — a running autorotate keeps the roll speed it captured
// at start(), so setOption alone wouldn't take effect until a toggle off/on.
function applyAutorotate() {
  const auto = viewer && viewer.getPlugin(AutorotatePlugin);
  if (!auto) {
    return;
  }
  const gyro = viewer.getPlugin(GyroscopePlugin);
  if (!properties.isAutoRotate || (gyro && gyro.isEnabled())) {
    auto.stop();
    return;
  }
  const speed = `${properties.autoRotateSpeed || 1}rpm`;
  auto.setOption('autorotateSpeed', speed);
  if (!auto.isEnabled()) {
    auto.start();
  } else if (speed !== appliedAutoRotateSpeed) {
    auto.stop();
    auto.start();
  }
  appliedAutoRotateSpeed = speed;
}

// A programmatic camera move (toMarker / default view / synchronize scrub) takes the
// camera from the gyroscope: while the gyro is active it vetoes BeforeRotate, so
// viewer.rotate()/animate() are silently no-ops. Stop it so the explicit move lands
// (the command wins; the gyro stays off until re-enabled by a property change).
function takeCameraControl() {
  const gyro = viewer && viewer.getPlugin(GyroscopePlugin);
  if (gyro && gyro.isEnabled()) {
    yieldingToMove = true;
    gyro.stop();
    yieldingToMove = false;
  }
  // An instant rotate() sets the position dynamic to STOP, which freezes the
  // autorotate roll while the plugin still reports enabled (so it can't restart
  // itself). Stop it properly; it stays off until the panel re-enables it.
  const auto = viewer && viewer.getPlugin(AutorotatePlugin);
  if (auto && auto.isEnabled()) {
    auto.stop();
  }
}

// Everything that can change without rebuilding the viewer.
function applyOptions() {
  if (!viewer) {
    return;
  }
  // While VR/stereo is active the StereoPlugin has hidden the navbar for the
  // split-screen view; re-showing it here would overlay controls on the VR view.
  // Skip — the plugin restores the navbar on exit, and the next update re-applies.
  const stereo = viewer.getPlugin(StereoPlugin);
  if (stereo && stereo.isEnabled()) {
    return;
  }
  // setOption('navbar', false) is unsafe at runtime in PSV; toggle the bar instead.
  const bar = buildNavbar();
  if (bar) {
    viewer.navbar.setButtons(bar);
    viewer.navbar.show();
  } else {
    viewer.navbar.hide();
  }
  // Video overlays (progress bar, big play button) are created once and can't be
  // reconfigured at runtime, so toggle their visibility via CSS instead.
  const container = document.getElementById('viewer');
  if (container) {
    container.classList.toggle('ps-hide-controls', !properties.showControls);
  }

  // Navigation/view options apply live and aren't navbar-toggleable (no user-toggle
  // to clobber), so re-assert them unconditionally; setOptions is idempotent.
  viewer.setOptions(viewerOptions(properties));

  // Mute, gyroscope and auto-rotation are also toggleable live from the navbar, so
  // re-assert each only when its panel value changed (vs appliedProps) — otherwise an
  // unrelated update would revert the user's live toggle.
  const gyro = viewer.getPlugin(GyroscopePlugin);
  if (gyro && properties.isGyro !== appliedProps.isGyro) {
    if (properties.isGyro) {
      startGyro();
    } else {
      gyro.stop();
    }
  }

  if (properties.isAutoRotate !== appliedProps.isAutoRotate
    || properties.autoRotateSpeed !== appliedProps.autoRotateSpeed) {
    applyAutorotate();
  }

  if (isVideo) {
    const v = viewer.getPlugin(VideoPlugin);
    if (v && properties.isMuted !== appliedProps.isMuted) {
      v.setMute(!!properties.isMuted);
    }
    if (videoEl) {
      videoEl.loop = !!properties.isLoop;
    }
  }

  appliedProps = properties;
}

/* -------------------------------------------------------------- the viewer */

function wireViewer() {
  viewer.getPlugin(MarkersPlugin).addEventListener('select-marker', ({ marker, doubleClick }) => {
    // PSV re-dispatches select-marker on BOTH clicks of a double-tap; fire once.
    if (doubleClick) {
      return;
    }
    PandaBridge.send(PandaBridge.TRIGGER_MARKER, (marker.data && marker.data.id) || marker.id);
  });

  const scheduleDetection = () => scheduleViewpointDetection();
  viewer.addEventListener('position-updated', scheduleDetection);
  viewer.addEventListener('zoom-updated', scheduleDetection);
  viewer.addEventListener('size-updated', scheduleDetection);

  // Keep autorotate in sync with the gyroscope, which toggles asynchronously (after
  // its support/permission check) and from the navbar button. Gyro on → autorotate
  // yields to it; gyro off by the user → autorotate resumes; gyro off because a
  // programmatic move took the camera (yieldingToMove) → leave it to the move.
  const gyro = viewer.getPlugin(GyroscopePlugin);
  if (gyro) {
    gyro.addEventListener('gyroscope-updated', () => {
      if (gyro.isEnabled() || !yieldingToMove) {
        applyAutorotate();
      }
    });
  }

  // applyOptions/applyMarkers bail while stereo is on (they would overlay the navbar
  // and markers on the split-screen view). On exit the plugin re-shows the *old*
  // navbar/markers but fires no update, so any change made during VR would stay stale
  // until an unrelated later update. Re-apply once on exit — both read live globals,
  // so this picks up whatever changed while VR was active.
  const stereo = viewer.getPlugin(StereoPlugin);
  if (stereo) {
    stereo.addEventListener('stereo-updated', ({ stereoEnabled }) => {
      if (!stereoEnabled) {
        applyOptions();
        applyMarkers();
      }
    });
  }

  viewer.addEventListener(
    'ready',
    () => {
      viewerReady = true;
      PandaBridge.send(PandaBridge.INITIALIZED);
      applyOptions();
      scheduleViewpointDetection();
    },
    { once: true },
  );

  // Disambiguate single vs double tap, like the previous Hammer.js behavior.
  let clickTimer = null;
  viewer.addEventListener('click', ({ data }) => {
    if (addingHotspot) {
      addingHotspot = false;
      if (hintEl) {
        hintEl.style.display = 'none';
      }
      placeHotspot(data);
      return;
    }
    const payload = [{ yaw: round(normDeg(rad2deg(data.yaw))), pitch: round(rad2deg(data.pitch)) }];
    clearTimeout(clickTimer);
    // Wait at least PSV's double-click window (CONSTANTS.DBLCLICK_DELAY = 300ms)
    // before emitting singleTap: a second tap dispatches `dblclick` (which cancels
    // this timer) within that window, so a shorter delay would emit BOTH singleTap
    // and doubleTap for one double-tap gesture.
    clickTimer = setTimeout(() => PandaBridge.send('singleTap', payload), 300);
  });
  viewer.addEventListener('dblclick', ({ data }) => {
    clearTimeout(clickTimer);
    PandaBridge.send('doubleTap', [
      { yaw: round(normDeg(rad2deg(data.yaw))), pitch: round(rad2deg(data.pitch)) },
    ]);
  });

  // preserveDrawingBuffer (set on the viewer) lets us read the canvas anytime.
  PandaBridge.unlisten(PandaBridge.GET_SCREENSHOT);
  PandaBridge.getScreenshot((resultCallback) => {
    let dataUrl = null;
    try {
      const canvas = viewer.container.querySelector('canvas');
      dataUrl = canvas ? canvas.toDataURL('image/png') : null;
    } catch (e) {
      dataUrl = null;
    }
    resultCallback(dataUrl);
  });
}

// The marker the host flagged with `__ps_default` (see Panda.task design doc
// 2026-06-18-ps-default-marker-flag): its saved view is the initial camera, so
// PSV's first paint is already framed on it — no jump, no post-load sweep.
// Absent (older hosts that don't send the flag) → PSV uses its engine default.
function defaultViewpoint() {
  return (markers || []).find((m) => m && m.__ps_default) || null;
}

function createViewer(url) {
  currentUrl = url;
  viewerIsVideo = isVideo;
  viewerReady = false;
  activeViewpointId = null;
  // Fresh viewer: forget what was applied so applyOptions re-asserts every option.
  appliedProps = {};
  const config = {
    container: document.getElementById('viewer'),
    adapter: isVideo
      ? EquirectangularVideoAdapter.withConfig({
        autoplay: !!properties.isAutoPlay,
        muted: !!properties.isMuted,
      })
      : undefined,
    panorama: isVideo ? { source: ensureVideoEl(url) } : url,
    navbar: buildNavbar(),
    plugins: buildPlugins(),
    canvasBackground: '#000000',
    loadingTxt: '',
    rendererParameters: { preserveDrawingBuffer: true },
    // Navigation/view options up-front so the first paint respects fisheye/min-maxFov.
    ...viewerOptions(properties),
  };
  // Aim PSV at the default view up-front so the very first rendered frame is
  // correct (PSV applies defaultYaw/Pitch/ZoomLvl during the initial load).
  const def = defaultViewpoint();
  if (def) {
    config.defaultYaw = `${def.yaw || 0}deg`;
    config.defaultPitch = `${def.pitch || 0}deg`;
    if (typeof def.zoom === 'number') {
      config.defaultZoomLvl = def.zoom;
    }
  }
  viewer = new Viewer(config);
  wireViewer();
  // Old-engine fallback: re-place hotspots with `transform` after every render
  // (PSV's `style.translate` is a no-op there). No-op cost on modern engines:
  // the listener is never attached.
  if (NEEDS_TRANSFORM_FALLBACK) {
    viewer.addEventListener('render', repositionHotspotsFallback);
  }
}

function myInit() {
  isVideo = properties.type === 'video';
  const url = resolvePanorama();

  if (!viewer) {
    if (url) {
      createViewer(url);
    }
  } else if (isVideo !== viewerIsVideo) {
    // The desired type differs from the viewer's actual adapter, which PSV cannot
    // change at runtime: rebuild. Compare against `viewerIsVideo` (not the previous
    // desired value) so a type switch deferred for a missing resource still
    // rebuilds once it arrives — otherwise the same-engine path below would feed a
    // source to the wrong adapter. Deferred until `url` exists.
    if (url) {
      viewer.destroy();
      viewer = null;
      // Discard the video element: the new viewer's adapter awaits a
      // `loadedmetadata` event that never re-fires on an already-loaded element
      // reused with the same src (it doesn't check readyState), so reusing it
      // would hang the rebuilt video viewer before `ready`. A fresh element reloads.
      if (videoEl) {
        videoEl.pause();
        videoEl = null;
      }
      createViewer(url);
    } else {
      // Resource not uploaded yet: keep the current viewer but still apply in-place
      // property changes, which would otherwise be dropped until the rebuild.
      applyOptions();
    }
  } else {
    // Same engine: change the source only if the resource actually changed,
    // and apply every other property in place (no loader, no rebuild).
    if (url && url !== currentUrl) {
      currentUrl = url;
      // For video, build a fresh element per source change. PSV's adapter snapshots the
      // previous video's play state from the element it still holds to decide whether to
      // resume the replacement; reusing this element and resetting its `src` first would
      // reset it to paused, silently stopping a playing video. Dropping our reference lets
      // ensureVideoEl create a new element while the adapter keeps and tears down the old.
      if (isVideo && videoEl) {
        videoEl = null;
      }
      viewer.setPanorama(isVideo ? { source: ensureVideoEl(url) } : url, { transition: false });
    }
    applyOptions();
  }
  applyMarkers();
}

function setupTouchEvents() {
  const el = document.getElementById('viewer');
  if (el) {
    el.addEventListener('pointerdown', () => {
      pressed = true;
      PandaBridge.send('touchDown');
    });
  }
  window.addEventListener('pointerup', () => {
    if (pressed) {
      pressed = false;
      PandaBridge.send('touchUp');
    }
  });
}

const getVideo = () => (viewer && viewerIsVideo ? viewer.getPlugin(VideoPlugin) : null);

/* ---------------------------------------------------------------- bridge */

PandaBridge.init(() => {
  PandaBridge.onLoad((pandaData) => {
    properties = pandaData.properties || {};
    markers = pandaData.markers || [];
    const run = () => {
      setupTouchEvents();
      myInit();
      setupStudioUI();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', run, false);
    } else {
      run();
    }
  });

  PandaBridge.onUpdate((pandaData) => {
    properties = pandaData.properties || {};
    markers = pandaData.markers || [];
    myInit();
  });

  PandaBridge.listen('play', () => {
    const v = getVideo();
    if (v) {
      v.play();
    }
  });

  PandaBridge.listen('pause', () => {
    const v = getVideo();
    if (v) {
      v.pause();
    }
  });

  PandaBridge.listen('togglePause', () => {
    const v = getVideo();
    if (v) {
      v.playPause();
    }
  });

  PandaBridge.listen('stop', () => {
    const v = getVideo();
    if (v) {
      v.pause();
      v.setProgress(0);
    }
  });

  // Triggered by the in-panel "Set to current view" editorControl button
  // (if the Studio wires editorControl for marker params).
  PandaBridge.listen('updateViewpoint', (args) => {
    updateSelectedViewpoint(Array.isArray(args) ? args[0] : args);
  });

  // The Studio's native "+" calls this to capture the current view as a
  // viewpoint marker.
  PandaBridge.getSnapshotData(() => {
    if (!viewer) {
      return null;
    }
    const pos = viewer.getPosition();
    const yaw = round(normDeg(rad2deg(pos.yaw)));
    return {
      type: 'viewpoint',
      label: `${isFrench() ? 'Vue' : 'View'} ${Math.round(yaw)}°`,
      yaw,
      pitch: round(rad2deg(pos.pitch)),
      zoom: Math.round(viewer.getZoomLevel()),
    };
  });

  // Selecting a marker (or the `toMarker` action) brings the camera to it. The
  // default view is applied instantly and refreshes the Studio thumbnail.
  PandaBridge.setSnapshotData((pandaData) => {
    if (!viewer || !pandaData || !pandaData.data) {
      return;
    }
    const { data } = pandaData;
    const params = pandaData.params || {};
    // Track the selected viewpoint so the Studio "update" button can re-capture it.
    if (data.type === 'viewpoint') {
      selectedViewpointId = data.id;
    } else {
      selectedViewpointId = null;
    }
    const yaw = `${data.yaw || 0}deg`;
    const pitch = `${data.pitch || 0}deg`;
    const hasZoom = typeof data.zoom === 'number';
    // A toMarker / default move is explicit: take the camera from the gyro, which
    // would otherwise veto the rotation (see takeCameraControl).
    takeCameraControl();
    // isDefault, a 0-duration edit (panel field change), or an explicit
    // transitionSpeed of 0 (instant "go to marker") applies instantly — without
    // this, `speed: transitionSpeed || 1500` below would turn a deliberate 0 into 1.5s.
    if (params.isDefault || params.duration === 0 || params.transitionSpeed === 0) {
      viewer.rotate({ yaw, pitch });
      if (hasZoom) {
        viewer.zoom(data.zoom);
      }
      if (params.isDefault && PandaBridge.isStudio) {
        // rotate()/zoom() only flag the next frame; takeScreenshot reads the canvas
        // synchronously, so it would capture the pre-rotation view. Defer it to the
        // next render, and needsUpdate() guarantees that render fires even when the
        // default equals the current view (no-op rotate).
        viewer.addEventListener('render', () => PandaBridge.takeScreenshot(), { once: true });
        viewer.needsUpdate();
      }
    } else {
      const opts = { yaw, pitch, speed: params.transitionSpeed || 1500 };
      if (hasZoom) {
        opts.zoom = data.zoom;
      }
      viewer.animate(opts);
    }
  });

  // Scrub between viewpoint markers (0-100) driven by another component.
  PandaBridge.synchronize('synchroMarkers', (percent) => {
    if (!viewer || !viewpoints.length) {
      return;
    }
    // Scrubbing drives the camera programmatically; yield it from the gyro (no-op
    // after the first tick, since the gyro is then stopped).
    takeCameraControl();
    if (viewpoints.length === 1) {
      const v0 = viewpoints[0];
      viewer.rotate({ yaw: `${v0.yaw || 0}deg`, pitch: `${v0.pitch || 0}deg` });
      if (typeof v0.zoom === 'number') {
        viewer.zoom(v0.zoom);
      }
      return;
    }
    const t = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
    const seg = t * (viewpoints.length - 1);
    const i = Math.min(Math.floor(seg), viewpoints.length - 2);
    const f = seg - i;
    const a = viewpoints[i];
    const b = viewpoints[i + 1];
    const yaw = (a.yaw || 0) + shortestArc(a.yaw || 0, b.yaw || 0) * f;
    const pitch = (a.pitch || 0) + ((b.pitch || 0) - (a.pitch || 0)) * f;
    viewer.rotate({ yaw: `${yaw}deg`, pitch: `${pitch}deg` });
    const za = typeof a.zoom === 'number' ? a.zoom : viewer.getZoomLevel();
    const zb = typeof b.zoom === 'number' ? b.zoom : za;
    viewer.zoom(za + (zb - za) * f);
  });
});
