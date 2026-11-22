// -----------------------------------------------------------------------------
// Device type: YI CAMERA
//
// One Gladys device per camera, whatever the model. Its features:
//
//   image    camera/image          the snapshots (dedicated image channel)
//   enabled  camera/enabled        the camera itself on/off — yi-hack SWITCH_ON,
//                                  i.e. the vendor "privacy mode" the SDK maps
//                                  onto this feature
//   motion   motion-sensor/binary  motion detected
//   led      switch/binary         the status LED
//   ir       switch/binary         the infrared night vision
//   signal   signal/integer        Wi-Fi quality, % (absent on a wired camera)
//   move     camera/move           pan/tilt steps (PTZ models only)
//   preset   camera/preset         saved positions (PTZ models only)
//
// The feature keys are part of the external ids: they are forever.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { yesNo } from '../yi/client.js';

export const DEVICE_TYPE = 'yi-camera';

export const FEATURES = {
  IMAGE: 'image',
  ENABLED: 'enabled',
  MOTION: 'motion',
  LED: 'led',
  IR: 'ir',
  SIGNAL: 'signal',
  MOVE: 'move',
  PRESET: 'preset',
};

/**
 * CAMERA.MOVE values (SDK convention: 0 stop, 1 pan left, 2 pan right, 3 tilt
 * up, 4 tilt down, 5 zoom in, 6 zoom out) -> yi-hack `ptz.sh` direction. Yi
 * cameras have no zoom, so 5 and 6 are not offered.
 */
export const MOVES = {
  1: 'left',
  2: 'right',
  3: 'up',
  4: 'down',
};

const MOVE_OPTIONS = [
  { value: 1, label: 'Pan left', sort_order: 0 },
  { value: 2, label: 'Pan right', sort_order: 1 },
  { value: 3, label: 'Tilt up', sort_order: 2 },
  { value: 4, label: 'Tilt down', sort_order: 3 },
];

/** Settings of `get_configs.sh?conf=camera` behind the switch features. */
export const SETTING_OF_FEATURE = {
  [FEATURES.ENABLED]: { key: 'SWITCH_ON', param: 'switch_on' },
  [FEATURES.LED]: { key: 'LED', param: 'led' },
  [FEATURES.IR]: { key: 'IR', param: 'ir' },
};

/** External ids of one camera (null when its platform id is not known yet). */
export function cameraIds(gladys, camera) {
  return camera.id ? gladys.externalIds(DEVICE_TYPE, camera.id) : null;
}

/**
 * The stable id of a camera, from what status.json gives: the MAC address
 * (the one thing that survives a reflash, a rename and a DHCP change), the
 * serial number when the MAC is missing. Never the IP, never the hostname.
 *
 * @param {object} status status.json
 * @returns {string|null}
 */
export function platformIdFromStatus(status = {}) {
  const mac = String(status.mac_addr ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  if (mac.length === 12 && !/^0+$/.test(mac)) {
    return mac;
  }
  const serial = String(status.serial_number ?? '')
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '');
  // The script pads a missing serial with zeros.
  if (serial.length >= 6 && !/^0+$/.test(serial)) {
    return serial;
  }
  return null;
}

/**
 * The name a camera is created with. yi-hack ships every camera with the
 * hostname "yi-hack": that one says nothing, the address does.
 */
export function defaultCameraName(status = {}, host = '') {
  const hostname = String(status.hostname ?? '').trim();
  if (hostname && hostname.toLowerCase() !== 'yi-hack') {
    return hostname;
  }
  return `Yi camera ${host}`.trim();
}

function feature(ids, key, fields) {
  return {
    external_id: ids.feature(key),
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
    keep_history: true,
    ...fields,
  };
}

/**
 * The discovery payload of one camera. Every feature carries `name`, `min`,
 * `max`, `read_only` and `has_feedback`: Gladys stores them NOT NULL.
 *
 * @param {object} gladys the SDK instance
 * @param {object} camera a camera of the manager (src/cameras.js)
 */
export function buildCameraDevice(gladys, camera) {
  const ids = cameraIds(gladys, camera);
  const features = [
    feature(ids, FEATURES.IMAGE, {
      name: 'Image',
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
      // No range for an image, but Gladys still requires min and max: 0/0.
      max: 0,
      read_only: true,
      has_feedback: false,
      // Images never go through the states history.
      keep_history: false,
    }),
    feature(ids, FEATURES.ENABLED, {
      name: 'Camera on',
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.ENABLED,
    }),
    feature(ids, FEATURES.MOTION, {
      name: 'Motion',
      category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      read_only: true,
      has_feedback: false,
    }),
    feature(ids, FEATURES.LED, {
      name: 'Status LED',
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    }),
    feature(ids, FEATURES.IR, {
      name: 'Night vision (IR)',
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
    }),
    feature(ids, FEATURES.SIGNAL, {
      name: 'Wi-Fi signal',
      category: DEVICE_FEATURE_CATEGORIES.SIGNAL,
      type: DEVICE_FEATURE_TYPES.SIGNAL.QUALITY,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      max: 100,
      read_only: true,
      has_feedback: false,
    }),
  ];

  if (camera.ptz) {
    features.push(
      feature(ids, FEATURES.MOVE, {
        name: 'Move',
        category: DEVICE_FEATURE_CATEGORIES.CAMERA,
        type: DEVICE_FEATURE_TYPES.CAMERA.MOVE,
        max: 4,
        // A command: nothing to read back, nothing to keep.
        has_feedback: false,
        keep_history: false,
        supported_options: MOVE_OPTIONS,
      }),
      feature(ids, FEATURES.PRESET, {
        name: 'Preset',
        category: DEVICE_FEATURE_CATEGORIES.CAMERA,
        type: DEVICE_FEATURE_TYPES.CAMERA.PRESET,
        max: 7,
        has_feedback: false,
        keep_history: false,
        // Silently upserted on every re-publish: a preset renamed on the
        // camera shows up in Gladys without re-creating the device.
        supported_options: (camera.presets ?? []).map(({ num, name }, index) => ({
          value: num,
          label: name,
          sort_order: index,
        })),
      }),
    );
  }

  const params = [{ name: 'host', value: camera.host }];
  if (camera.model) {
    params.push({ name: 'model', value: camera.model });
  }
  if (camera.firmware) {
    params.push({ name: 'firmware', value: camera.firmware });
  }

  return {
    name: camera.name ?? defaultCameraName({}, camera.host),
    external_id: ids.device,
    features,
    params,
  };
}

/**
 * Wi-Fi quality from status.json, in %. yi-hack reads the "link" column of
 * /proc/net/wireless, out of 70 on the Wi-Fi chips of these cameras (the
 * `iwconfig` "Link Quality=xx/70" scale). Empty on a wired camera.
 *
 * @returns {number|null}
 */
export function signalPercent(status = {}) {
  const raw = Number.parseInt(status.wlan_strength, 10);
  if (!Number.isFinite(raw) || raw < 0) {
    return null;
  }
  return Math.min(100, Math.round((raw * 100) / 70));
}

/**
 * The states of one camera, from what the manager last read. Only the values
 * actually known are returned: a setting a model lacks publishes nothing.
 *
 * @returns {{ device_feature_external_id: string, state: number }[]}
 */
export function cameraStates(gladys, camera) {
  const ids = cameraIds(gladys, camera);
  if (!ids || !camera.online) {
    return [];
  }
  const states = [];
  for (const [key, { key: setting }] of Object.entries(SETTING_OF_FEATURE)) {
    const value = yesNo(camera.settings?.[setting]);
    if (value !== null) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  }
  const signal = signalPercent(camera.status);
  if (signal !== null) {
    states.push({ device_feature_external_id: ids.feature(FEATURES.SIGNAL), state: signal });
  }
  states.push({ device_feature_external_id: ids.feature(FEATURES.MOTION), state: camera.motion });
  return states;
}

/**
 * The feature key of a feature external id of this camera, null if foreign.
 */
export function featureKeyOf(gladys, camera, featureExternalId) {
  const ids = cameraIds(gladys, camera);
  if (!ids || typeof featureExternalId !== 'string') {
    return null;
  }
  const prefix = `${ids.device}:`;
  return featureExternalId.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}
