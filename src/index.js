import PandaBridge from 'pandasuite-bridge';

let properties = null;
let markers = null;

function myInit() {
  // const imageUrl = PandaBridge.resolvePath('my_image.png');
  // PandaBridge.send('imageChanged');
}

PandaBridge.init(() => {
  PandaBridge.onLoad((pandaData) => {
    properties = pandaData.properties;
    markers = pandaData.markers;

    if (document.readyState === 'complete') {
      myInit();
    } else {
      document.addEventListener('DOMContentLoaded', myInit, false);
    }
  });

  PandaBridge.onUpdate((pandaData) => {
    properties = pandaData.properties;
    markers = pandaData.markers;
  });

  /* Markers */

  PandaBridge.getSnapshotData(() => null);

  PandaBridge.setSnapshotData((pandaData) => {
    // pandaData.data.id
  });

  /* Actions */

  PandaBridge.listen('changeColor', (args) => {
  });

  PandaBridge.synchronize('synchroImages', (percent) => {
  });
});
