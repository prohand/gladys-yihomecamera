// -----------------------------------------------------------------------------
// The cameras: what the integration knows about each one, and everything it
// does with them.
//
// One CameraManager for the whole integration. It holds one entry per address
// of the configuration and:
//   - reads each camera (status.json + camera settings) at the refresh
//     interval, and publishes the states and the transport badge;
//   - takes the snapshots (pushed on a timer, or on demand);
//   - turns MQTT messages, or new recordings, into the motion feature and the
//     scene triggers;
//   - runs the commands (on/off, LED, night vision, PTZ, presets, reboot).
//
// index.js owns the timers and the SDK wiring; this file holds no timer
// except the motion reset, so the tests can drive every step by hand.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { YiClient, parsePresets, yesNo } from './yi/client.js';
import { cameraTopics, createMqttListener, MQTT_EVENTS } from './yi/mqtt.js';
import {
  FEATURES,
  MOVES,
  SETTING_OF_FEATURE,
  buildCameraDevice,
  cameraIds,
  cameraStates,
  defaultCameraName,
  platformIdFromStatus,
} from './devices/camera.js';
import { DETECTIONS, SCENE_TRIGGERS } from './capabilities/triggers.js';

const logger = createLogger({ name: 'cameras' });

/** The SDK refuses a camera image string longer than this (150 KB). */
export const MAX_IMAGE_LENGTH = 150 * 1024;

/** A stable value is still re-published this often, so Gladys dates it recently. */
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/** The same detection twice within this delay is one event, not two. */
const EVENT_DEBOUNCE_MS = 10_000;

/** A motion started over MQTT ends with motion_stop; this is the safety net. */
const MQTT_MOTION_SAFETY_MS = 10 * 60 * 1000;

/** A camera told to reboot is offline on purpose for about a minute. */
const REBOOT_GRACE_MS = 3 * 60 * 1000;

const PRESETS_REFRESH_MS = 60 * 60 * 1000;

function newCamera(host, identity) {
  return {
    host,
    id: identity?.id ?? null,
    name: identity?.name ?? null,
    model: identity?.model ?? null,
    firmware: identity?.firmware ?? null,
    ptz: identity?.ptz ?? false,
    presets: identity?.presets ?? [],
    presetsReadAt: 0,
    // null: never read since the start; true / false afterwards.
    online: null,
    error: null,
    status: null,
    settings: null,
    motion: 0,
    motionTimer: null,
    lastMotion: null,
    lastSound: null,
    lastEvents: {},
    snapshot: null,
    // undefined: no baseline yet (the first read only records the clip).
    lastRecording: undefined,
    mqttTopics: null,
    rebootingUntil: 0,
  };
}

export class CameraManager {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK instance
   * @param {object} options.store identity store (src/store.js)
   * @param {typeof fetch} [options.fetch] injected by the tests
   * @param {Function} [options.connectMqtt] injected by the tests
   * @param {() => number} [options.now]
   * @param {{ setTimeout: Function, clearTimeout: Function }} [options.timers]
   * @param {(ms: number) => Promise<void>} [options.sleep]
   */
  constructor({ gladys, store, fetch, connectMqtt, now, timers, sleep }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.connectMqtt = connectMqtt;
    this.now = now ?? (() => Date.now());
    this.timers = timers ?? { setTimeout, clearTimeout };
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => this.timers.setTimeout(resolve, ms)));
    this.config = normalizeConfig();
    /** @type {Map<string, ReturnType<typeof newCamera>>} */
    this.cameras = new Map();
    this.mqtt = null;
    this.mqttKey = '';
    this.mqttClashes = [];
    this.mqttQueue = Promise.resolve();
    this.discoverySignature = '';
    /** Called when something a widget shows changed. Set by index.js. */
    this.onChange = () => {};
  }

  // --- Configuration --------------------------------------------------------

  /**
   * Apply a (normalized) configuration: one entry per address, the state of
   * the addresses already known kept, the MQTT listener (re)started when its
   * settings changed.
   */
  configure(config) {
    this.config = config;
    const next = new Map();
    for (const host of config.hosts) {
      const camera = this.cameras.get(host) ?? newCamera(host, this.store.get(host));
      camera.client = new YiClient({
        host,
        username: config.username,
        password: config.password,
        fetch: this.fetch,
      });
      next.set(host, camera);
    }
    for (const [host, camera] of this.cameras) {
      if (!next.has(host)) {
        this.timers.clearTimeout(camera.motionTimer);
      }
    }
    this.cameras = next;
    this.configureMqtt();
  }

  configureMqtt() {
    const { mqtt_url: url, mqtt_username: username, mqtt_password: password } = this.config;
    const key = JSON.stringify([url, username, password]);
    if (key === this.mqttKey) {
      return;
    }
    this.mqttKey = key;
    this.mqtt?.close().catch(() => {});
    this.mqtt = null;
    for (const camera of this.cameras.values()) {
      camera.mqttTopics = null;
    }
    if (!url) {
      return;
    }
    this.mqtt = createMqttListener({
      url,
      username,
      password,
      connect: this.connectMqtt,
      // One message at a time, in arrival order: "motion_start" then "human"
      // must reach the scenes in that order.
      onEvent: (host, event) => {
        this.mqttQueue = this.mqttQueue
          .then(() => this.handleMqttEvent(host, event))
          .catch((err) => logger.error(`MQTT event of ${host} failed`, err));
      },
      onStatus: () => this.onChange(),
    });
  }

  /** The cameras, in the order of the configuration. */
  list() {
    return [...this.cameras.values()];
  }

  byDeviceExternalId(externalId) {
    return this.list().find((camera) => cameraIds(this.gladys, camera)?.device === externalId);
  }

  // --- Reading the cameras --------------------------------------------------

  /**
   * Read one camera. Never throws: a camera that does not answer is marked
   * offline, with the reason.
   *
   * @param {object} camera
   * @param {object} [options]
   * @param {boolean} [options.full] also re-read presets and MQTT topics
   */
  async refreshCamera(camera, { full = false } = {}) {
    try {
      const status = await camera.client.getStatus();
      const settings = await camera.client.getConfig('camera');
      const id = platformIdFromStatus(status);
      if (id && camera.id && id !== camera.id) {
        logger.warn(`${camera.host}: another camera answers at this address now (${id})`);
      }
      camera.id = id ?? camera.id;
      camera.status = status;
      camera.settings = settings;
      camera.name = defaultCameraName(status, camera.host);
      camera.model = status.model_suffix || null;
      camera.firmware = status.fw_version || null;
      camera.ptz = status.ptz === 'yes';
      if (camera.ptz && (full || this.now() - camera.presetsReadAt > PRESETS_REFRESH_MS)) {
        await this.readPresets(camera);
      }
      if (this.mqtt && (full || !camera.mqttTopics)) {
        await this.readMqttTopics(camera);
      }
      if (camera.online !== true) {
        logger.info(`${camera.host}: online (${camera.name}, ${camera.model ?? 'unknown model'})`);
      }
      camera.online = true;
      camera.error = null;
      if (camera.id) {
        this.store.set(camera.host, camera);
      }
    } catch (err) {
      if (camera.online !== false) {
        logger.warn(`${camera.host}: ${err.message}`);
      }
      camera.online = false;
      camera.error = { code: err.code ?? 'unreachable', message: err.message };
    }
  }

  async readPresets(camera) {
    try {
      camera.presets = parsePresets(await camera.client.getConfig('ptz_presets'));
      camera.presetsReadAt = this.now();
    } catch (err) {
      logger.debug(`${camera.host}: presets not read (${err.message})`);
    }
  }

  async readMqttTopics(camera) {
    try {
      camera.mqttTopics = cameraTopics(await camera.client.getConfig('mqtt'));
    } catch (err) {
      camera.mqttTopics = null;
      logger.debug(`${camera.host}: MQTT settings not read (${err.message})`);
    }
  }

  /**
   * Read every camera, then publish what changed: the device list when a new
   * camera or preset appeared, the states, the transport badges, and the
   * online/offline scene triggers.
   */
  async refreshAll({ full = false } = {}) {
    const cameras = this.list();
    const before = new Map(cameras.map((camera) => [camera.host, camera.online]));
    await Promise.all(cameras.map((camera) => this.refreshCamera(camera, { full })));
    this.updateMqttRoutes();
    await this.publishDiscoveredIfChanged();
    await this.publishStates(cameras);
    await this.publishTransports();
    for (const camera of cameras) {
      const was = before.get(camera.host);
      if (was !== null && was !== camera.online) {
        await this.fireConnectionTrigger(camera);
      }
    }
    this.onChange();
  }

  /** Refresh and publish one camera (after a command, an MQTT status…). */
  async refreshOne(camera) {
    const was = camera.online;
    await this.refreshCamera(camera);
    await this.publishDiscoveredIfChanged();
    await this.publishStates([camera]);
    await this.publishTransports();
    if (was !== null && was !== camera.online) {
      await this.fireConnectionTrigger(camera);
    }
    this.onChange();
  }

  async fireConnectionTrigger(camera) {
    const ids = cameraIds(this.gladys, camera);
    if (!ids || this.now() < camera.rebootingUntil) {
      return;
    }
    const key = camera.online ? SCENE_TRIGGERS.CAMERA_ONLINE : SCENE_TRIGGERS.CAMERA_OFFLINE;
    await this.sceneEvent(key, { device: ids.device, device_name: camera.name, host: camera.host });
  }

  // --- Publishing -----------------------------------------------------------

  /** Discovery payload: every camera whose identity is known. */
  buildDevices() {
    return this.list()
      .filter((camera) => camera.id)
      .map((camera) => buildCameraDevice(this.gladys, camera));
  }

  async publishDiscovered() {
    const devices = this.buildDevices();
    this.discoverySignature = JSON.stringify(devices);
    await this.gladys.publishDiscoveredDevices(devices);
  }

  async publishDiscoveredIfChanged() {
    if (JSON.stringify(this.buildDevices()) !== this.discoverySignature) {
      await this.publishDiscovered();
    }
  }

  async publishStates(cameras = this.list()) {
    const states = cameras.flatMap((camera) => cameraStates(this.gladys, camera));
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  /** The per-camera badge: `local` when it answered, `unreachable` otherwise. */
  async publishTransports() {
    const entries = this.list()
      .filter((camera) => camera.id && camera.online !== null)
      .map((camera) => ({
        external_id: cameraIds(this.gladys, camera).device,
        transport: camera.online ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
      }));
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  async sceneEvent(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      // A refused event (rate limit, Gladys < 5.1) never breaks the camera.
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Snapshots ------------------------------------------------------------

  /**
   * Take a fresh snapshot, keep it for the widgets, and optionally push it to
   * Gladys. Resolves the `image/jpg;base64,...` string.
   */
  async capture(camera, { publish = false } = {}) {
    let resolution = this.config.snapshot_resolution;
    let buffer = await camera.client.snapshot({ resolution });
    let image = `image/jpg;base64,${buffer.toString('base64')}`;
    if (image.length > MAX_IMAGE_LENGTH && resolution === 'high') {
      // A busy scene in 1080p can exceed what Gladys accepts: fall back to
      // the small stream rather than sending nothing.
      resolution = 'low';
      buffer = await camera.client.snapshot({ resolution });
      image = `image/jpg;base64,${buffer.toString('base64')}`;
    }
    if (image.length > MAX_IMAGE_LENGTH) {
      throw new Error(`${camera.host}: the snapshot is larger than the 150 KB Gladys accepts`);
    }
    const at = this.now();
    camera.snapshot = { buffer, at, key: snapshotKey(camera, at) };
    const ids = cameraIds(this.gladys, camera);
    if (publish && ids) {
      await this.gladys.publishCameraImage(ids.device, image);
    }
    this.onChange(camera);
    return image;
  }

  /** The periodic push: one snapshot of every camera that is on. */
  async pushSnapshots() {
    for (const camera of this.list()) {
      if (!camera.id || camera.online !== true || isOff(camera)) {
        continue;
      }
      try {
        await this.capture(camera, { publish: true });
      } catch (err) {
        logger.debug(`${camera.host}: snapshot failed (${err.message})`);
      }
    }
  }

  // --- Motion and sound -----------------------------------------------------

  /** Whether the motion of this camera arrives over MQTT right now. */
  mqttActive(camera) {
    return Boolean(this.mqtt?.connected && this.mqtt.hosts().has(camera.host));
  }

  updateMqttRoutes() {
    if (!this.mqtt) {
      this.mqttClashes = [];
      return;
    }
    const byHost = new Map(
      this.list()
        .filter((camera) => camera.mqttTopics)
        .map((camera) => [camera.host, camera.mqttTopics]),
    );
    this.mqttClashes = this.mqtt.route(byHost);
    for (const host of this.mqttClashes) {
      logger.warn(
        `${host}: same MQTT prefix as another camera, its MQTT events cannot be told apart`,
      );
    }
  }

  async handleMqttEvent(host, event) {
    const camera = this.cameras.get(host);
    if (!camera) {
      return;
    }
    switch (event) {
      case MQTT_EVENTS.MOTION_START:
        return this.motionDetected(camera, DETECTIONS.MOTION, MQTT_MOTION_SAFETY_MS);
      case MQTT_EVENTS.MOTION_STOP:
        return this.motionEnded(camera);
      case MQTT_EVENTS.HUMAN:
        return this.motionDetected(camera, DETECTIONS.HUMAN);
      case MQTT_EVENTS.VEHICLE:
        return this.motionDetected(camera, DETECTIONS.VEHICLE);
      case MQTT_EVENTS.ANIMAL:
        return this.motionDetected(camera, DETECTIONS.ANIMAL);
      case MQTT_EVENTS.SOUND:
      case MQTT_EVENTS.CRYING:
        return this.soundDetected(camera, event);
      case MQTT_EVENTS.ONLINE:
      case MQTT_EVENTS.OFFLINE:
        // The broker's word is a hint: confirm by asking the camera.
        return this.refreshOne(camera);
      default:
        return undefined;
    }
  }

  /** True (and remembered) when the same event was already fired just now. */
  debounced(camera, kind) {
    const now = this.now();
    const last = camera.lastEvents[kind];
    if (last !== undefined && now - last < EVENT_DEBOUNCE_MS) {
      return true;
    }
    camera.lastEvents[kind] = now;
    return false;
  }

  /**
   * A detection: the motion feature goes to 1 (once), the motion_detected
   * trigger fires (once per detection kind), and the motion goes back to 0
   * after the timeout unless something says it again.
   */
  async motionDetected(camera, detection, resetAfterMs) {
    const ids = cameraIds(this.gladys, camera);
    if (!ids) {
      return;
    }
    const wasIdle = camera.motion === 0;
    camera.motion = 1;
    camera.lastMotion = { at: this.now(), detection };
    this.armMotionReset(camera, resetAfterMs ?? this.config.motion_timeout * 1000);
    if (wasIdle) {
      await this.gladys.publishState(ids.feature(FEATURES.MOTION), 1);
    }
    // Plain motion fires on the 0 -> 1 edge only; an AI detection is news
    // even during a motion (the scene filters on what was seen).
    if ((wasIdle || detection !== DETECTIONS.MOTION) && !this.debounced(camera, detection)) {
      await this.sceneEvent(SCENE_TRIGGERS.MOTION_DETECTED, {
        device: ids.device,
        device_name: camera.name,
        detection,
      });
    }
    this.onChange(camera);
  }

  armMotionReset(camera, ms) {
    this.timers.clearTimeout(camera.motionTimer);
    camera.motionTimer = this.timers.setTimeout(() => {
      this.motionEnded(camera).catch((err) => logger.error('Motion reset failed', err));
    }, ms);
  }

  async motionEnded(camera) {
    this.timers.clearTimeout(camera.motionTimer);
    camera.motionTimer = null;
    const ids = cameraIds(this.gladys, camera);
    if (camera.motion === 0 || !ids) {
      return;
    }
    camera.motion = 0;
    await this.gladys.publishState(ids.feature(FEATURES.MOTION), 0);
    this.onChange(camera);
  }

  async soundDetected(camera, sound) {
    const ids = cameraIds(this.gladys, camera);
    if (!ids || this.debounced(camera, `sound:${sound}`)) {
      return;
    }
    camera.lastSound = { at: this.now(), sound };
    await this.sceneEvent(SCENE_TRIGGERS.SOUND_DETECTED, {
      device: ids.device,
      device_name: camera.name,
      sound,
    });
    this.onChange(camera);
  }

  /**
   * Without MQTT, a new clip on the SD card is the sign of a motion — when
   * the camera records on motion only (yi-hack "Save video on motion"); a
   * camera recording all the time says nothing this way.
   */
  async checkRecordings() {
    for (const camera of this.list()) {
      if (
        !camera.id ||
        camera.online !== true ||
        isOff(camera) ||
        this.mqttActive(camera) ||
        camera.settings?.SAVE_VIDEO_ON_MOTION !== 'yes'
      ) {
        continue;
      }
      try {
        const last = await camera.client.lastRecording();
        if (camera.lastRecording !== undefined && last && last !== camera.lastRecording) {
          await this.motionDetected(camera, DETECTIONS.MOTION);
        }
        camera.lastRecording = last;
      } catch (err) {
        logger.debug(`${camera.host}: recordings not read (${err.message})`);
      }
    }
  }

  // --- Commands -------------------------------------------------------------

  /**
   * A command from Gladys on one feature of a camera.
   * @param {object} camera
   * @param {string} featureKey one of FEATURES
   * @param {number|string} value
   */
  async setValue(camera, featureKey, value) {
    const setting = SETTING_OF_FEATURE[featureKey];
    if (setting) {
      await camera.client.setCameraSettings({ [setting.param]: Number(value) ? 'yes' : 'no' });
      // has_feedback: publish what the camera says now, not what was asked.
      await this.refreshOne(camera);
      return;
    }
    if (featureKey === FEATURES.MOVE) {
      const move = Number(value);
      // 0 is "stop": every yi-hack move is a step that stops by itself.
      if (move !== 0) {
        const direction = MOVES[move];
        if (!direction) {
          throw new Error(`Unsupported move ${value}`);
        }
        await camera.client.ptzStep(direction);
      }
      return;
    }
    if (featureKey === FEATURES.PRESET) {
      await camera.client.goToPreset(Number(value));
      return;
    }
    throw new Error(`Feature "${featureKey}" cannot be changed`);
  }

  async setSensitivity(camera, sensitivity) {
    await camera.client.setCameraSettings({ sensitivity });
    await this.refreshOne(camera);
  }

  /**
   * Make a camera show itself: its LED blinks three times, then gets back to
   * what it was.
   */
  async identify(camera) {
    const wasOn = yesNo(camera.settings?.LED) === 1;
    try {
      for (let i = 0; i < 3; i += 1) {
        await camera.client.setCameraSettings({ led: 'yes' });
        await this.sleep(500);
        await camera.client.setCameraSettings({ led: 'no' });
        await this.sleep(500);
      }
    } finally {
      await camera.client.setCameraSettings({ led: wasOn ? 'yes' : 'no' }).catch(() => {});
    }
  }

  async reboot(camera) {
    // Offline on purpose: no camera_offline / camera_online for this one.
    camera.rebootingUntil = this.now() + REBOOT_GRACE_MS;
    await camera.client.reboot();
  }

  // --- Lifecycle ------------------------------------------------------------

  async stop() {
    for (const camera of this.cameras.values()) {
      this.timers.clearTimeout(camera.motionTimer);
      camera.motionTimer = null;
    }
    const mqtt = this.mqtt;
    this.mqtt = null;
    this.mqttKey = '';
    await mqtt?.close();
  }
}

/** Whether the camera is switched off (yi-hack "privacy mode"). */
export function isOff(camera) {
  return camera.settings?.SWITCH_ON === 'no';
}

/**
 * Image key of a snapshot, for the widgets: Gladys caches an image one hour by
 * key, so a new frame needs a new key. `^[a-z0-9][a-z0-9-]{0,63}$`.
 */
export function snapshotKey(camera, at) {
  return `snap-${String(camera.id ?? 'x').slice(-12)}-${at.toString(36)}`;
}
