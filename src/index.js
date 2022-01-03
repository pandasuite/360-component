import PandaBridge from 'pandasuite-bridge';

let properties = null;
let krpano = null;
let videoMode = true;

function myInit() {
  const { type } = properties;

  if (PandaBridge.resolvePath('video.mp4') && type === 'video') {
    krpano.call(`set(plugin[video].videourl, ${PandaBridge.resolvePath('video.mp4')});`);
  } else if (type === 'image') {
    videoMode = false;
    krpano.call(`loadpano(null, image.sphere.url=${PandaBridge.resolvePath('image.jpg')}, MERGE, BLEND(1));`);
  } else {
    return;
  }

  if (!properties.isAutoPlay && videoMode) {
    krpano.call('set(plugin[video].pausedonstart, true);');
  }

  if (!properties.isGyro) {
    krpano.call('set(plugin[gyro].enabled, false);');
  }

  const panoElem = document.getElementById('pano');
  const hammertime = new window.Hammer(panoElem);

  hammertime.get('press').set({
    time: 1,
    pointers: 1,
    threshold: 10,
  });

  let firstTap = true;

  hammertime.on('tap', (ev) => {
    if (ev.tapCount === 1) {
      PandaBridge.send('singleTap');
    } else if (ev.tapCount === 2) {
      PandaBridge.send('doubleTap');
    }
    if (firstTap) {
      if (typeof (DeviceMotionEvent) !== 'undefined' && typeof (DeviceMotionEvent.requestPermission) === 'function') {
        DeviceMotionEvent.requestPermission().catch((err) => {
          console.log(err);
        });
      }
      firstTap = false;
    }
  });

  let pressed = false;

  hammertime.on('press', () => {
    pressed = true;
    PandaBridge.send('touchDown');
  });

  function onRelease() {
    if (pressed) {
      PandaBridge.send('touchUp');
      pressed = false;
    }
  }

  panoElem.addEventListener('mouseup', onRelease);
  panoElem.addEventListener('touchend', onRelease);
}

function waitForInit() {
  krpano = document.getElementById('krpanoSWFObject');
  if (!krpano) {
    window.requestAnimationFrame(waitForInit);
  } else {
    myInit();
  }
}

PandaBridge.init(() => {
  PandaBridge.onLoad((pandaData) => {
    properties = pandaData.properties;

    waitForInit();
  });

  PandaBridge.listen('play', () => {
    if (krpano && videoMode) {
      krpano.call('plugin[video].play();');
    }
  });

  PandaBridge.listen('stop', () => {
    if (krpano && videoMode) {
      krpano.call('plugin[video].stop();');
    }
  });

  PandaBridge.listen('pause', () => {
    if (krpano && videoMode) {
      krpano.call('plugin[video].pause();');
    }
  });

  PandaBridge.listen('togglePause', () => {
    if (krpano && videoMode) {
      krpano.call('plugin[video].togglepause();');
    }
  });
});
